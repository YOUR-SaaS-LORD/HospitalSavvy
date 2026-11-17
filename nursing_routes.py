from flask import Blueprint, request, jsonify, session
from datetime import date, datetime

from uuid import uuid4

from extensions import db
from billing_service import record_tariff_charge

from models.nursing import NursingRecord, DoctorRoundNote
from models.clinical import Referral, ClinicalRecord
from models.patient import Patient, Visit
from models.hospital import Bed
from models.user import User
from models.staff import Staff

nursing_bp = Blueprint(
    "nursing",
    __name__,
    url_prefix="/api/nursing"
)


# =========================================================
# REVIEW WORKFLOW HELPERS
# =========================================================

def get_current_staff():
    """
    Resolve the logged-in account to its Staff record.
    Used only for review/report authorization.
    """
    user_id = session.get("user_id")

    if not user_id:
        return None

    user = User.query.get(user_id)

    if not user or not user.is_active:
        return None

    return Staff.query.filter_by(
        user_id=user.id
    ).first()


def staff_has_role(staff, *roles):
    if not staff:
        return False

    staff_role = str(
        staff.role or ""
    ).strip().lower()

    return any(
        role in staff_role
        for role in roles
    )


def patient_in_active_department(patient_id):
    department_id = session.get("department_id")
    return bool(department_id and Visit.query.filter(
        Visit.patient_id == patient_id,
        Visit.department_id == department_id,
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING",
    ).first())


def latest_review_clinical(patient_id):
    return (
        ClinicalRecord.query
        .filter(
            ClinicalRecord.patient_id == patient_id,
            ClinicalRecord.review_date.isnot(None)
        )
        .order_by(
            ClinicalRecord.created_at.desc()
        )
        .first()
    )


def latest_review_report(patient_id):
    return (
        Referral.query
        .filter(
            Referral.patient_id == patient_id,
            Referral.destination == "doctor_review"
        )
        .order_by(
            Referral.created_at.desc()
        )
        .first()
    )


def doctor_response_from_report(report):
    """
    Extract the doctor's latest response from the review report.

    The existing Referral model stores the nursing report and the
    doctor's response together in the notes field, so no database
    schema change is required.
    """
    if not report or not report.notes:
        return None

    notes = str(report.notes)

    for marker in (
        "Doctor instructions:",
        "Doctor authorization:"
    ):
        if marker in notes:
            return notes.split(marker, 1)[1].strip() or None

    return None


def review_state(patient_id):
    """
    Database-derived review state for a patient.

    A review is due when today's date is on or after the
    latest ClinicalRecord.review_date.

    A release is authorized only when the latest report for
    that due review was acknowledged by the doctor.
    """
    clinical = latest_review_clinical(
        patient_id
    )

    review_date = (
        clinical.review_date
        if clinical
        else None
    )

    due = bool(
        review_date
        and date.today() >= review_date
    )

    report = latest_review_report(
        patient_id
    )

    acknowledged_for_due_review = False

    if (
        due
        and report
        and str(report.status).upper() == "ACKNOWLEDGED"
        and report.created_at
    ):
        acknowledged_for_due_review = (
            report.created_at.date() >= review_date
        )

    return {
        "review_date": (
            review_date.isoformat()
            if review_date
            else None
        ),
        "review_due": due,
        "review_report_status": (
            report.status
            if report
            else None
        ),
        "review_report_id": (
            report.id
            if report
            else None
        ),
        "doctor_response": (
            doctor_response_from_report(report)
            if report
            else None
        ),
        "release_authorized": (
            due
            and acknowledged_for_due_review
        )
    }

# =========================================================
# NURSE REFERRALS
# =========================================================

