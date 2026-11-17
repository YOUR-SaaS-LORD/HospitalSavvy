from flask import Blueprint, request, jsonify, session
from datetime import date
import json

from extensions import db
from models.patient import Patient, Visit
from models.triage import TriageRecord
from models.user import User
from models.staff import Staff
from models.hospital import Department, Ward, Service
from models.inventory import InventoryItem, InventoryBatch
from models.clinical import Diagnosis, ClinicalRecord, Referral
from models.billing import HospitalFundDispensing
from models.guidance_counseling import CounselingRecord
from models.radiology import RadiologyRequest, RadiologyResult
from sqlalchemy import or_
from uuid import uuid4

administration_bp = Blueprint(
    "administration",
    __name__,
    url_prefix="/api/admin"
)

@administration_bp.get("/users")
def get_users():
    users = User.query.all()

    return jsonify([
        {
            "id": u.id,
            "username": u.username,
            "role": u.role,
            "status": "Active" if u.is_active else "Inactive"
        }
        for u in users
    ])

@administration_bp.post("/users")
def create_user():
    data = request.get_json() or {}

    user = User(
        username=data["username"],
        password_hash=data["password_hash"],
        role=data["role"]
    )

    db.session.add(user)
    db.session.commit()

    return jsonify({
        "message": "User created successfully",
        "id": user.id
    }), 201

@administration_bp.get("/departments")
def get_departments():
    departments = Department.query.order_by(
        Department.name
    ).all()

    return jsonify([
        {
            "id": d.id,
            "name": d.name
        }
        for d in departments
    ])

@administration_bp.post("/departments")
def add_department():
    data = request.get_json() or {}

    department = Department(
        name=data["name"]
    )

    db.session.add(department)
    db.session.commit()

    return jsonify({
        "message": "Department added",
        "id": department.id
    }), 201

@administration_bp.get("/wards")
def get_wards():
    wards = Ward.query.all()

    return jsonify([
        {
            "id": w.id,
            "name": w.name,
            "capacity": w.capacity
        }
        for w in wards
    ])

@administration_bp.post("/wards")
def add_ward():
    data = request.get_json() or {}

    ward = Ward(
        name=data["name"],
        capacity=data["capacity"]
    )

    db.session.add(ward)
    db.session.commit()

    return jsonify({
        "message": "Ward added",
        "id": ward.id
    }), 201

@administration_bp.post("/services")
def add_service():
    data = request.get_json() or {}

    service = Service(
        name=data["name"],
        fee=data["fee"]
    )

    db.session.add(service)
    db.session.commit()

    return jsonify({
        "message": "Service added",
        "id": service.id
    }), 201

@administration_bp.post("/staff")
def register_staff():
    data = request.get_json() or {}

    staff = Staff(
        staff_id=f"ST-{Staff.query.count() + 1:04d}",
        full_name=data["full_name"],
        department_id=data.get("department_id"),
        role=data["role"],
        shift_status="OFF DUTY"
    )

    db.session.add(staff)
    db.session.commit()

    return jsonify({
        "message": "Staff registered",
        "id": staff.id
    }), 201

@administration_bp.post("/inventory")
def add_inventory():
    data = request.get_json() or {}

    item = InventoryItem(
        item_code=data["item_code"],
        name=data["name"],
        category=data.get("category"),
        quantity=data.get("quantity", 0),
        reorder_level=data.get("reorder_level", 0),
        supplier=data.get("supplier"),
        expiry_date=date.fromisoformat(data["expiry_date"]) if data.get("expiry_date") else None
    )

    db.session.add(item)
    db.session.commit()

    return jsonify({
        "message": "Inventory item added",
        "id": item.id
    }), 201

# ---------------------------------------------------------
# HOSPITAL ADMINISTRATION DATA WINDOWS
# ---------------------------------------------------------
def _require_authenticated_patient_files_user():
    """Require a valid active login for read-only patient file/journey endpoints.

    These two endpoints are shared by Doctor and Hospital Administration views;
    the module role gate must not block the Doctor's Patient Files interface.
    All other administration endpoints retain their existing role checks.
    """
    user_id = session.get("user_id")
    if not user_id:
        return None, (jsonify({"success": False, "error": "Authentication required."}), 401)
    user = User.query.get(user_id)
    if not user or not user.is_active:
        session.clear()
        return None, (jsonify({"success": False, "error": "Active authenticated account required."}), 401)
    return user, None


