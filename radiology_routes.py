from flask import Blueprint, request, jsonify, session
from werkzeug.utils import secure_filename
from pathlib import Path
from uuid import uuid4

from extensions import db
from models.user import User
from models.staff import Staff
from models.patient import Patient, Visit
from models.radiology import (
    RadiologyRequest,
    RadiologyResult
)

radiology_bp = Blueprint(
    "radiology_bp",
    __name__,
    url_prefix="/api/radiology"
)

ALLOWED_EXTENSIONS = {
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "pdf"
}

UPLOAD_DIR = (
    Path(__file__).resolve().parent.parent
    / "static"
    / "uploads"
    / "radiology"
)

def current_radiologist():

    user_id = session.get("user_id")

    if not user_id:
        return None, (
            jsonify({
                "success": False,
                "error": "Authentication required."
            }),
            401
        )

    user = User.query.get(user_id)

    if not user or not user.is_active:
        return None, (
            jsonify({
                "success": False,
                "error": "Invalid or inactive account."
            }),
            401
        )

    staff = Staff.query.filter_by(
        user_id=user.id
    ).first()

    if not staff:
        return None, (
            jsonify({
                "success": False,
                "error": "Account is not linked to Staff."
            }),
            403
        )

    role = str(
        staff.role or ""
    ).strip().lower()

    if (
        "radiolog" not in role
        and "radiology" not in role
    ):
        return None, (
            jsonify({
                "success": False,
                "error": "Radiology staff access is required."
            }),
            403
        )

    if not session.get("department_id"):
        return None, (jsonify({"success": False, "error": "Choose a working department when signing in."}), 403)

    return staff, None

def allowed_file(filename):

    return (
        "." in filename
        and filename.rsplit(
            ".",
            1
        )[1].lower()
        in ALLOWED_EXTENSIONS
    )

def find_radiology_request(value):

    if not value:
        return None

    value = str(value).strip()

    # First try the public request ID:
    # RAD-202609191038...
    radiology_request = (
        RadiologyRequest.query.filter_by(
            request_id=value
        ).first()
    )

    if radiology_request:
        return radiology_request

    # Then try the database primary key:
    try:
        request_pk = int(value)
    except (TypeError, ValueError):
        return None

    return RadiologyRequest.query.get(
        request_pk
    )


def request_in_active_department(radiology_request):
    department_id = session.get("department_id")
    return bool(radiology_request and department_id and Visit.query.filter(
        Visit.patient_id == radiology_request.patient_id,
        Visit.department_id == department_id,
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING",
    ).first())

@radiology_bp.get("/queue")
def radiology_queue():

    staff, error = current_radiologist()

    if error:
        return error

    department_patients = db.session.query(Visit.patient_id).filter(
        Visit.department_id == session.get("department_id"),
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING",
    )
    requests = (
        RadiologyRequest.query
        .filter(
            RadiologyRequest.status == "PENDING",
            RadiologyRequest.patient_id.in_(department_patients),
        )
        .order_by(
            RadiologyRequest.created_at.asc()
        )
        .all()
    )

    output = []

    for item in requests:

        patient = Patient.query.get(
            item.patient_id
        )

        output.append({
            "id": item.id,

            "request_id": item.request_id,

            "patient_id": item.patient_id,

            "patient": (
                patient.full_name
                if patient
                else None
            ),

            "patient_number": (
                patient.patient_id
                if patient
                else None
            ),

            "examination": item.examination,

            "status": item.status,

            "created_at": (
                item.created_at.isoformat()
                if item.created_at
                else None
            )
        })

    return jsonify({
        "success": True,
        "requests": output
    })

@radiology_bp.get("/request/<int:request_id>")
def get_radiology_request(request_id):

    staff, error = current_radiologist()

    if error:
        return error

    radiology_request = (
        RadiologyRequest.query.get(
            request_id
        )
    )

    if not radiology_request:
        return jsonify({
            "success": False,
            "error": "Radiology request not found."
        }), 404

    patient = Patient.query.get(
        radiology_request.patient_id
    )

    return jsonify({
        "success": True,
        "request": {
            "id": radiology_request.id,
            "request_id": radiology_request.request_id,
            "patient_id": radiology_request.patient_id,
            "patient": (
                patient.full_name
                if patient
                else None
            ),
            "patient_number": (
                patient.patient_id
                if patient
                else None
            ),
            "examination": radiology_request.examination,
            "status": radiology_request.status,
            "created_at": (
                radiology_request.created_at.isoformat()
                if radiology_request.created_at
                else None
            )
        }
    })

@radiology_bp.post("/result")
def save_radiology_result():

    staff, error = current_radiologist()

    if error:
        return error

    request_id = request.form.get(
        "request_id"
    )

    findings = (
        request.form.get("findings")
        or ""
    ).strip()

    if not request_id:
        return jsonify({
            "success": False,
            "error": "request_id is required."
        }), 400

    if not findings:
        return jsonify({
            "success": False,
            "error": "Radiology findings are required."
        }), 400

    radiology_request = find_radiology_request(
        request_id
    )

    if not radiology_request:
        return jsonify({
            "success": False,
            "error": "Radiology request not found."
        }), 404

    if radiology_request.status == "COMPLETED":
        return jsonify({
            "success": False,
            "error": "This radiology request has already been completed."
        }), 409

    image = request.files.get(
        "image"
    )

    image_path = None

    if image and image.filename:

        if not allowed_file(
            image.filename
        ):
            return jsonify({
                "success": False,
                "error": "Unsupported image/scan file type."
            }), 400

        UPLOAD_DIR.mkdir(
            parents=True,
            exist_ok=True
        )

        original_name = secure_filename(
            image.filename
        )

        extension = (
            original_name
            .rsplit(
                ".",
                1
            )[1]
            .lower()
        )

        generated_name = (
            f"{uuid4().hex}.{extension}"
        )

        destination = (
            UPLOAD_DIR
            / generated_name
        )

        image.save(
            destination
        )

        image_path = (
            f"static/uploads/radiology/"
            f"{generated_name}"
        )

    result = RadiologyResult(
        request_id=radiology_request.id,
        image_path=image_path,
        findings=findings,
        reported_by=staff.id
    )

    radiology_request.status = "COMPLETED"

    patient = Patient.query.get(
        radiology_request.patient_id
    )

    if patient:
        patient.current_phase = (
            "Doctor Queue"
        )

    db.session.add(
        result
    )

    try:

        db.session.commit()

    except Exception as exc:

        db.session.rollback()

        return jsonify({
            "success": False,
            "error": str(exc)
        }), 500

    return jsonify({
        "success": True,
        "message": (
            "Radiology result saved successfully."
        ),
        "result": {
            "id": result.id,

            "request_id": (
                radiology_request.request_id
            ),

            "findings": result.findings,

            "image_url": (
                f"/{result.image_path}"
                if result.image_path
                else None
            ),

            "reported_by": staff.full_name,

            "created_at": (
                result.created_at.isoformat()
                if result.created_at
                else None
            )
        }
    }), 201
