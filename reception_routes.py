from datetime import datetime
from uuid import uuid4
from sqlalchemy import or_, func
from flask import Blueprint, request, jsonify, session
from extensions import db
from billing_service import record_tariff_charge
from models.patient import Patient, Visit
from models.triage import TriageRecord
from models.clinical import ClinicalRecord
from models.hospital import Department

reception_bp = Blueprint(
    "reception",
    __name__,
    url_prefix="/api/reception"
)


@reception_bp.post("/matches")
def find_patient_matches():
    """Return possible existing patients before registration; national ID is optional."""
    data = request.get_json() or {}
    name = (data.get("full_name") or "").strip()
    dob_raw = (data.get("date_of_birth") or "").strip()
    phone = (data.get("phone") or "").strip()
    national_id = (data.get("national_id") or "").strip() or None
    existing_patient_id = data.get("existing_patient_id")
    national_id = (data.get("national_id") or "").strip()
    if not name or not dob_raw:
        return jsonify({"success": False, "message": "Name and date of birth are required for matching."}), 400
    try:
        dob = datetime.strptime(dob_raw, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"success": False, "message": "Invalid date of birth."}), 400

    normalized_name = " ".join(name.casefold().split())
    query = Patient.query.filter(func.lower(func.trim(Patient.full_name)) == normalized_name)
    candidates = query.filter(Patient.date_of_birth == dob).all()
    if national_id:
        by_id = Patient.query.filter(func.lower(func.trim(Patient.national_id)) == national_id.casefold()).all()
        seen = {p.id for p in candidates}
        candidates.extend(p for p in by_id if p.id not in seen)

    results = []
    for patient in candidates:
        last_visit = Visit.query.filter_by(patient_id=patient.id).order_by(Visit.created_at.desc(), Visit.id.desc()).first()
        triage = TriageRecord.query.filter_by(patient_id=patient.id).order_by(TriageRecord.id.desc()).first()
        clinical = ClinicalRecord.query.filter_by(patient_id=patient.id).order_by(ClinicalRecord.created_at.desc(), ClinicalRecord.id.desc()).first()
        match_reasons = []
        if patient.full_name.casefold().strip() == normalized_name and patient.date_of_birth == dob:
            match_reasons.append("name_and_date_of_birth")
        if national_id and patient.national_id and patient.national_id.casefold().strip() == national_id.casefold():
            match_reasons.append("national_id")
        if phone and patient.phone and patient.phone.strip() == phone:
            match_reasons.append("phone")
        results.append({
            "id": patient.id, "patient_id": patient.patient_id, "full_name": patient.full_name,
            "date_of_birth": patient.date_of_birth.isoformat() if patient.date_of_birth else None,
            "gender": patient.gender, "phone": patient.phone, "national_id": patient.national_id,
            "last_visit_date": last_visit.created_at.isoformat() if last_visit and last_visit.created_at else None,
            "last_chief_complaint": triage.chief_complaint if triage else None,
            "last_diagnosis": ((clinical.final_diagnosis or clinical.provisional_diagnosis or clinical.differential_diagnosis) if clinical else None),
            "visit_count": Visit.query.filter_by(patient_id=patient.id).count(),
            "match_reasons": match_reasons
        })
    results.sort(key=lambda x: ("national_id" in x["match_reasons"], "name_and_date_of_birth" in x["match_reasons"], "phone" in x["match_reasons"]), reverse=True)
    return jsonify({"success": True, "matches": results})

