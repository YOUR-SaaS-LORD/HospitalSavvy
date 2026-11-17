"""Flask routes for Procurement documents."""
import io, os, uuid
import json
from datetime import date
from flask import Blueprint, current_app, jsonify, request, send_file, abort
from werkzeug.utils import secure_filename
from extensions import db
from routes.office_helper_routes import ALLOWED_EXTENSIONS, actor, json_body, json_error, parse_date, require_roles, require_department, upload_folder
from models.procurement import ProcurementDocumentTemplate, ProcurementDocument

procurement_bp=Blueprint("procurement_api",__name__,url_prefix="/api/office/procurement")
ROLES={"procurement_officer"}
PROCUREMENT_MAX_UPLOAD_BYTES=100*1024*1024

def procurement_reference(document_type, document_date):
    type_codes={"RFQ":"RFQ","QUOTATION":"QUO","PURCHASE_ORDER":"PO","SALES_ORDER":"SO","CONTRACT":"CON","DELIVERY_NOTE":"DLN","WAYBILL":"WAY","INVOICE":"INV","GRN":"GRN","PAYMENT_PROOF":"PAY","RECEIPT":"RCT","CREDIT_NOTE":"CRN","DEBIT_NOTE":"DBN","TAX_INVOICE":"TIN","CUSTOMS_DOCUMENT":"CUS","WARRANTY":"WAR","SCANNED_DOCUMENT":"SCAN"}
    kind=str(document_type or "DOCUMENT").strip().upper().replace(" ","_")
    prefix=type_codes.get(kind,"DOC")
    return f"{prefix}-{document_date.year}-{uuid.uuid4().hex[:8].upper()}"

def check_access():
    return require_department(getattr(request,"office_role",""),"procurement")

def actor_id():
    user = getattr(request, "office_user", {}) or {}
    try:
        return int(user.get("id"))
    except (TypeError, ValueError):
        return None

def document_payload(value):
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
            return decoded if isinstance(decoded, dict) else {"description": str(decoded)}
        except (TypeError, ValueError):
            return {"description": value}
    return {"description": str(value or "")}

@procurement_bp.get("/health")
@require_roles(ROLES)
def health(): return jsonify(success=True,module="procurement")

@procurement_bp.get("/templates")
@require_roles(ROLES)
def list_templates():
    if not check_access(): return json_error("You are not authorized to access this department.",403)
    rows=ProcurementDocumentTemplate.query.order_by(ProcurementDocumentTemplate.updated_at.desc(),ProcurementDocumentTemplate.id.desc()).all()
    return jsonify(success=True,templates=[r.to_dict() for r in rows])

@procurement_bp.post("/templates")
@require_roles(ROLES)
def create_template():
    try:
        if not check_access(): return json_error("You are not authorized to access this department.",403)
        data=json_body(); title=str(data.get("title") or "").strip(); kind=str(data.get("template_type") or "Document").strip(); content=str(data.get("content") or "").strip()
        if not title or not content: return json_error("Template title and content are required.")
        if len(title)>200 or len(kind)>80: return json_error("Template title or type is too long.")
        record=ProcurementDocumentTemplate(title=title,template_type=kind,content=content,created_by=actor())
        db.session.add(record); db.session.commit(); return jsonify(success=True,template=record.to_dict()),201
    except ValueError as exc: db.session.rollback(); return json_error(str(exc))
    except Exception: db.session.rollback(); current_app.logger.exception("Unable to save procurement template"); return json_error("Unable to save the template.",500)

@procurement_bp.get("/templates/<int:record_id>")
@require_roles(ROLES)
def get_template(record_id):
    if not check_access(): return json_error("You are not authorized to access this department.",403)
    r=db.session.get(ProcurementDocumentTemplate,record_id)
    if not r: return json_error("Template not found.",404)
    return jsonify(success=True,template=r.to_dict())

@procurement_bp.delete("/templates/<int:record_id>")
@require_roles(ROLES)
def delete_template(record_id):
    if not check_access(): return json_error("You are not authorized to access this department.",403)
    r=db.session.get(ProcurementDocumentTemplate,record_id)
    if not r: return json_error("Template not found.",404)
    db.session.delete(r); db.session.commit(); return jsonify(success=True,message="Template deleted.")

@procurement_bp.get("/documents")
@require_roles(ROLES)
def list_documents():
    if not check_access(): return json_error("You are not authorized to access this department.",403)
    q=ProcurementDocument.query; kind=request.args.get("document_type","").strip()
    if kind: q=q.filter_by(document_type=kind)
    rows=q.order_by(ProcurementDocument.document_date.desc(),ProcurementDocument.created_at.desc()).all()
    return jsonify(success=True,documents=[r.to_dict() for r in rows])

