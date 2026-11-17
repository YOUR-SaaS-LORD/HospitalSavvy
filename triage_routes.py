from flask import Blueprint, request, jsonify, session
from datetime import datetime

from extensions import db
from billing_service import record_tariff_charge
from models.user import User
from models.staff import Staff
from models.patient import Patient, Visit
from models.hospital import Department
from models.triage import TriageRecord

triage_bp = Blueprint(
    "triage_bp",
    __name__,
    url_prefix="/api/triage"
)


def current_user():
    user_id = session.get("user_id")

    if not user_id:
        return None

    return User.query.get(user_id)


def serialize_triage(record):
    return {
        "id": record.id,
        "patient_id": record.patient_id,
        "weight": record.weight,
        "height": record.height,
        "bmi": record.bmi,
        "blood_pressure": record.blood_pressure,
        "temperature": record.temperature,
        "pulse": record.pulse_rate,
        "respiratory_rate": record.respiratory_rate,
        "spo2": record.oxygen_saturation,
        "blood_sugar": record.blood_sugar,
        "pain_score": record.pain_score,
        "chief_complaint": record.chief_complaint,
        "allergies": record.allergies,
        "pregnancy_status": record.pregnancy_status,
        "gcs": record.gcs,
        "fall_risk": record.fall_risk,
        "priority": record.priority,
        "created_at": (
            record.created_at.isoformat()
            if record.created_at
            else None
        )
    }


@triage_bp.get("/doctors")
def doctors_for_department():
    if not current_user():
        return jsonify({
            "success": False,
            "error": "Authentication required."
        }), 401

    department_id = request.args.get(
        "department_id",
        type=int
    )

    if not department_id:
        return jsonify({
            "success": False,
            "error": "department_id is required."
        }), 400

    doctors = Staff.query.filter(
        Staff.department_id == department_id,
        db.func.lower(Staff.role).like("%doctor%"),
        db.func.upper(Staff.status) == "ON DUTY"
    ).order_by(
        Staff.full_name.asc()
    ).all()

    return jsonify({
        "success": True,
        "doctors": [
            {
                "id": doctor.id,
                "staff_number": doctor.staff_number,
                "full_name": doctor.full_name,
                "department_id": doctor.department_id
            }
            for doctor in doctors
        ]
    })


@triage_bp.post("/")
def save_triage():
    user = current_user()

    if not user:
        return jsonify({
            "success": False,
            "error": "Authentication required."
        }), 401

    data = request.get_json(silent=True) or {}

    patient_id = data.get("patient_id")

    try:
        patient_id = int(patient_id)
    except (TypeError, ValueError):
        return jsonify({
            "success": False,
            "error": "Valid patient_id is required."
        }), 400

    patient = Patient.query.get(patient_id)

    if not patient:
        return jsonify({
            "success": False,
            "error": "Patient not found."
        }), 404

    active_department_id = session.get("department_id")
    if not active_department_id:
        return jsonify({
            "success": False,
            "error": "Choose a working department when signing in."
        }), 403
    source_visit = Visit.query.filter(
        Visit.patient_id == patient.id,
        Visit.department_id == active_department_id,
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING",
    ).first()
    if not source_visit:
        return jsonify({
            "success": False,
            "error": "This patient is not assigned to your selected department."
        }), 403

    department_id = data.get("department_id")

    try:
        department_id = int(department_id)
    except (TypeError, ValueError):
        department_id = None

    if not department_id:
        return jsonify({
            "success": False,
            "error": "Assigned department is required."
        }), 400

    department = Department.query.get(
        department_id
    )

    if not department:
        return jsonify({
            "success": False,
            "error": "Assigned department does not exist."
        }), 400

    assigned_doctor_id = data.get(
        "assigned_doctor_id"
    )

    if assigned_doctor_id in ("", None):
        assigned_doctor_id = None
    else:
        try:
            assigned_doctor_id = int(
                assigned_doctor_id
            )
        except (TypeError, ValueError):
            return jsonify({
                "success": False,
                "error": "Invalid assigned doctor."
            }), 400

    doctor = None

    if assigned_doctor_id:
        doctor = Staff.query.get(
            assigned_doctor_id
        )

        if not doctor:
            return jsonify({
                "success": False,
                "error": "Assigned doctor not found."
            }), 400

        doctor_role = str(
            doctor.role or ""
        ).strip().lower()

        if "doctor" not in doctor_role:
            return jsonify({
                "success": False,
                "error": "Selected staff member is not a doctor."
            }), 400

        if (
            doctor.department_id != department.id
            or str(doctor.status or "").strip().upper() != "ON DUTY"
        ):
            return jsonify({
                "success": False,
                "error": "Doctor is not currently working in the selected department."
            }), 400

    # =========================================================
    # CALCULATE BMI
    # =========================================================

    weight = data.get("weight")
    height = data.get("height")

    bmi = None

    try:
        if weight is not None and height is not None:
            weight_value = float(weight)
            height_value = float(height)

            if height_value > 0:
                height_m = height_value / 100
                bmi = round(
                    weight_value / (height_m * height_m),
                    2
                )

    except (TypeError, ValueError, ZeroDivisionError):
        bmi = None
    # =========================================================
    # CREATE TRIAGE RECORD
    # =========================================================

    record = TriageRecord(

        patient_id=patient_id,

        weight=weight,

        height=height,

        bmi=bmi,

        blood_pressure=data.get("blood_pressure"),

        temperature=data.get("temperature"),

        pulse_rate=data.get("pulse"),

        respiratory_rate=data.get("respiratory_rate"),

        oxygen_saturation=data.get("spo2"),

        blood_sugar=data.get("blood_sugar"),

        pain_score=data.get("pain_score"),

        chief_complaint=data.get("chief_complaint"),

        allergies=data.get("allergies"),

        pregnancy_status=data.get("pregnancy"),

        gcs=data.get("gcs"),

        fall_risk=data.get("fall_risk"),

         priority=data.get("priority")
    )    
