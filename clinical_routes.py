from flask import Blueprint, request, jsonify
from extensions import db
from models.emergency import EmergencyCase

clinical_bp = Blueprint(
    "clinical",
    __name__,
    url_prefix="/api/clinical"
)

@clinical_bp.get("/emergencies")
def get_emergencies():
    cases = EmergencyCase.query.filter_by(
        status="ACTIVE"
    ).order_by(
        EmergencyCase.arrival_time.desc()
    ).all()

    return jsonify([
        {
            "id": c.id,
            "case_id": c.case_id,
            "patient_id": c.patient_id,
            "arrival_mode": c.arrival_mode,
            "arrival_time": c.arrival_time.isoformat(),
            "priority": c.priority,
            "area": c.area,
            "condition": c.consciousness,
            "doctor_id": c.doctor_id,
            "status": c.status
        }
        for c in cases
    ])

@clinical_bp.post("/emergency")
def save_emergency():
    data = request.get_json() or {}

    case = EmergencyCase(
        case_id=f"EM-{EmergencyCase.query.count() + 1:06d}",
        patient_id=data["patient_id"],
        arrival_mode=data.get("arrival_mode"),
        priority=data.get("priority"),
        area=data.get("area"),
        airway=data.get("airway"),
        breathing=data.get("breathing"),
        circulation=data.get("circulation"),
        consciousness=data.get("consciousness"),
        blood_pressure=data.get("blood_pressure"),
        pulse=data.get("pulse"),
        spo2=data.get("spo2"),
        gcs=data.get("gcs"),
        complaint=data.get("complaint"),
        medical_history=data.get("medical_history"),
        intervention=data.get("intervention"),
        medication=data.get("medication"),
        doctor_id=data.get("doctor_id"),
        notes=data.get("notes"),
        disposition=data.get("disposition"),
        status="ACTIVE"
    )

    db.session.add(case)
    db.session.commit()

    return jsonify({
        "message": "Emergency case saved",
        "case_id": case.case_id
    }), 201