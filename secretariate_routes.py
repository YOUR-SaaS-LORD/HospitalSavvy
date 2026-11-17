"""Flask routes for Secretariate templates and document storage."""

import json
import os
import uuid
from datetime import date

from flask import (
    Blueprint,
    current_app,
    jsonify,
    request,
    session,
    send_from_directory,
    abort,
)
from werkzeug.utils import secure_filename

from extensions import db
from routes.office_helper_routes import (
    ALLOWED_EXTENSIONS,
    MAX_UPLOAD_BYTES,
    actor,
    json_body,
    json_error,
    parse_date,
    require_roles,
    require_department,
    upload_folder,
)
from models.secretariate import (
    SecretariateDocumentTemplate,
    SecretariateDocument,
)


secretariate_bp = Blueprint(
    "secretariate_api",
    __name__,
    url_prefix="/api/office/secretariate",
)

ROLES = {"secretary", "hospital_manager", "system_admin", "admin"}


def check_access():
    return require_department(
        getattr(request, "office_role", ""),
        "secretariate",
    )


def normalize_document_content(value):
    """Return a JSON-compatible Python value for the PostgreSQL JSON column."""
    if value is None or value == "":
        return {}

    if isinstance(value, (dict, list, int, float, bool)):
        return value

    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            # Preserve plain text as a body instead of losing the user's text.
            return {"body": value}
        if isinstance(parsed, (dict, list, int, float, bool)) or parsed is None:
            return parsed if parsed is not None else {}
        return {"body": str(parsed)}

    return {"body": str(value)}


def document_creator_id():
    """Return the logged-in user's integer ID for the DB integer column."""
    candidates = [
        session.get("user_id"),
        session.get("id"),
    ]

    user_data = session.get("user")
    if isinstance(user_data, dict):
        candidates.extend([user_data.get("id"), user_data.get("user_id")])

    # Some authentication setups expose the user ID on the request.
    candidates.extend([
        getattr(request, "user_id", None),
        getattr(getattr(request, "current_user", None), "id", None),
    ])

    for value in candidates:
        if value is None or isinstance(value, bool):
            continue
        try:
            return int(value)
        except (TypeError, ValueError):
            continue

    # created_by is an integer column in the existing PostgreSQL schema.
    # NULL is safer than writing a username string into that column.
    return None


def clean_document_type(value, default="Document"):
    value = str(value or default).strip() or default
    if len(value) > 100:
        raise ValueError("Document type must not exceed 100 characters.")
    return value


def display_document_type(value):
    """Generate a readable label for the required DB display column."""
    value = str(value or "Document").strip()
    labels = {
        "memo": "Memorandum",
        "letter": "Letter",
        "notice": "Notice",
        "minutes": "Minutes",
        "report": "Report",
        "circular": "Circular",
        "policy": "Policy",
        "scanned_document": "Scanned Document",
    }
    return labels.get(value.lower(), value.replace("_", " ").replace("-", " ").title())


@secretariate_bp.get("/health")
@require_roles(ROLES)
def health():
    return jsonify(success=True, module="secretariate")


# ---------------------------------------------------------------------------
# DOCUMENT TEMPLATES
# ---------------------------------------------------------------------------

@secretariate_bp.get("/templates")
@require_roles(ROLES)
def list_templates():
    if not check_access():
        return json_error("You are not authorized to access this department.", 403)

    rows = SecretariateDocumentTemplate.query.order_by(
        SecretariateDocumentTemplate.updated_at.desc(),
        SecretariateDocumentTemplate.id.desc(),
    ).all()
    return jsonify(success=True, templates=[row.to_dict() for row in rows])


@secretariate_bp.post("/templates")
@require_roles(ROLES)
def create_template():
    try:
        if not check_access():
            return json_error("You are not authorized to access this department.", 403)

        data = json_body()
        title = str(data.get("title") or "").strip()
        template_type = str(data.get("template_type") or "Document").strip()
        content = str(data.get("content") or "").strip()

        if not title or not content:
            return json_error("Template title and content are required.")
        if len(title) > 200 or len(template_type) > 80:
            return json_error("Template title or type is too long.")

        record = SecretariateDocumentTemplate(
            title=title,
            template_type=template_type,
            content=content,
            created_by=actor(),
        )
        db.session.add(record)
        db.session.commit()
        return jsonify(success=True, template=record.to_dict()), 201

    except ValueError as exc:
        db.session.rollback()
        return json_error(str(exc))
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Unable to save secretariate template")
        return json_error("Unable to save the template.", 500)


@secretariate_bp.get("/templates/<int:record_id>")
@require_roles(ROLES)
def get_template(record_id):
    if not check_access():
        return json_error("You are not authorized to access this department.", 403)

    record = db.session.get(SecretariateDocumentTemplate, record_id)
    if not record:
        return json_error("Template not found.", 404)
    return jsonify(success=True, template=record.to_dict())


@secretariate_bp.delete("/templates/<int:record_id>")
@require_roles(ROLES)
def delete_template(record_id):
    if not check_access():
        return json_error("You are not authorized to access this department.", 403)

    record = db.session.get(SecretariateDocumentTemplate, record_id)
    if not record:
        return json_error("Template not found.", 404)

    try:
        db.session.delete(record)
        db.session.commit()
        return jsonify(success=True, message="Template deleted.")
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Unable to delete secretariate template")
        return json_error("Unable to delete the template.", 500)


# ---------------------------------------------------------------------------
# DOCUMENT STORE
# ---------------------------------------------------------------------------