@nursing_bp.get("/referrals")
def nursing_referrals():

    staff = get_current_staff()
    department_id = session.get("department_id")
    if not staff or not department_id:
        return jsonify([]), 200

    referrals = (
        Referral.query
        .filter(
            Referral.destination == "nurse",
            Referral.status == "PENDING"
        )
        .order_by(
            Referral.created_at.asc()
        )
        .all()
    )

    result = []

    for referral in referrals:

        patient = Patient.query.get(
            referral.patient_id
        )

        if not patient:
            continue

        if not patient_in_active_department(patient.id):
            continue

        visit = Visit.query.filter(
            Visit.patient_id == patient.id
        ).order_by(Visit.created_at.desc()).first()
        # Only workers from the department assigned when triage/vitals were
        # recorded can see this patient in their selection queue.
        if not visit or visit.department_id != department_id:
            continue

        result.append({

            "id":
                referral.id,

            "referral_id":
                referral.referral_id,

            "patient_id":
                patient.id,

            "patient_code":
                patient.patient_id,

            "patient_name":
                patient.full_name,

            "destination":
                referral.destination,

            "notes":
                referral.notes,

            "status":
                referral.status,

            "created_at":
                (
                    referral.created_at.isoformat()
                    if referral.created_at
                    else None
                )

        })

    return jsonify(result)

# =========================================================
# AVAILABLE BEDS
# =========================================================

@nursing_bp.get("/beds")
def available_beds():

    beds = (
        Bed.query
        .filter(
            Bed.status == "AVAILABLE"
        )
        .order_by(
            Bed.bed_number.asc()
        )
        .all()
    )

    result = []

    for bed in beds:

        result.append({

            "id":
                bed.id,

            "bed_number":
                bed.bed_number,

            "ward_id":
                bed.ward_id,

            "status":
                bed.status

        })

    return jsonify(result)

# =========================================================
# SAVE NURSING CARE
# =========================================================

@nursing_bp.post("/care")
def save_care():

    data = request.get_json(silent=True) or {}
    patient_id = data.get("patient_id")

    if not patient_id:
        return jsonify({"success": False, "error": "Patient is required."}), 400

    try:
        patient_id = int(patient_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "Valid patient_id is required."}), 400

    patient = Patient.query.get(patient_id)
    if not patient:
        return jsonify({"success": False, "error": "Patient not found."}), 404

    # A patient with any historical nursing record may still be new to
    # inpatient care. Reuse an occupied bed if one exists; otherwise the
    # nurse must select an available bed for this admission/session.
    existing_record = (
        NursingRecord.query
        .filter_by(patient_id=patient.id)
        .order_by(NursingRecord.created_at.desc())
        .first()
    )

    occupied_bed = (
        Bed.query
        .filter(
            Bed.patient_id == patient.id,
            db.func.upper(Bed.status) == "OCCUPIED"
        )
        .first()
    )

    # A new admission occurs only when this patient does not already
    # have an occupied bed. Saving another nursing note is not a new admission.
    new_admission = occupied_bed is None

    bed_id = data.get("bed_id")
    bed = None

    if occupied_bed:
        # Existing inpatient: bed is already assigned; do not require the
        # nurse to select it again, and never move the patient accidentally.
        bed = occupied_bed
        bed_id = occupied_bed.id
    else:
        # No currently occupied bed: this is a new/current admission needing
        # a nurse-selected bed, even if historical nursing records exist.
        if not bed_id:
            return jsonify({
                "success": False,
                "error": "Select an available ward bed for this patient before saving nursing care."
            }), 400

        try:
            bed_id = int(bed_id)
        except (TypeError, ValueError):
            return jsonify({"success": False, "error": "Select a valid ward bed."}), 400

        bed = Bed.query.get(bed_id)
        if not bed:
            return jsonify({"success": False, "error": "Selected bed was not found."}), 404

        if str(bed.status or "").strip().upper() != "AVAILABLE" or bed.patient_id not in (None, patient.id):
            return jsonify({"success": False, "error": "Selected bed is no longer available. Refresh the bed list and select another available bed."}), 409

        bed.patient_id = patient.id
        bed.status = "OCCUPIED"

    patient.current_phase = "Inpatient Ward Care"

    try:
        record = NursingRecord(
            patient_id=patient.id,
            nurse_id=session.get("user_id"),
            assessment=data.get("assessment"),
            nursing_notes=data.get("nursing_notes"),
            care_plan=data.get("care_plan"),
            interventions=data.get("interventions"),
            medication_notes=data.get("medication_notes"),
            patient_response=data.get("patient_response"),
            vital_signs=data.get("vital_signs"),
            shift=data.get("shift"),
            status="active",
            admitted_at=datetime.utcnow() if new_admission else None
        )
        db.session.add(record)
        db.session.flush()
        record_tariff_charge(
            patient.id,
            "nursing_day",
            f"nursing-day:{patient.id}:{datetime.utcnow().date().isoformat()}",
        )

        referral_id = data.get("referral_id")
        if referral_id:
            try:
                referral = Referral.query.get(int(referral_id))
            except (TypeError, ValueError):
                referral = None
            if referral and referral.patient_id == patient.id and referral.destination == "nurse":
                referral.status = "COMPLETED"

        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Nursing care saved successfully.",
            "patient_id": patient.id,
            "phase": patient.current_phase,
            "bed_id": bed.id,
            "record_id": record.id
        }), 201

    except Exception as error:
        db.session.rollback()
        print("SAVE NURSING CARE ERROR:", repr(error))
        return jsonify({"success": False, "error": "Unable to save nursing care. " + str(error)}), 422