def _require_hospital_manager(allow_doctor=False):
    user_id = session.get("user_id")
    if not user_id:
        return None, (jsonify({"success": False, "error": "Authentication required."}), 401)
    user = User.query.get(user_id)
    if not user or not user.is_active:
        session.clear()
        return None, (jsonify({"success": False, "error": "Active authenticated account required."}), 401)
    role = str(user.role or "").strip().lower().replace("-", "_").replace(" ", "_")
    allowed_roles = {"system_admin", "hospital_manager"}
    if allow_doctor:
        allowed_roles.update({"doctor", "medical_officer", "clinician"})
    if role not in allowed_roles:
        return None, (jsonify({"success": False, "error": "Hospital administration or doctor access required." if allow_doctor else "Hospital administration access required."}), 403)
    return user, None


@administration_bp.get("/hospital/patients")
def hospital_manager_patients():
    user, error = _require_authenticated_patient_files_user()
    if error:
        return error
    query = str(request.args.get("q") or "").strip()
    role = str(session.get("role") or "").strip().lower().replace("-", "_").replace(" ", "_")
    full_file_role = role in {"doctor", "hospital_manager"}
    patients_query = Patient.query.filter(db.func.upper(db.func.coalesce(Patient.status, "ACTIVE")) != "MERGED")
    if query:
        pattern = f"%{query}%"
        search_terms = [Patient.patient_id.ilike(pattern), Patient.full_name.ilike(pattern)]
        if full_file_role:
            search_terms.append(Patient.phone.ilike(pattern))
        # Also let staff search by the numeric database patient ID as well as the
        # human-facing patient number/code, name, or phone number.
        if query.isdigit():
            search_terms.append(Patient.id == int(query))
        patients_query = patients_query.filter(or_(*search_terms))
    patients = patients_query.order_by(Patient.full_name.asc()).limit(100).all()
    return jsonify({"success": True, "patients": [{"id": p.id, "patient_id": p.patient_id, "full_name": p.full_name, **({"date_of_birth": p.date_of_birth.isoformat() if p.date_of_birth else None, "gender": p.gender, "phone": p.phone} if full_file_role else {})} for p in patients]})


@administration_bp.get("/hospital/operations-summary")
def hospital_manager_operations_summary():
    user, error = _require_hospital_manager()
    if error:
        return error
    from datetime import date
    from sqlalchemy import func

    today = date.today()
    pending_guidance = Referral.query.filter(
        func.lower(Referral.destination).in_(["guidance", "counseling", "counselling"]),
        func.upper(Referral.status).in_(["PENDING", "IN_PROGRESS", "IN PROGRESS"])
    ).count()
    used_today = db.session.query(func.coalesce(func.sum(HospitalFundDispensing.amount), 0)).filter(
        HospitalFundDispensing.fund_date == today,
        func.upper(HospitalFundDispensing.status).in_(["DISPENSED", "COMPLETED", "PAID"])
    ).scalar()
    stock_rows = InventoryItem.query.order_by(InventoryItem.item_name.asc()).all()
    return jsonify({
        "success": True,
        "guidance_workload": pending_guidance,
        "funds_used_today": float(used_today or 0),
        "funds_date": today.isoformat(),
        "stock": [{
            "id": item.id,
            "item_code": item.item_code,
            "item_name": item.item_name,
            "name": item.item_name,
            "category": item.category,
            "valuation_method": item.valuation_method,
            "supplier": item.supplier,
            "quantity": max(0, int(item.quantity or 0)),
            "reorder_level": max(0, int(item.reorder_level or 0)),
            "expiry_date": item.expiry_date.isoformat() if item.expiry_date else None,
            "batches": ([batch.to_dict() for batch in sorted(item.batches, key=lambda b: b.batch_number)] or ([{"batch_number": 1, "quantity_received": max(0, int(item.quantity or 0)), "quantity_remaining": max(0, int(item.quantity or 0)), "expiry_date": item.expiry_date.isoformat() if item.expiry_date else None, "legacy": True}] if int(item.quantity or 0) > 0 else [])),
            "drug_type": item.drug_type,
            "strips_per_box": max(0, int(item.strips_per_box or 0)),
            "loose_strips": max(0, int(item.loose_strips or 0))
        } for item in stock_rows]
    })