@reception_bp.route("/register", methods=["POST"])
def register_patient():

    data = request.get_json() or {}
    department_id = session.get("department_id")
    department = Department.query.get(department_id) if department_id else None
    if not department:
        return jsonify({"success": False, "message": "Choose a working department when signing in before registering patients."}), 403

    full_name = (data.get("full_name") or "").strip()
    date_of_birth = data.get("date_of_birth") or ""
    gender = (data.get("gender") or "").strip()
    phone = (data.get("phone") or "").strip()
    national_id = (data.get("national_id") or "").strip()
    existing_patient_id = data.get("existing_patient_id")

    if not full_name:
        return jsonify({
            "success": False,
            "message": "Full name is required."
        }), 400

    if not date_of_birth:
        return jsonify({
            "success": False,
            "message": "Date of birth is required."
        }), 400

    if not gender:
        return jsonify({
            "success": False,
            "message": "Gender is required."
        }), 400

    try:

        dob = datetime.strptime(
            date_of_birth,
            "%Y-%m-%d"
        ).date()

        # Returning patient: retain permanent patient record/ID and create only a new visit.
        if existing_patient_id:
            patient = Patient.query.get(int(existing_patient_id))
            if not patient:
                return jsonify({"success": False, "message": "Selected existing patient was not found. Please search again."}), 404
            # Require identity details to agree before reusing a record.
            if patient.date_of_birth != dob or patient.full_name.casefold().strip() != " ".join(full_name.casefold().split()):
                return jsonify({"success": False, "message": "Patient identity details do not match the selected record."}), 409
            if national_id and patient.national_id and patient.national_id.casefold().strip() != national_id.casefold():
                return jsonify({"success": False, "message": "National ID conflicts with the selected patient record. Verify identity before continuing."}), 409
        else:
            if national_id:
                id_match = Patient.query.filter(func.lower(func.trim(Patient.national_id)) == national_id.casefold()).first()
                if id_match:
                    return jsonify({"success": False, "message": "This National ID is already associated with a patient. Review possible matches before registering."}), 409
            patient_id = f"P-{uuid4().hex[:12].upper()}"
            patient = Patient(
                patient_id=patient_id, full_name=full_name, date_of_birth=dob, gender=gender,
                phone=phone, national_id=national_id, registration_date=datetime.utcnow(),
                status="Active", current_phase="Triage Queue", clinic=department.name
            )
            db.session.add(patient)
            db.session.flush()

        # --------------------------------------------------
        # CREATE VISIT
        # --------------------------------------------------

        Visit.query.filter(
            Visit.patient_id == patient.id,
            Visit.status == "WAITING",
        ).update({Visit.status: "COMPLETED"}, synchronize_session=False)

        visit = Visit(
            visit_id=f"V-{uuid4().hex[:12].upper()}",
            patient_id=patient.id,
            status="WAITING",
            department_id=department.id
        )

        patient.clinic = department.name
        patient.current_phase = "Triage Queue"
        patient.assigned_doctor_id = None

        db.session.add(visit)

        # The registration tariff is charged as soon as the visit is created.
        record_tariff_charge(
            patient.id,
            "registration",
            f"registration:{visit.visit_id}",
        )

        db.session.commit()

        return jsonify({
            "success": True,
            "message": (
                ("Returning patient visit created successfully." if existing_patient_id else "Patient registered successfully and sent to Triage Queue.")
            ),
            "patient": {
                "id": patient.id,
                "patient_id": patient.patient_id,
                "full_name": patient.full_name,
                "date_of_birth": (
                    patient.date_of_birth.isoformat()
                ),
                "gender": patient.gender,
                "phone": patient.phone,
                "national_id": patient.national_id,
                "current_phase": patient.current_phase,
                "status": patient.status
            },
            "visit": {
                "id": visit.id,
                "visit_id": visit.visit_id,
                "patient_id": visit.patient_id,
                "status": visit.status,
                "created_at": (
                    visit.created_at.isoformat()
                    if visit.created_at
                    else None
                )
            }
        }), 201

    except ValueError:

        db.session.rollback()

        return jsonify({
            "success": False,
            "message": "Invalid date of birth."
        }), 400

    except Exception as e:

        db.session.rollback()

        return jsonify({
            "success": False,
            "message": "Patient registration failed.",
            "error": str(e)
        }), 500