# =========================================================
# INPATIENT WARD CARE
# =========================================================

@nursing_bp.get("/inpatient")
def inpatient_patients():

    department_id = session.get("department_id")
    if not department_id:
        return jsonify([])
    department_patients = db.session.query(Visit.patient_id).filter(
        Visit.department_id == department_id,
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING",
    )

    beds = (
        Bed.query
        .filter(
            Bed.status == "OCCUPIED",
            Bed.patient_id.isnot(None),
            Bed.patient_id.in_(department_patients),
        )
        .order_by(
            Bed.bed_number.asc()
        )
        .all()
    )

    result = []

    for bed in beds:

        patient = Patient.query.get(
            bed.patient_id
        )

        if not patient:
            continue

        latest_record = (
            NursingRecord.query
            .filter_by(
                patient_id=patient.id
            )
            .order_by(
                NursingRecord.created_at.desc()
            )
            .first()
        )

        current_review = review_state(
            patient.id
        )
        round_notes = (
            DoctorRoundNote.query
            .filter_by(patient_id=patient.id)
            .order_by(DoctorRoundNote.created_at.desc(), DoctorRoundNote.id.desc())
            .limit(100)
            .all()
        )

        result.append({

            "patient_id":
                patient.id,

            "patient_code":
                patient.patient_id,

            "patient_name":
                patient.full_name,

            "phase":
                patient.current_phase,

            "bed_id":
                bed.id,

            "bed_number":
                bed.bed_number,

            "latest_nursing_record":
                (
                    latest_record.created_at.isoformat()
                    if (
                        latest_record
                        and latest_record.created_at
                    )
                    else None
                ),

            "review_date":
                current_review["review_date"],

            "review_due":
                current_review["review_due"],

            "review_report_status":
                current_review["review_report_status"],

            "review_report_id":
                current_review["review_report_id"],

            "doctor_response":
                current_review["doctor_response"],

            "release_authorized":
                current_review["release_authorized"],

            "round_notes": [{
                "id": note.id,
                "doctor_name": note.doctor.full_name if note.doctor else "Doctor",
                "comment": note.note,
                "created_at": note.created_at.isoformat() if note.created_at else None
            } for note in round_notes]

        })

    return jsonify(result)

# =========================================================
# NURSING RECORD HISTORY
# =========================================================

@nursing_bp.get(
    "/patient/<int:patient_id>"
)
def patient_care(patient_id):

    records = (
        NursingRecord.query
        .filter_by(
            patient_id=patient_id
        )
        .order_by(
            NursingRecord.created_at.desc()
        )
        .all()
    )

    return jsonify([

        {

            "id":
                record.id,

            "assessment":
                record.assessment,

            "care_plan":
                record.care_plan,

            "interventions":
                record.interventions,

            "medication_notes":
                record.medication_notes,

            "patient_response":
                record.patient_response,

            "vital_signs":
                record.vital_signs,

            "shift":
                record.shift,

            "nursing_notes":
                record.nursing_notes,

            "status":
                record.status,

            "created_at":
                (
                    record.created_at.isoformat()
                    if record.created_at
                    else None
                )

        }

        for record in records

    ])

# =========================================================
# NURSE REVIEW REPORT -> DOCTOR
# =========================================================