@secretariate_bp.get("/documents")
@require_roles(ROLES)
def list_documents():
    if not check_access():
        return json_error("You are not authorized to access this department.", 403)

    query = SecretariateDocument.query
    document_type = request.args.get("document_type", "").strip()
    if document_type:
        query = query.filter_by(document_type=document_type)

    rows = query.order_by(
        SecretariateDocument.document_date.desc(),
        SecretariateDocument.created_at.desc(),
        SecretariateDocument.id.desc(),
    ).all()
    return jsonify(success=True, documents=[row.to_dict() for row in rows])


@secretariate_bp.get("/documents/<int:record_id>")
@require_roles(ROLES)
def get_document(record_id):
    if not check_access():
        return json_error("You are not authorized to access this department.", 403)

    record = db.session.get(SecretariateDocument, record_id)
    if not record:
        return json_error("Document not found.", 404)
    return jsonify(success=True, document=record.to_dict())


@secretariate_bp.post("/documents")
@require_roles(ROLES)
def create_document():
    try:
        if not check_access():
            return json_error("You are not authorized to access this department.", 403)

        data = json_body()
        title = str(data.get("title") or "").strip()
        if not title:
            return json_error("Document title is required.")
        if len(title) > 240:
            return json_error("Document title must not exceed 240 characters.")

        content = normalize_document_content(data.get("content", {}))
        document_type = clean_document_type(data.get("document_type"))
        document_date = parse_date(data.get("document_date")) or date.today()
        reference_number = f"SEC-{document_date.year}-{uuid.uuid4().hex[:8].upper()}"
        if isinstance(content, dict):
            content["number"] = reference_number
        else:
            content = {"body": json.dumps(content, ensure_ascii=False), "number": reference_number}

        record = SecretariateDocument(
            title=title,
            document_type=document_type,
            document_type_display=display_document_type(document_type),
            content=content,
            document_date=document_date,
            created_by=document_creator_id(),
        )
        db.session.add(record)
        db.session.commit()
        return jsonify(success=True, message="Document saved with reference " + reference_number, reference=reference_number, document=record.to_dict()), 201

    except ValueError as exc:
        db.session.rollback()
        return json_error(str(exc))
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Unable to save secretariate document")
        return json_error("Unable to save the document.", 500)


@secretariate_bp.post("/documents/upload")
@require_roles(ROLES)
def upload_document():
    if not check_access():
        return json_error("You are not authorized to access this department.", 403)

    uploaded_file = request.files.get("file")
    title = str(request.form.get("title") or "").strip()

    if not uploaded_file or not uploaded_file.filename:
        return json_error("Choose a file to upload.")
    if not title:
        return json_error("Document title is required.")
    if len(title) > 240:
        return json_error("Document title must not exceed 240 characters.")

    original_filename = secure_filename(uploaded_file.filename)
    if not original_filename:
        return json_error("The uploaded filename is invalid.")

    extension = os.path.splitext(original_filename)[1].lower()
    if extension not in ALLOWED_EXTENSIONS:
        return json_error("Unsupported file type.")

    uploaded_file.stream.seek(0, os.SEEK_END)
    size = uploaded_file.stream.tell()
    uploaded_file.stream.seek(0)
    if size > MAX_UPLOAD_BYTES:
        return json_error("File is too large. Maximum upload size is 20 MB.")

    try:
        document_type = clean_document_type(
            request.form.get("document_type"),
            default="Scanned Document",
        )
        content = normalize_document_content(request.form.get("content", ""))
    except ValueError as exc:
        return json_error(str(exc))

    stored_filename = f"{uuid.uuid4().hex}{extension}"
    folder = upload_folder()
    os.makedirs(folder, exist_ok=True)
    file_path = os.path.join(folder, stored_filename)

    try:
        uploaded_file.save(file_path)

        record = SecretariateDocument(
            title=title,
            document_type=document_type,
            document_type_display=display_document_type(document_type),
            content=content,
            original_filename=original_filename[:255],
            stored_filename=stored_filename,
            mime_type=(uploaded_file.mimetype or "application/octet-stream")[:160],
            document_date=date.today(),
            created_by=document_creator_id(),
        )
        db.session.add(record)
        db.session.commit()
        return jsonify(success=True, document=record.to_dict()), 201

    except Exception:
        db.session.rollback()
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except OSError:
            current_app.logger.exception("Failed upload cleanup")
        current_app.logger.exception("Unable to save uploaded secretariate document")
        return json_error("Unable to save the uploaded document.", 500)


@secretariate_bp.get("/documents/<int:record_id>/file")
@require_roles(ROLES)
def serve_document_file(record_id):
    if not check_access():
        abort(403)

    record = db.session.get(SecretariateDocument, record_id)
    if not record or not record.stored_filename:
        abort(404)

    return send_from_directory(
        upload_folder(),
        record.stored_filename,
        as_attachment=False,
        download_name=record.original_filename or "document",
    )


@secretariate_bp.delete("/documents/<int:record_id>")
@require_roles(ROLES)
def delete_document(record_id):
    if not check_access():
        return json_error("You are not authorized to access this department.", 403)

    record = db.session.get(SecretariateDocument, record_id)
    if not record:
        return json_error("Document not found.", 404)

    stored_filename = record.stored_filename
    try:
        db.session.delete(record)
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Unable to delete secretariate document")
        return json_error("Unable to delete the document.", 500)

    if stored_filename:
        try:
            os.remove(os.path.join(upload_folder(), stored_filename))
        except FileNotFoundError:
            pass
        except OSError:
            current_app.logger.exception(
                "Document removed from database but file cleanup failed"
            )

    return jsonify(success=True, message="Document deleted.")
