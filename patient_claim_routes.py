from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request, session
from sqlalchemy.exc import IntegrityError

from extensions import db
from models.patient import Patient, Visit
from models.patient_claim import PatientClaim


patient_claim_bp = Blueprint("patient_claims", __name__, url_prefix="/api/patient-claims")
CLAIM_LEASE = timedelta(minutes=15)
ALLOWED_MODULES = {
    "doctor", "nurse", "lab", "pharmacy", "radiology", "theatre",
    "emergency", "triage", "reception", "opd", "accounts",
    "medical-reports", "guidance-counseling", "administration", "procurement",
}


def current_user_id():
    return session.get("user_id")


def normalize_claim_module(value):
    module = str(value or "").strip().lower().replace("_", "-").replace(" ", "-")
    if module.startswith("mod-"):
        module = module[4:]
    aliases = {
        "procurement-officer": "procurement",
        "purchasing": "procurement",
        "purchasing-officer": "procurement",
        "finance": "accounts",
        "finance-officer": "accounts",
        "finance-manager": "accounts",
        "accountant": "accounts",
    }
    return aliases.get(module, module)


@patient_claim_bp.get("")
def list_patient_claims():
    module = normalize_claim_module(request.args.get("module"))
    if module not in ALLOWED_MODULES:
        return jsonify(success=False, error="A valid workspace is required."), 400
    now = datetime.utcnow()
    if not session.get("user_id"):
        return jsonify(success=False, error="Authentication required."), 401
    rows = PatientClaim.query.filter(
        PatientClaim.module == module,
        PatientClaim.expires_at > now,
    ).all()
    user_id = current_user_id()
    return jsonify(success=True, claims=[
        {"patient_id": row.patient_id, "module": row.module, "mine": row.user_id == user_id}
        for row in rows
    ])


@patient_claim_bp.post("")
def claim_patient():
    user_id = current_user_id()
    data = request.get_json(silent=True) or {}
    try:
        patient_id = int(data.get("patient_id"))
    except (TypeError, ValueError):
        return jsonify(success=False, error="A valid patient is required."), 400

    module = normalize_claim_module(data.get("module"))
    if module not in ALLOWED_MODULES:
        return jsonify(success=False, error="Invalid patient workspace."), 400
    patient = Patient.query.filter_by(id=patient_id).first()
    if not user_id:
        return jsonify(success=False, error="Authentication required."), 401
    if not patient or str(patient.status or "").upper() == "MERGED":
        return jsonify(success=False, error="Patient is unavailable."), 404

    now = datetime.utcnow()
    claim = PatientClaim.query.filter_by(patient_id=patient_id, module=module).first()
    if claim and claim.expires_at <= now:
        db.session.delete(claim)
        db.session.flush()
        claim = None

    if claim and claim.user_id != user_id:
        return jsonify(success=False, error="This patient is currently selected by another staff member."), 409

    if claim:
        claim.module = module
        claim.claimed_at = now
        claim.expires_at = now + CLAIM_LEASE
    else:
        db.session.add(PatientClaim(
            patient_id=patient_id,
            user_id=user_id,
            module=module,
            claimed_at=now,
            expires_at=now + CLAIM_LEASE,
        ))
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(success=False, error="This patient was just selected by another staff member. Refresh the queue and choose another patient."), 409
    return jsonify(success=True, patient_id=patient_id, expires_in_seconds=int(CLAIM_LEASE.total_seconds()))


@patient_claim_bp.delete("/<module>/<int:patient_id>")
def release_patient(module, patient_id):
    module = normalize_claim_module(module)
    if module not in ALLOWED_MODULES:
        return jsonify(success=False, error="Invalid patient workspace."), 400
    claim = PatientClaim.query.filter_by(patient_id=patient_id, module=module).first()
    if claim and claim.user_id == current_user_id():
        db.session.delete(claim)
        db.session.commit()
    return jsonify(success=True)