@administration_bp.get("/hospital/disease-statistics")
def hospital_disease_statistics():
    user, error = _require_hospital_manager()
    if error:
        return error
    from datetime import datetime, timedelta
    from sqlalchemy import func
    period = str(request.args.get("period") or "3m").lower()
    days = {"1m": 30, "3m": 90, "6m": 183, "1y": 365}.get(period)
    if not days:
        return jsonify({"success": False, "error": "Period must be 1m, 3m, 6m, or 1y."}), 400
    since = datetime.utcnow() - timedelta(days=days)
    diagnosis_expression = func.coalesce(
        func.nullif(func.trim(ClinicalRecord.final_diagnosis), ""),
        func.nullif(func.trim(ClinicalRecord.provisional_diagnosis), ""),
        "Unspecified"
    )
    rows = (db.session.query(diagnosis_expression.label("diagnosis"), func.count(ClinicalRecord.id).label("total"))
            .filter(ClinicalRecord.created_at >= since)
            .filter( or_(ClinicalRecord.final_diagnosis.isnot(None), ClinicalRecord.provisional_diagnosis.isnot(None)))
            .group_by(diagnosis_expression)
            .order_by(func.count(ClinicalRecord.id).desc())
            .limit(20).all())
    # Include any normalized diagnosis rows not represented by a clinical record
    # (for example records imported from an older installation) without counting
    # the newly synchronized diagnosis twice.
    items = {str(row.diagnosis or "Unspecified"): int(row.total or 0) for row in rows}
    clinical_total = sum(items.values())
    total = clinical_total
    if not total:
        legacy_rows = (db.session.query(Diagnosis.diagnosis, func.count(Diagnosis.id).label("total"))
                       .filter(Diagnosis.created_at >= since)
                       .group_by(Diagnosis.diagnosis)
                       .order_by(func.count(Diagnosis.id).desc()).limit(20).all())
        items = {str(row.diagnosis or "Unspecified"): int(row.total or 0) for row in legacy_rows}
        total = sum(items.values())
    ordered = sorted(items.items(), key=lambda pair: pair[1], reverse=True)[:20]
    return jsonify({"success": True, "period": period, "from": since.isoformat(), "to": datetime.utcnow().isoformat(), "total_diagnoses": total, "items": [{"diagnosis": name, "count": count} for name, count in ordered]})