@nursing_bp.post("/review-report")
def submit_review_report():

    staff = get_current_staff()

    if not staff_has_role(
        staff,
        "nurse"
    ):
        return jsonify({
            "success": False,
            "error": "Nursing access is required."
        }), 403

    data = request.get_json() or {}

    patient_id = data.get(
        "patient_id"
    )

    try:
        patient_id = int(
            patient_id
        )
    except (TypeError, ValueError):
        return jsonify({
            "success": False,
            "error": "Valid patient_id is required."
        }), 400

    patient = Patient.query.get(
        patient_id
    )

    if not patient:
        return jsonify({
            "success": False,
            "error": "Patient not found."
        }), 404

    report = (
        data.get("report")
        or data.get("nursing_report")
        or ""
    ).strip()

    if not report:
        return jsonify({
            "success": False,
            "error": "Nursing report is required."
        }), 400

    review = latest_review_clinical(patient.id)
    if not review or not review.review_date:
        return jsonify({"success": False, "error": "No doctor review date is scheduled for this patient."}), 400
    if date.today() < review.review_date:
        return jsonify({"success": False, "error": "This patient's review date has not yet arrived."}), 409

    latest_clinical = (ClinicalRecord.query
        .filter(ClinicalRecord.patient_id == patient.id, ClinicalRecord.doctor_id.isnot(None))
        .order_by(ClinicalRecord.created_at.desc()).first())
    if not latest_clinical:
        return jsonify({"success": False, "error": "No doctor is associated with this patient's clinical record."}), 400

    existing_report = latest_review_report(patient.id)
    if (existing_report and str(existing_report.status).upper() == "PENDING"
            and existing_report.created_at and existing_report.created_at.date() >= review.review_date):
        return jsonify({"success": False, "error": "A nursing review report is already awaiting doctor acknowledgement."}), 409

    # Keep this as a doctor-review report, not a patient queue referral. The
    # doctor reviews it in Doctor's Rounds; only explicit authorization enables
    # the nurse's release action.
    review_report = Referral(
        referral_id=f"REV-{patient.id}-{review.review_date.isoformat()}-{uuid4().hex[:10].upper()}",
        patient_id=patient.id,
        doctor_id=latest_clinical.doctor_id,
        destination="doctor_review",
        status="PENDING",
        notes=report
    )
    db.session.add(review_report)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Nursing follow-up report saved for doctor review.",
        "patient_id": patient.id,
        "report_id": review_report.id,
        "status": review_report.status
    }), 201


# =========================================================
# DOCTOR REVIEW REPORT QUEUE
# =========================================================

@nursing_bp.get("/review-reports")
def doctor_review_reports():

    staff = get_current_staff()

    if not staff_has_role(
        staff,
        "doctor",
        "physician"
    ):
        return jsonify({
            "success": False,
            "error": "Doctor access is required."
        }), 403

    reports = (
        Referral.query
        .filter(
            Referral.destination == "doctor_review",
            Referral.status == "PENDING",
            Referral.doctor_id == staff.id
        )
        .order_by(
            Referral.created_at.asc()
        )
        .all()
    )

    result = []

    for report in reports:

        patient = Patient.query.get(
            report.patient_id
        )

        if not patient:
            continue

        clinical = latest_review_clinical(
            patient.id
        )

        result.append({

            "id":
                report.id,

            "referral_id":
                report.referral_id,

            "patient_id":
                patient.id,

            "patient_code":
                patient.patient_id,

            "patient_name":
                patient.full_name,

            "doctor_id":
                report.doctor_id,

            "review_date":
                (
                    clinical.review_date.isoformat()
                    if clinical and clinical.review_date
                    else None
                ),

            "report":
                report.notes,

            "status":
                report.status,

            "created_at":
                (
                    report.created_at.isoformat()
                    if report.created_at
                    else None
                )

        })

    return jsonify({
        "success": True,
        "reports": result
    })


# =========================================================
# DOCTOR ACKNOWLEDGES REVIEW REPORT
# THIS IS THE RELEASE AUTHORIZATION
# =========================================================

