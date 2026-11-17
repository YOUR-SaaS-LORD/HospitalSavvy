"""Flask routes for Guidance & Counseling records."""
from flask import Blueprint, current_app, jsonify, request
from extensions import db
from billing_service import record_tariff_charge
from routes.office_helper_routes import actor, json_body, json_error, parse_date, require_roles
from models.guidance_counseling import CounselingRecord
from models.clinical import Referral
from models.patient import Patient
from datetime import datetime
from sqlalchemy import func, or_

guidance_bp=Blueprint("guidance_counseling_api",__name__,url_prefix="/api/office/guidance")
ROLES={"guidance_counselor","counselor"}

@guidance_bp.get("/health")
@require_roles(ROLES)
def health(): return jsonify(success=True,module="guidance-counseling")

@guidance_bp.get("/patients")
@require_roles(ROLES)
def list_guidance_patients():
    query=str(request.args.get("q") or "").strip()
    patients=Patient.query.filter(func.upper(func.coalesce(Patient.status,"ACTIVE"))!="MERGED")
    if query:
        pattern=f"%{query}%"
        patients=patients.filter(or_(Patient.patient_id.ilike(pattern),Patient.full_name.ilike(pattern),Patient.phone.ilike(pattern)))
    rows=patients.order_by(Patient.full_name.asc()).limit(1000).all()
    return jsonify(success=True,patients=[{"id":p.id,"patient_id":p.patient_id,"full_name":p.full_name,"phone":p.phone or "","clinic":p.clinic or ""} for p in rows])

@guidance_bp.get("/referrals")
@require_roles(ROLES)
def list_doctor_referrals():
    rows = (db.session.query(Referral, Patient)
            .join(Patient, Patient.id == Referral.patient_id)
            .filter(func.lower(Referral.destination).in_(["guidance", "counseling", "counselling"]))
            .filter(func.upper(Referral.status).in_(["PENDING", "IN_PROGRESS", "IN PROGRESS", "COMPLETED"]))
            .order_by(Referral.created_at.desc(), Referral.id.desc()).all())
    return jsonify(success=True, referrals=[{
        "id": referral.id, "reference": referral.referral_id,
        "patient_db_id": patient.id,
        "patient_id": patient.patient_id, "patient_name": patient.full_name,
        "notes": referral.notes or "", "status": referral.status,
        "created_at": referral.created_at.isoformat() if referral.created_at else None
    } for referral, patient in rows])

@guidance_bp.patch("/referrals/<int:referral_id>")
@require_roles(ROLES)
def update_doctor_referral(referral_id):
    referral = db.session.get(Referral, referral_id)
    if not referral or str(referral.destination or "").lower() not in {"guidance", "counseling", "counselling"}:
        return json_error("Guidance referral not found.", 404)
    status = str((json_body().get("status") or "")).strip().upper().replace(" ", "_")
    if status not in {"IN_PROGRESS", "COMPLETED"}:
        return json_error("Status must be In Progress or Completed.")
    referral.status = status
    patient = db.session.get(Patient, referral.patient_id)
    if patient and status == "IN_PROGRESS":
        patient.current_phase = "Guidance & Counseling In Progress"
        record_tariff_charge(patient.id, "guidance", f"guidance:{referral.id}")
    if status == "COMPLETED":
        referral.completed_at = datetime.utcnow()
        if patient and patient.current_phase in {"Guidance & Counseling Queue", "Guidance & Counseling In Progress"}:
            patient.current_phase = "Guidance & Counseling Completed"
    db.session.commit()
    return jsonify(success=True, referral_id=referral.id, status=referral.status)

@guidance_bp.get("/counseling")
@require_roles(ROLES)
def list_records():
    view=request.args.get("view","")
    if view=="summary":
        records=CounselingRecord.query.all()
        return jsonify(success=True,summary={"total":len(records),"intakes":sum(r.record_type.lower()=="intake" for r in records),"sessions":sum(r.record_type.lower() in {"counseling session","session"} for r in records),"followups":sum(r.record_type.lower()=="follow-up" for r in records),"referrals":sum(r.record_type.lower()=="referral" for r in records)})
    q=CounselingRecord.query; kind=request.args.get("kind","").strip().lower()
    kinds={"intake":"Intake","sessions":"Counseling Session","follow-up":"Follow-up","resources":"Resource","guidance":"Guidance","referral":"Referral"}
    if kind in kinds: q=q.filter_by(record_type=kinds[kind])
    rows=q.order_by(CounselingRecord.record_date.desc(),CounselingRecord.id.desc()).all()
    return jsonify(success=True,records=[r.to_dict() for r in rows])

@guidance_bp.post("/counseling")
@require_roles(ROLES)
def create_record():
    try:
        data=json_body(); reference=str(data.get("client_reference") or "").strip(); name=str(data.get("client_name") or "").strip(); kind=str(data.get("record_type") or "Intake").strip(); notes=str(data.get("notes") or "").strip()
        if not reference or not name or not notes: return json_error("Client reference, client name, and notes are required.")
        if len(reference)>100 or len(name)>200: return json_error("Client reference or name is too long.")
        r=CounselingRecord(client_reference=reference,client_name=name,record_type=kind,record_date=parse_date(data.get("record_date")),follow_up_date=parse_date(data.get("follow_up_date"),optional=True),referral_destination=str(data.get("referral_destination") or "").strip() or None,notes=notes,outcome=str(data.get("outcome") or "").strip(),created_by=actor())
        db.session.add(r); db.session.commit(); return jsonify(success=True,record=r.to_dict()),201
    except ValueError as exc: db.session.rollback(); return json_error(str(exc))
    except Exception: db.session.rollback(); current_app.logger.exception("Unable to save counseling record"); return json_error("Unable to save the counseling record.",500)

@guidance_bp.get("/counseling/<int:record_id>")
@require_roles(ROLES)
def get_record(record_id):
    r=db.session.get(CounselingRecord,record_id)
    if not r: return json_error("Counseling record not found.",404)
    return jsonify(success=True,record=r.to_dict())

@guidance_bp.delete("/counseling/<int:record_id>")
@require_roles(ROLES)
def delete_record(record_id):
    r=db.session.get(CounselingRecord,record_id)
    if not r: return json_error("Counseling record not found.",404)
    db.session.delete(r); db.session.commit(); return jsonify(success=True,message="Counseling record deleted.")