@procurement_bp.get("/documents/<int:record_id>")
@require_roles(ROLES)
def get_document(record_id):
    if not check_access(): return json_error("You are not authorized to access this department.",403)
    r=db.session.get(ProcurementDocument,record_id)
    if not r: return json_error("Document not found.",404)
    return jsonify(success=True,document=r.to_dict())

@procurement_bp.post("/documents")
@require_roles(ROLES)
def create_document():
    try:
        if not check_access(): return json_error("You are not authorized to access this department.",403)
        data=json_body(); title=str(data.get("title") or "").strip()
        if not title: return json_error("Document title is required.")
        kind=str(data.get("document_type") or "Document").strip()
        document_date=parse_date(data.get("document_date")) or date.today()
        content_data=document_payload(data.get("content") or data.get("payload") or {})
        document_number=str(data.get("document_number") or content_data.get("document_number") or procurement_reference(kind,document_date)).strip()
        display=str(data.get("document_type_display") or content_data.get("document_type_display") or kind.replace("_"," ").title()).strip()
        content_data.update({"document_type":kind,"document_type_display":display,"document_number":document_number,"document_date":document_date.isoformat()})
        r=ProcurementDocument(
            title=title[:250], document_type=kind[:80], document_type_display=display[:140],
            document_number=document_number[:120], document_date=document_date,
            party_name=str(content_data.get("party_name") or content_data.get("party") or "")[:250] or None,
            department=str(content_data.get("department") or "")[:160] or None,
            status=str(content_data.get("status") or "Draft")[:60], payload=content_data,
            is_scanned_document=False, created_by=actor_id(),
        )
        db.session.add(r); db.session.commit(); return jsonify(success=True,document=r.to_dict()),201
    except ValueError as exc: db.session.rollback(); return json_error(str(exc))
    except Exception: db.session.rollback(); current_app.logger.exception("Unable to save procurement document"); return json_error("Unable to save the document.",500)

@procurement_bp.post("/documents/upload")
@require_roles(ROLES)
def upload_document():
    if not check_access(): return json_error("You are not authorized to access this department.",403)
    file=request.files.get("file"); title=str(request.form.get("title") or "").strip()
    if not file or not file.filename: return json_error("Choose a file to upload.")
    if not title: return json_error("Document title is required.")
    original=secure_filename(file.filename); ext=os.path.splitext(original)[1].lower()
    if ext not in ALLOWED_EXTENSIONS: return json_error("Unsupported file type.")
    file.stream.seek(0,os.SEEK_END); size=file.stream.tell(); file.stream.seek(0)
    if size>PROCUREMENT_MAX_UPLOAD_BYTES: return json_error("File is too large. Maximum upload size is 100 MB.")
    try:
        kind=str(request.form.get("document_type") or "SCANNED_DOCUMENT").strip()[:80]
        document_date=parse_date(request.form.get("document_date")) or date.today()
        content_data=document_payload(request.form.get("content") or "{}")
        document_number=procurement_reference(kind,document_date)
        content_data.update({"document_type":kind,"document_type_display":str(content_data.get("document_type_display") or kind.replace("_"," ").title())[:140],"document_number":document_number,"document_date":document_date.isoformat(),"scan_file_name":original[:255],"scan_mime_type":(file.mimetype or "application/octet-stream")[:120]})
        raw_file=file.read()
        r=ProcurementDocument(
            document_type=kind, document_type_display=content_data["document_type_display"],
            document_number=document_number, document_date=document_date, title=title[:250],
            party_name=str(content_data.get("party_name") or "")[:250] or None,
            department=str(content_data.get("department") or "")[:160] or None,
            status=str(content_data.get("status") or "Scanned / Filed")[:60], payload=content_data,
            is_scanned_document=True, scan_file_name=original[:255],
            scan_mime_type=(file.mimetype or "application/octet-stream")[:120],
            scan_data=raw_file, scan_size=len(raw_file), created_by=actor_id(),
        )
        db.session.add(r); db.session.commit(); return jsonify(success=True,document=r.to_dict()),201
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Unable to save uploaded procurement document"); return json_error("Unable to save the uploaded document.",500)

@procurement_bp.get("/documents/<int:record_id>/file")
@require_roles(ROLES)
def serve_document_file(record_id):
    if not check_access(): abort(403)
    r=db.session.get(ProcurementDocument,record_id)
    if not r or not r.scan_data: abort(404)
    return send_file(io.BytesIO(r.scan_data),mimetype=r.scan_mime_type or "application/octet-stream",as_attachment=False,download_name=r.scan_file_name or "document")

@procurement_bp.delete("/documents/<int:record_id>")
@require_roles(ROLES)
def delete_document(record_id):
    if not check_access(): return json_error("You are not authorized to access this department.",403)
    r=db.session.get(ProcurementDocument,record_id)
    if not r: return json_error("Document not found.",404)
    db.session.delete(r); db.session.commit()
    return jsonify(success=True,message="Document deleted.")