@nursing_bp.post(
    "/review-reports/<int:report_id>/acknowledge"
)
def acknowledge_review_report(report_id):

    staff = get_current_staff()

    if not staff_has_role(
        staff,
        "doctor",
        "physician"
    ):
        return jsonify({
            "success": False,
            "error": "Doctor access is required."
        }), 403

    report = Referral.query.get(
        report_id
    )

    if not report:
        return jsonify({
            "success": False,
            "error": "Review report not found."
        }), 404

    if report.destination != "doctor_review":
        return jsonify({
            "success": False,
            "error": "This referral is not a doctor review report."
        }), 400

    if report.status != "PENDING":
        return jsonify({
            "success": False,
            "error": "This review report has already been acted on."
        }), 409

    if report.doctor_id != staff.id:
        return jsonify({
            "success": False,
            "error": "This review report is assigned to another doctor."
        }), 403

    patient = Patient.query.get(
        report.patient_id
    )

    if not patient:
        return jsonify({
            "success": False,
            "error": "Patient not found."
        }), 404

    clinical = latest_review_clinical(
        patient.id
    )

    if not clinical or not clinical.review_date:
        return jsonify({
            "success": False,
            "error": "No active doctor review date was found."
        }), 400

    if not report.created_at:
        return jsonify({
            "success": False,
            "error": "The report creation date is missing."
        }), 409

    data = request.get_json(silent=True) or {}

    if report.created_at.date() < clinical.review_date:
        return jsonify({
            "success": False,
            "error": "This report does not belong to the current review."
        }), 409

    decision = str(
        data.get("decision") or ""
    ).strip().lower()

    doctor_note = data.get(
        "acknowledgement"
    )

    doctor_note = (
        doctor_note.strip()
        if isinstance(doctor_note, str)
        else ""
    )

    if decision not in (
        "authorize_release",
        "instructions"
    ):
        return jsonify({
            "success": False,
            "error": (
                "Doctor decision is required. "
                "Choose authorize_release or instructions."
            )
        }), 400

    if not doctor_note:
        return jsonify({
            "success": False,
            "error": (
                "Enter the doctor's authorization or instructions "
                "before submitting the decision."
            )
        }), 400

    next_review_date = None
    if decision == "instructions":
        raw_review_date = str(data.get("review_date") or "").strip()
        if not raw_review_date:
            return jsonify({
                "success": False,
                "error": "A next review date is required when keeping the patient under nursing care."
            }), 400
        try:
            next_review_date = datetime.strptime(
                raw_review_date, "%Y-%m-%d"
            ).date()
        except ValueError:
            return jsonify({
                "success": False,
                "error": "Enter a valid next review date."
            }), 400

    # -----------------------------------------------------
    # TWO POSSIBLE DOCTOR DECISIONS
    #
    # 1. authorize_release -> nurse may release the patient for discharge
    # 2. instructions      -> patient remains under nursing care; set next review
    #
    # Reaching the review date alone NEVER changes release
    # authorization.
    # -----------------------------------------------------

    if decision == "authorize_release":

        report.status = "ACKNOWLEDGED"

        report.notes = (
            f"{report.notes or ''}\n\n"
            f"Doctor authorization: {doctor_note}"
        )

        message = (
            "Patient authorized for discharge. "
            "The nurse may now release the patient for discharge processing."
        )

        release_authorized = True

    else:

        clinical.review_date = next_review_date

        report.status = "INSTRUCTIONS"

        report.notes = (
            f"{report.notes or ''}\n\n"
            f"Doctor instructions: {doctor_note}"
        )

        message = (
            "Doctor instructions sent to nursing. "
            "The patient must remain under nursing care."
        )

        release_authorized = False

    db.session.commit()

    return jsonify({
        "success": True,
        "message": message,
        "patient_id": patient.id,
        "report_id": report.id,
        "status": report.status,
        "decision": decision,
        "doctor_response": doctor_note,
        "review_date": clinical.review_date.isoformat() if clinical.review_date else None,
        "release_authorized": release_authorized
    }), 200


# =========================================================
# RELEASE FROM INPATIENT WARD TO OPD
# =========================================================

