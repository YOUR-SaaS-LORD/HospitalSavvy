from flask import Blueprint, request, jsonify, session
from datetime import datetime

from extensions import db
from models.patient import Patient, Visit
from models.hospital import Department

patient_bp = Blueprint(
    "patients",
    __name__,
    url_prefix="/api/patients"
)

@patient_bp.get("/")
def get_patients():
    patients = Patient.query.filter(
        db.func.upper(db.func.coalesce(Patient.status, "ACTIVE")) != "MERGED",
    ).order_by(Patient.created_at.desc()).all()

    return jsonify([
        {
            "id": p.id,
            "patient_id": p.patient_id,
            "full_name": p.full_name,
            "date_of_birth": p.date_of_birth.isoformat(),
            "gender": p.gender,
            "phone": p.phone
        }
        for p in patients
    ])

@patient_bp.post("/")
def create_patient():

    data = request.get_json() or {}

    department_id = session.get("department_id")

    if not department_id:
        return jsonify({
            "error": "Department/clinic is required."
        }), 400

    try:
        department_id = int(department_id)
    except (TypeError, ValueError):
        return jsonify({
            "error": "Invalid department ID."
        }), 400

    department = Department.query.get(department_id)

    if not department:
        return jsonify({
            "error": "Selected department does not exist."
        }), 400

    patient = Patient(
        patient_id=f"P-{int(datetime.utcnow().timestamp())}",
        full_name=data["full_name"],
        date_of_birth=datetime.strptime(
            data["date_of_birth"],
            "%Y-%m-%d"
        ).date(),
        gender=data.get("gender", "Other"),
        phone=data["phone"],
        clinic=department.name,
        registration_date=datetime.utcnow(),
        status="ACTIVE",
        current_phase="Triage Queue"
    )

    db.session.add(patient)
    db.session.flush()

    visit = Visit(
        visit_id=f"V-{int(datetime.utcnow().timestamp())}",
        patient_id=patient.id,
        department_id=department.id,
        status="WAITING",
    )

    db.session.add(visit)
    db.session.commit()

    return jsonify({
        "message": "Patient registered successfully",
        "patient_id": patient.patient_id,
        "id": patient.id,
        "visit_id": visit.visit_id,
        "department_id": department.id,
        "department": department.name
    }), 201

@patient_bp.get("/<int:patient_id>")
def get_patient(patient_id):
    patient = Patient.query.get_or_404(patient_id)

    return jsonify({
        "id": patient.id,
        "patient_id": patient.patient_id,
        "full_name": patient.full_name,
        "date_of_birth": patient.date_of_birth.isoformat(),
        "gender": patient.gender,
        "phone": patient.phone
    })

@patient_bp.put("/<int:patient_id>")
def update_patient(patient_id):
    patient = Patient.query.get_or_404(patient_id)

    data = request.get_json() or {}

    patient.full_name = data.get(
        "full_name",
        patient.full_name
    )

    patient.phone = data.get(
        "phone",
        patient.phone
    )

    db.session.commit()

    return jsonify({
        "message": "Patient updated successfully"
    })

@patient_bp.delete("/<int:patient_id>")
def delete_patient(patient_id):
    patient = Patient.query.get_or_404(patient_id)

    db.session.delete(patient)
    db.session.commit()

    return jsonify({
        "message": "Patient deleted successfully"
    })
