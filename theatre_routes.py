from flask import Blueprint, request, jsonify
from extensions import db
from models.theatre import SurgicalRecord

theatre_bp = Blueprint(
    "theatre",
    __name__,
    url_prefix="/api/theatre"
)

@theatre_bp.post("/surgery")
def save_surgery():
    data = request.get_json() or {}

    record = SurgicalRecord(
        patient_id=data["patient_id"],
        procedure=data["procedure"],
        consent=data.get("consent"),
        surgeon_id=data.get("surgeon_id"),
        anaesthetist=data.get("anaesthetist"),
        anaesthesia_type=data.get("anaesthesia_type"),
        operation_notes=data.get("operation_notes"),
        status=data.get("status", "SCHEDULED")
    )

    db.session.add(record)
    db.session.commit()

    return jsonify({
        "message": "Surgical record saved",
        "id": record.id
    }), 201