@nursing_bp.post(
    "/release-to-opd/<int:patient_id>"
)
def release_to_opd(patient_id):

    try:

        # -------------------------------------------------
        # FIND PATIENT
        # -------------------------------------------------

        patient = Patient.query.get(
            patient_id
        )

        if not patient:

            return jsonify({
                "success": False,
                "error":
                    "Patient not found."
            }), 404

        # -------------------------------------------------
        # FIND CURRENT OCCUPIED BED
        # -------------------------------------------------

        bed = (
            Bed.query
            .filter(
                Bed.patient_id == patient.id,
                Bed.status == "OCCUPIED"
            )
            .first()
        )

        if not bed:

            return jsonify({
                "success": False,
                "error":
                    "No occupied bed was found for this patient."
            }), 404

        # -------------------------------------------------
        # FIND THE DOCTOR WHO HANDLED THE PATIENT
        #
        # ClinicalRecord stores doctor_id.
        # We use the most recent clinical record that
        # actually has a doctor assigned.
        # -------------------------------------------------

        latest_clinical = (
            ClinicalRecord.query
            .filter(
                ClinicalRecord.patient_id == patient.id,
                ClinicalRecord.doctor_id.isnot(None)
            )
            .order_by(
                ClinicalRecord.created_at.desc()
            )
            .first()
        )

        if not latest_clinical:

            return jsonify({
                "success": False,
                "error":
                    "No doctor is associated with this patient's clinical record."
            }), 400

        doctor_id = (
            latest_clinical.doctor_id
        )

        # -------------------------------------------------
        # REVIEW-DATE RELEASE CONTROL
        #
        # If the latest doctor review date has arrived,
        # the nurse MUST have a doctor-acknowledged review
        # report before this endpoint can release the patient.
        #
        # This is enforced here on the server, not only in JS.
        # -------------------------------------------------

        current_review = review_state(
            patient.id
        )

        if current_review["review_due"]:

            review_report = latest_review_report(
                patient.id
            )

            active_review = latest_review_clinical(
                patient.id
            )

            if (
                not review_report
                or str(review_report.status).upper()
                != "ACKNOWLEDGED"
                or not review_report.created_at
                or not active_review
                or not active_review.review_date
                or review_report.created_at.date()
                < active_review.review_date
            ):

                return jsonify({
                    "success": False,
                    "error":
                        "Doctor authorization is required before this patient can be released to Accounts.",
                    "review_due": True,
                    "review_date":
                        current_review["review_date"],
                    "review_report_status":
                        current_review["review_report_status"],
                    "release_authorized": False
                }), 403

        # -------------------------------------------------
        # CREATE OPD REFERRAL
        # -------------------------------------------------

        opd_referral = Referral(

            referral_id=
                f"OPD-{patient.id}-{uuid4().hex[:12].upper()}",

            patient_id=
                patient.id,

            doctor_id=
                doctor_id,

            destination=
                "op",

            status=
                "PENDING",

            notes=(
                "Patient released from inpatient "
                    "nursing care to Accounts for discharge."
            )

        )

        db.session.add(
            opd_referral
        )

        # -------------------------------------------------
        # RELEASE BED
        # -------------------------------------------------

        bed.patient_id = None

        bed.status = "AVAILABLE"

        # -------------------------------------------------
        # COMPLETE ALL ACTIVE NURSING SESSIONS
        #
        # DO NOT DELETE THEM.
        # They remain as historical sessions.
        # -------------------------------------------------

        release_time = datetime.utcnow()

        active_nursing_records = (
            NursingRecord.query
            .filter(
                NursingRecord.patient_id == patient.id,
                NursingRecord.status == "active"
            )
            .all()
        )

        for nursing_record in active_nursing_records:
            nursing_record.status = "completed"
            nursing_record.released_to_opd_at = release_time

        # -------------------------------------------------
        # MOVE PATIENT TO OPD
        # -------------------------------------------------

        patient.current_phase = (
            "OPD Discharge"
        )

        # -------------------------------------------------
        # SAVE EVERYTHING
        # -------------------------------------------------

        db.session.commit()

        return jsonify({

            "success":
                True,

            "message":
                "Patient released from inpatient ward to Accounts.",

            "patient_id":
                patient.id,

            "phase":
                patient.current_phase,

            "referral_id":
                opd_referral.id

        }), 200

    except Exception as error:

        db.session.rollback()

        print(
            "RELEASE TO OPD ERROR:",
            repr(error)
        )

        return jsonify({

            "success":
                False,

            "error":
                str(error)

        }), 422