# The active visit is the department-routing record.
    visit = Visit.query.filter(
        Visit.patient_id == patient.id,
        Visit.status == "WAITING"
    ).order_by(
        Visit.created_at.desc()
    ).first()

    if not visit:
        visit = Visit(
            visit_id=f"V-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}",
            patient_id=patient.id,
            status="WAITING"
        )
        db.session.add(visit)

    visit.department_id = department.id

    patient.clinic = department.name
    patient.current_phase = "Doctor Queue"
    patient.current_priority = data.get(
        "priority"
    )
    patient.assigned_doctor_id = (
        doctor.id
        if doctor
        else None
    )

    try:
        db.session.add(record)
        db.session.flush()
        record_tariff_charge(patient.id, "triage", f"triage:{record.id}")
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({
            "success": False,
            "error": str(exc)
        }), 500

    return jsonify({
        "success": True,
        "message": "Triage saved and patient routed to Doctor Queue.",
        "patient": patient.to_dict(),
        "triage": serialize_triage(record),
        "department": {
            "id": department.id,
            "name": department.name
        },
        "doctor": (
            {
                "id": doctor.id,
                "name": doctor.full_name
            }
            if doctor
            else None
        )
    }), 201


@triage_bp.get("/queue")
def triage_queue():
    user = current_user()

    if not user:
        return jsonify({
            "success": False,
            "error": "Authentication required."
        }), 401

    department_id = session.get("department_id")
    if not department_id:
        return jsonify({"success": True, "patients": []})

    assigned_patients = db.session.query(Visit.patient_id).filter(
        Visit.department_id == department_id,
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING",
    )
    patients = Patient.query.filter(
        Patient.current_phase == "Triage Queue",
        Patient.id.in_(assigned_patients),
    ).order_by(
        Patient.created_at.asc()
    ).all()

    return jsonify({
        "success": True,
        "patients": [
            patient.to_dict()
            for patient in patients
        ]
    })

@triage_bp.get("/patient/<int:patient_id>")
def patient_triage(patient_id):
    user = current_user()

    if not user:
        return jsonify({
            "success": False,
            "error": "Authentication required."
        }), 401

    record = TriageRecord.query.filter_by(
        patient_id=patient_id
    ).order_by(
        TriageRecord.created_at.desc()
    ).first()

    return jsonify({
        "success": True,
        "triage": (
            serialize_triage(record)
            if record
            else None
        )
    })