@administration_bp.get("/hospital/patient-journey/<int:patient_id>")
def hospital_patient_journey(patient_id):
    user, error = _require_authenticated_patient_files_user()
    if error:
        return error
    patient = Patient.query.get(patient_id)
    if not patient or str(patient.status or "").upper() == "MERGED":
        return jsonify({"success": False, "error": "Patient not found."}), 404
    from datetime import date, datetime
    from sqlalchemy.sql.sqltypes import Integer, String
    events = []
    scope = str(request.args.get("scope") or "").strip().lower()
    role = str(session.get("role") or user.role or "").strip().lower().replace("-", "_").replace(" ", "_")
    full_history = role in {"doctor", "hospital_manager"} and not scope
    role_scopes = {
        "receptionist": {"reception", "triage"},
        "opd": {"opd", "triage"},
        "nurse": {"nurse", "triage"},
        "labtech": {"lab"},
        "radiologist": {"radiology"},
        "surgeon": {"theatre"},
        "pharmacist": {"pharmacy"},
        "accountant": {"finance"},
        "guidance_counselor": {"guidance-counseling"},
        "counselor": {"guidance-counseling"},
        "secretary": {"secretariat"},
    }
    if not full_history and scope not in role_scopes.get(role, set()):
        return jsonify({"success": False, "error": "Only Doctor and Hospital Manager can view the full patient file; other roles must use their own current-visit file."}), 403

    def iso(value):
        return value.isoformat() if isinstance(value, (datetime, date)) else (str(value) if value is not None else None)

    def recorded_fields(**values):
        """Keep the patient-file display focused on values actually recorded."""
        return {label: value for label, value in values.items() if value is not None and value != ""}

    # Registration, visits, and triage are the beginning of every patient's
    # journey. Build them directly instead of relying on the generic table
    # scanner below, so Hospital Administration and Doctor Patient Files always
    # show these stages with their clinical labels.
    events.append({
        "date": iso(patient.registration_date or patient.created_at),
        "category": "Registration & Patient Profile",
        "details": recorded_fields(
            **{
                "Patient ID": patient.patient_id,
                "Full name": patient.full_name,
                "Date of birth": iso(patient.date_of_birth),
                "Gender": patient.gender,
                "Phone": patient.phone,
                "National ID": patient.national_id,
                "Registration date": iso(patient.registration_date),
                "Current phase": patient.current_phase,
                "Status": patient.status,
            }
        ),
        "record_id": patient.id,
    })

    for visit in Visit.query.filter_by(patient_id=patient.id).order_by(Visit.created_at.asc(), Visit.id.asc()).all():
        events.append({
            "date": iso(visit.created_at),
            "category": "Registration / Visit",
            "details": recorded_fields(
                **{
                    "Visit ID": visit.visit_id,
                    "Visit status": visit.status,
                    "Department": visit.department.name if visit.department else None,
                    "Registered at": iso(visit.created_at),
                }
            ),
            "record_id": visit.id,
        })

    for triage in TriageRecord.query.filter_by(patient_id=patient.id).order_by(TriageRecord.created_at.asc(), TriageRecord.id.asc()).all():
        events.append({
            "date": iso(triage.created_at),
            "category": "Triage Assessment",
            "details": recorded_fields(
                **{
                    "Chief complaint": triage.chief_complaint,
                    "Priority": triage.priority,
                    "Weight": f"{triage.weight} kg" if triage.weight is not None else None,
                    "Height": f"{triage.height} cm" if triage.height is not None else None,
                    "BMI": triage.bmi,
                    "Blood pressure": triage.blood_pressure,
                    "Temperature": f"{triage.temperature} °C" if triage.temperature is not None else None,
                    "Pulse rate": f"{triage.pulse_rate} bpm" if triage.pulse_rate is not None else None,
                    "Respiratory rate": f"{triage.respiratory_rate} /min" if triage.respiratory_rate is not None else None,
                    "Oxygen saturation": f"{triage.oxygen_saturation}%" if triage.oxygen_saturation is not None else None,
                    "Blood sugar": triage.blood_sugar,
                    "Pain score": triage.pain_score,
                    "Allergies": triage.allergies,
                    "Pregnancy status": triage.pregnancy_status,
                    "Glasgow coma scale": triage.gcs,
                    "Fall risk": triage.fall_risk,
                    "Assessed at": iso(triage.created_at),
                }
            ),
            "record_id": triage.id,
        })

    # Include declared patient foreign keys and legacy patient ID/code columns.
    # Some older module tables have no FK constraint, so limiting this scan to
    # declared relationships silently hid those saved records from the file.
    integer_patient_names = {"patient_id", "patient_db_id", "patient_record_id", "patient_fk"}
    code_patient_names = {"patient_id", "patient_code", "hospital_patient_id", "patient_number", "patient_identifier"}
    seen_rows = set()
    for table in db.metadata.sorted_tables:
        if table.name in {Patient.__tablename__, Visit.__tablename__, TriageRecord.__tablename__}:
            continue
        patient_columns = []
        for column in table.columns:
            foreign_keys = {fk.target_fullname for fk in column.foreign_keys}
            name = column.name.lower()
            if "patients.id" in foreign_keys or (
                not foreign_keys and name in integer_patient_names and isinstance(column.type, Integer)
            ) or (
                not foreign_keys and name in code_patient_names and isinstance(column.type, String)
            ):
                patient_columns.append(column)
        if not patient_columns:
            continue
        for column in patient_columns:
            try:
                target = patient.patient_id if isinstance(column.type, String) and column.name.lower() in code_patient_names else patient.id
                query = table.select().where(column == target)
                if "created_at" in table.c:
                    query = query.order_by(table.c.created_at.desc())
                elif "requested_at" in table.c:
                    query = query.order_by(table.c.requested_at.desc())
                rows = db.session.execute(query).mappings().all()
                for row in rows:
                    record = dict(row)
                    row_key = (table.name, tuple(record.get(pk.name) for pk in table.primary_key.columns))
                    if row_key in seen_rows:
                        continue
                    seen_rows.add(row_key)
                    dt = (record.get("created_at") or record.get("requested_at") or record.get("recorded_at")
                          or record.get("consultation_date") or record.get("admitted_at")
                          or record.get("scheduled_at") or record.get("result_date") or record.get("date"))
                    label = table.name.replace("_", " ").title()
                    # Present clinical information as readable labels and values, not database internals.
                    ignored = {c.name for c in patient_columns}
                    ignored.update(pk.name for pk in table.primary_key.columns)
                    ignored.update({"patient_db_id", "patient_record_id", "patient_fk", "user_id", "created_by_id", "updated_by_id"})
                    # The timestamp is already displayed in the card heading;
                    # don't repeat raw database timestamps in the detail fields.
                    ignored.update({"created_at", "updated_at", "requested_at", "recorded_at", "consultation_date", "result_date"})
                    label_overrides = {
                        "surgical_records": "Operating Theatre",
                        "op": "Operating Theatre",
                        "theatre_records": "Operating Theatre",
                        "operation_records": "Operating Theatre",
                        "clinical_records": "Clinical Assessment",
                        "diagnoses": "Diagnosis",
                        "referrals": "Referral",
                        "lab_requests": "Laboratory Request",
                        "lab_results": "Laboratory Result",
                        "radiology_requests": "Radiology Request",
                        "radiology_results": "Radiology Result",
                        "nursing_records": "Nursing Care",
                        "triage_records": "Triage Assessment",
                        "dispensing_records": "Pharmacy / Medication",
                        "pharmacy_dispenses": "Pharmacy / Medication",
                        "department_dispensing": "Pharmacy / Medication",
                        "prescriptions": "Pharmacy / Medication",
                        "visits": "Clinical / OPD",
                        "emergency_cases": "Triage / Emergency",
                        "billings": "Billing & Payments",
                        "medical_reports": "Medical Reports",
                        "doctor_round_notes": "Doctor Rounds",
                        "hms_counseling_records": "Counseling",
                        "counseling_records": "Counseling",
                        "counselling_records": "Counseling",
                        "guidance_counseling_records": "Counseling",
                        "opd_records": "OPD",
                        "opd_visits": "OPD",
                        "patient_visits": "Visits",
                        "visit_records": "Visits",
                        "visit_notes": "Visits",
                        "outpatient_records": "OPD",
                        "lab_records": "Lab",
                        "laboratory_records": "Lab",
                        "laboratory_requests": "Lab",
                        "laboratory_results": "Lab",
                        "radiology_records": "Radiology",
                        "imaging_records": "Radiology",
                        "surgery_records": "Surgical",
                        "surgical_cases": "Surgical",
                        "theatre_cases": "Surgical",
                        "operating_theatre_records": "Surgical",
                        "clinical_assessments": "Clinical",
                        "clinical_notes": "Clinical",
                        "triage_assessments": "Triage",
                        "referral_records": "Referrals",
                    }
                    label = label_overrides.get(table.name, label)
                    human_labels = {
                        "procedure": "Surgical procedure", "operation_notes": "Operation notes",
                        "anaesthesia_type": "Anaesthesia type", "anaesthetist": "Anaesthetist",
                        "surgeon_id": "Surgeon", "doctor_id": "Responsible clinician",
                        "staff_id": "Staff member", "department_id": "Department",
                        "referral_destination": "Referral destination", "referral_notes": "Referral notes",
                        "hpi": "Presenting complaint / history", "past_history": "Past medical history",
                        "examination": "Examination findings", "provisional_diagnosis": "Provisional diagnosis",
                        "differential_diagnosis": "Differential diagnosis", "final_diagnosis": "Final diagnosis",
                        "lab_order": "Laboratory tests ordered", "radiology_order": "Imaging ordered",
                        "status": "Status", "consent": "Consent", "scheduled_at": "Scheduled date and time",
                        "created_at": "Recorded date and time", "requested_at": "Requested date and time",
                        "result": "Result", "findings": "Findings", "notes": "Notes", "treatment": "Treatment",
                        "diagnosis": "Diagnosis", "destination": "Referral destination", "reason": "Reason",
                    }
                    fields = {}
                    for key, value in record.items():
                        if key in ignored or value is None or value == "":
                            continue
                        # Hide raw database foreign keys; where possible resolve them to a real name.
                        actor_key = key.lower() in {"created_by", "updated_by", "responsible_worker", "responsible_person", "recorded_by", "performed_by", "surgeon", "anaesthetist", "nurse", "clinician", "doctor"}
                        if key.endswith("_id") or actor_key:
                            column = table.c.get(key)
                            fk_targets = [fk.target_fullname for fk in column.foreign_keys] if column is not None else []
                            resolved = None
                            for target_name in fk_targets:
                                try:
                                    target_table_name, target_col_name = target_name.split(".", 1)
                                    target_table = db.metadata.tables.get(target_table_name)
                                    if target_table is None:
                                        continue
                                    target_row = db.session.execute(target_table.select().where(target_table.c[target_col_name] == value).limit(1)).mappings().first()
                                    if target_row:
                                        for candidate in ("full_name", "name", "staff_number", "username", "title"):
                                            if candidate in target_row and target_row[candidate]:
                                                resolved = str(target_row[candidate]); break
                                    if resolved:
                                        break
                                except Exception:
                                    db.session.rollback()
                                    continue
                            if not resolved and (key.endswith("_id") or actor_key):
                                # Legacy schemas often store the creator as a plain integer/string
                                # without a declared FK. Resolve it against users/staff rather than
                                # printing the database identifier to clinical staff.
                                for candidate_table_name in ("users", "staff"):
                                    candidate_table = db.metadata.tables.get(candidate_table_name)
                                    if candidate_table is None or "id" not in candidate_table.c:
                                        continue
                                    try:
                                        candidate_rows = []
                                        # Actor IDs are sometimes User IDs while the human name
                                        # lives on the linked Staff row.
                                        if candidate_table_name == "staff" and actor_key and "user_id" in candidate_table.c:
                                            candidate_rows.append(db.session.execute(candidate_table.select().where(candidate_table.c.user_id == value).limit(1)).mappings().first())
                                        candidate_rows.append(db.session.execute(candidate_table.select().where(candidate_table.c.id == value).limit(1)).mappings().first())
                                        for candidate_row in candidate_rows:
                                            if candidate_row:
                                                for candidate in ("full_name", "name", "staff_name", "first_name", "username", "staff_number"):
                                                    if candidate in candidate_row and candidate_row[candidate]:
                                                        resolved = str(candidate_row[candidate]); break
                                            if resolved: break
                                        if resolved: break
                                    except Exception:
                                        db.session.rollback()
                                        continue
                            if resolved:
                                label_key = human_labels.get(key, key[:-3].replace("_", " ").title() if key.endswith("_id") else key.replace("_", " ").title())
                                fields[label_key] = resolved
                            # Never expose opaque numeric IDs if they cannot be resolved.
                            continue
                        display_label = human_labels.get(key, key.replace("_", " ").title())
                        fields[display_label] = iso(value)
                    events.append({"date": iso(dt), "category": label, "details": fields})
            except Exception:
                # One malformed/legacy table should not hide the rest of a patient's history.
                # PostgreSQL marks the entire transaction failed after a statement error;
                # clear that failed read transaction before continuing to other tables.
                db.session.rollback()
                continue
    # These records link to the patient through another row or a case reference,
    # so they are not found by the generic direct-patient-column scan above.
    if scope == "radiology" or full_history:
        try:
            requests = RadiologyRequest.query.filter_by(patient_id=patient.id).all()
        except Exception:
            db.session.rollback()
            requests = []
        for imaging_request in requests:
            try:
                results = RadiologyResult.query.filter_by(request_id=imaging_request.id).order_by(RadiologyResult.created_at.asc()).all()
            except Exception:
                db.session.rollback()
                continue
            for result in results:
                events.append({
                    "date": iso(result.created_at or imaging_request.created_at),
                    "category": "Radiology Result",
                    "details": recorded_fields(
                        Examination=imaging_request.examination,
                        Findings=result.findings,
                        Reported=iso(result.created_at),
                    ),
                    "record_id": result.id,
                })

    if scope == "guidance-counseling" or full_history:
        try:
            counseling_rows = CounselingRecord.query.order_by(CounselingRecord.created_at.asc()).limit(3000).all()
        except Exception:
            db.session.rollback()
            counseling_rows = []
        for counseling in counseling_rows:
            try:
                payload = json.loads(counseling.notes or "{}")
            except (TypeError, ValueError):
                payload = {}
            if not isinstance(payload, dict):
                payload = {}
            patient_refs = {
                str(counseling.client_reference or "").strip().casefold(),
                str(payload.get("patient_id") or "").strip().casefold(),
                str(payload.get("patient_db_id") or "").strip().casefold(),
            }
            patient_code = str(patient.patient_id or "").casefold()
            if (not patient_code or patient_code not in patient_refs) and str(patient.id) not in patient_refs:
                continue
            details = recorded_fields(
                **{
                    "Record type": counseling.record_type,
                    "Case reference": counseling.client_reference,
                    "Client / patient": counseling.client_name,
                    "Record date": iso(counseling.record_date),
                    "Follow-up date": iso(counseling.follow_up_date),
                    "Referral / action": counseling.referral_destination,
                    "Outcome": counseling.outcome,
                }
            )
            for key, value in payload.items():
                if key.lower() in {"patient_id", "patient_db_id", "client_name", "case_label", "reference", "date"}:
                    continue
                if isinstance(value, (str, int, float)) and value != "":
                    details[key.replace("_", " ").title()] = str(value)
            events.append({"date": iso(counseling.record_date or counseling.created_at), "category": "Counseling", "details": details, "record_id": counseling.id})

    events.sort(key=lambda event: event.get("date") or "", reverse=True)

    # Doctor and Hospital Manager receive the full history above. Every other
    # role is limited to its own event categories within the latest active visit.
    # Patient Files are hospital-wide: a user's current heading department must
    # not hide a patient's active visit or block reading/printing that role's file.
    if not full_history:
        current_visit_query = Visit.query.filter(
            Visit.patient_id == patient.id,
            db.func.upper(db.func.coalesce(Visit.status, "WAITING")).notin_(
                ["CANCELLED", "CANCELED", "COMPLETED", "CLOSED", "DISCHARGED", "RESOLVED"]
            ),
        )
        current_visit = current_visit_query.order_by(Visit.id.desc()).first()
        if not current_visit:
            return jsonify({"success": False, "error": "No active current visit was found for this patient."}), 404

        visit_date = current_visit.created_at.date() if current_visit.created_at else date.today()
        through_date = max(date.today(), visit_date)

        category_terms = {
            "triage": ("triage", "emergency"),
            "reception": ("registration", "visit"),
            "opd": ("registration", "visit", "opd"),
            "lab": ("laboratory", "lab ", "lab-"),
            "pharmacy": ("pharmacy", "medication", "prescription", "dispensing"),
            "radiology": ("radiology", "imaging", "radio"),
            "nurse": ("nursing", "nurse"),
            "theatre": ("operating theatre", "surgical", "surgery", "theatre"),
            "finance": ("billing", "payment"),
            "guidance-counseling": ("counsel", "guidance"),
            "secretariat": ("secretariat", "secretariate"),
            "procurement": ("procurement",),
        }[scope]
        selected_events = []
        for event in events:
            category = str(event.get("category") or "").lower()
            if not any(term in category for term in category_terms):
                continue
            if category == "registration & patient profile":
                continue
            if category == "registration / visit" and event.get("record_id") != current_visit.id:
                continue
            raw_event_date = str(event.get("date") or "")
            event_date = raw_event_date[:10]
            if not event_date:
                continue
            try:
                record_date = date.fromisoformat(event_date)
            except ValueError:
                continue
            if "T" in raw_event_date and current_visit.created_at:
                try:
                    record_time = datetime.fromisoformat(raw_event_date.replace("Z", "+00:00")).replace(tzinfo=None)
                    if record_time < current_visit.created_at:
                        continue
                except ValueError:
                    pass
            if visit_date <= record_date <= through_date:
                selected_events.append(event)
        events = selected_events
        return jsonify({
            "success": True,
            "patient": {"id": patient.id, "patient_id": patient.patient_id, "full_name": patient.full_name},
            "current_visit": {
                "id": current_visit.id,
                "reference": current_visit.visit_id,
                "date": current_visit.created_at.isoformat() if current_visit.created_at else None,
                "department": current_visit.department.name if current_visit.department else None,
            },
            "scope": scope,
            "journey": events,
        })
    return jsonify({"success": True, "patient": {"id": patient.id, "patient_id": patient.patient_id, "full_name": patient.full_name}, "journey": events})


@administration_bp.route("/facilitation-funds", methods=["GET", "POST"])
def hospital_fund_dispensings():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"success": False, "error": "Authentication required."}), 401
    user = User.query.get(user_id)
    if not user or not user.is_active:
        session.clear()
        return jsonify({"success": False, "error": "Active authenticated account required."}), 401
    role = str(user.role or "").strip().lower().replace("-", "_").replace(" ", "_")
    admin_roles = {"system_admin", "hospital_manager"}
    accounts_roles = {"accountant", "accounts", "accounts_officer", "finance", "finance_officer"}
    if request.method == "POST" and role not in admin_roles:
        return jsonify({"success": False, "error": "Hospital administration access required."}), 403
    if request.method == "GET" and role not in admin_roles | accounts_roles:
        return jsonify({"success": False, "error": "Accounts access required."}), 403
    from datetime import date
    if request.method == "GET":
        rows = HospitalFundDispensing.query.order_by(HospitalFundDispensing.fund_date.desc(), HospitalFundDispensing.created_at.desc()).limit(1000).all()
        return jsonify({"success": True, "records": [{"id": r.id, "reference": r.reference, "fund_date": r.fund_date.isoformat(), "fund_type": r.fund_type, "recipient": r.recipient, "department": r.department, "amount": float(r.amount or 0), "purpose": r.purpose, "approved_by": r.approved_by, "status": r.status, "notes": r.notes, "created_by": r.created_by, "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]})
    data = request.get_json(silent=True) or {}
    required = ["fund_date", "fund_type", "recipient", "amount", "purpose"]
    missing = [key for key in required if str(data.get(key) or "").strip() == ""]
    if missing:
        return jsonify({"success": False, "error": "Required fields missing: " + ", ".join(missing)}), 400
    try:
        fund_date = date.fromisoformat(str(data["fund_date"]))
        amount = float(data["amount"])
        if amount <= 0:
            raise ValueError("Amount must be greater than zero.")
    except (TypeError, ValueError) as exc:
        return jsonify({"success": False, "error": str(exc) or "Invalid date or amount."}), 400
    record = HospitalFundDispensing(
        reference=f"HFF-{fund_date.year}-{uuid4().hex[:8].upper()}", fund_date=fund_date,
        fund_type=str(data["fund_type"]).strip(), recipient=str(data["recipient"]).strip(),
        department=str(data.get("department") or "").strip() or None, amount=amount,
        purpose=str(data["purpose"]).strip(), approved_by=str(data.get("approved_by") or "").strip() or None,
        # A confirmed administration request must be explicitly dispensed by Accounts.
        status="PENDING",
        notes=str(data.get("notes") or "").strip() or None,
        created_by=str(getattr(user, "username", None) or getattr(user, "id", ""))
    )
    try:
        db.session.add(record)
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"success": False, "error": "Unable to save the fund request. Please retry."}), 409
    return jsonify({"success": True, "message": "Facilitation fund request confirmed.", "id": record.id, "reference": record.reference}), 201


@administration_bp.patch("/facilitation-funds/<int:record_id>/dispense")
def dispense_hospital_fund_request(record_id):
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"success": False, "error": "Authentication required."}), 401
    user = User.query.get(user_id)
    if not user or not user.is_active:
        session.clear()
        return jsonify({"success": False, "error": "Active authenticated account required."}), 401
    role = str(user.role or "").strip().lower().replace("-", "_").replace(" ", "_")
    allowed = {"system_admin", "hospital_manager", "accountant", "accounts", "accounts_officer", "finance", "finance_officer"}
    if role not in allowed:
        return jsonify({"success": False, "error": "Accounts dispensing access required."}), 403
    record = HospitalFundDispensing.query.get_or_404(record_id)
    if str(record.status or "").upper() != "PENDING":
        return jsonify({"success": False, "error": "This fund request has already been processed."}), 409
    record.status = "DISPENSED"
    db.session.commit()
    return jsonify({"success": True, "message": "Fund request marked as dispensed."})
