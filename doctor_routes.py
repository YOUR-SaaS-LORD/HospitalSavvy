from flask import Blueprint, request, jsonify, session
from datetime import datetime, date
import re

from extensions import db
from models.user import User
from models.staff import Staff
from models.patient import Patient, Visit
from models.triage import TriageRecord
from models.clinical import ClinicalRecord, Referral, Diagnosis
from models.radiology import RadiologyRequest, RadiologyResult
from models.lab import LabRequest, LabResult
from models.pharmacy import Prescription
from models.nursing import NursingRecord
from models.nursing import DoctorRoundNote
from models.hospital import Bed
from billing_service import record_tariff_charge

doctor_bp = Blueprint(
    "doctor_bp",
    __name__,
    url_prefix="/api/doctor"
)

# =========================================================
# CURRENT LOGGED-IN DOCTOR
# =========================================================

def get_current_doctor():

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
                "error": "This account is not linked to a Staff record."
            }),
            403
        )

    staff_role = str(staff.role or "").strip().lower().replace("-", "_").replace(" ", "_")
    account_role = str(session.get("role") or user.role or "").strip().lower().replace("-", "_").replace(" ", "_")
    doctor_roles = {"doctor", "physician", "medical_officer", "clinician"}

    if not (any(token in staff_role for token in ("doctor", "physician")) or account_role in doctor_roles):
        return None, (
            jsonify({
                "success": False,
                "error": "Doctor access is required."
            }),
            403
        )

    if not session.get("department_id"):
        return None, (
            jsonify({
                "success": False,
                "error": "Choose a working department when signing in."
            }),
            403
        )

    return staff, None


# =========================================================
# DOCTOR PATIENT QUEUE
# DATABASE IS THE SOURCE OF TRUTH
# =========================================================

def doctor_patient_query(doctor):

    # -----------------------------------------------------
    # COMPLETED LABORATORY REQUESTS FOR THIS DOCTOR
    # -----------------------------------------------------

    lab_return_patients = (
        db.session.query(LabRequest.patient_id)
        .filter(
            LabRequest.doctor_id == doctor.id,
            db.func.upper(
                db.func.coalesce(LabRequest.status, "")
            ) == "COMPLETED"
        )
    )

    # -----------------------------------------------------
    # PENDING LABORATORY REQUESTS FOR THIS DOCTOR
    #
    # A patient must not return while any of this doctor's
    # laboratory requests for that patient remain pending.
    # -----------------------------------------------------

    pending_lab_patients = (
        db.session.query(LabRequest.patient_id)
        .filter(
            LabRequest.doctor_id == doctor.id,
            db.func.upper(
                db.func.coalesce(LabRequest.status, "")
            ).notin_([
                "COMPLETED",
                "CANCELLED",
                "CANCELED"
            ])
        )
    )

    # -----------------------------------------------------
    # PENDING RADIOLOGY REQUESTS
    #
    # RadiologyRequest has no doctor_id column, so use
    # patient_id as supported by the existing model.
    # -----------------------------------------------------

    pending_radiology_patients = (
        db.session.query(RadiologyRequest.patient_id)
        .filter(
            db.func.upper(
                db.func.coalesce(RadiologyRequest.status, "")
            ).notin_([
                "COMPLETED",
                "CANCELLED",
                "CANCELED"
            ])
        )
    )

    # -----------------------------------------------------
    # DEPARTMENT ASSIGNMENT
    # -----------------------------------------------------

    department_patients = (
        db.session.query(Visit.patient_id)
        .filter(
            Visit.department_id == session.get("department_id"),
            db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING"
        )
    )

    # -----------------------------------------------------
    # FINAL QUEUE
    # -----------------------------------------------------

    return (
        Patient.query
        .filter(
            Patient.current_phase == "Doctor Queue",

            Patient.id.in_(department_patients),

            ~Patient.id.in_(pending_lab_patients),

            ~Patient.id.in_(pending_radiology_patients)
        )
        .distinct()
    )



# =========================================================
# CHECK WHETHER PATIENT BELONGS TO DOCTOR
# =========================================================

def patient_belongs_to_doctor(patient, doctor):

    if not patient:
        return False

    # -----------------------------------------------------
    # ONLY ALLOW OPENING PATIENTS CURRENTLY IN DOCTOR QUEUE
    # OR PATIENTS STILL ASSIGNED TO THIS DOCTOR'S DEPARTMENT.
    #
    # Completed investigations alone must not authorize
    # access to a patient who has been referred elsewhere.
    # -----------------------------------------------------

    if patient.current_phase != "Doctor Queue":

        # A patient may still be accessed through the
        # department assignment below when appropriate.
        # Do not automatically authorize a referred patient.
        return False

    # -----------------------------------------------------
    # CHECK DEPARTMENT ASSIGNMENT
    # -----------------------------------------------------

    department_visit = (
        Visit.query
        .filter(
            Visit.patient_id == patient.id,
            Visit.department_id == session.get("department_id"),
            db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING"
        )
        .first()
    )

    if department_visit:
        return True

    # -----------------------------------------------------
    # CHECK COMPLETED LABORATORY RETURN
    # -----------------------------------------------------

    completed_lab = (
        LabRequest.query
        .filter(
            LabRequest.patient_id == patient.id,
            LabRequest.doctor_id == doctor.id,
            db.func.upper(
                db.func.coalesce(LabRequest.status, "")
            ) == "COMPLETED"
        )
        .first()
    )

    if completed_lab:
        return True

    # -----------------------------------------------------
    # CHECK COMPLETED RADIOLOGY RETURN
    #
    # RadiologyRequest has no doctor_id column.
    # The patient must be in Doctor Queue, and the existing
    # department assignment must not match for this check.
    # -----------------------------------------------------

    completed_radiology = (
        RadiologyRequest.query
        .filter(
            RadiologyRequest.patient_id == patient.id,
            db.func.upper(
                db.func.coalesce(RadiologyRequest.status, "")
            ) == "COMPLETED"
        )
        .first()
    )

    if completed_radiology:
        return True

    return False
    
# =========================================================
# SERIALIZE PATIENT FOR DOCTOR
# =========================================================

def serialize_patient_for_doctor(
    patient,
    doctor
):

    triage = (
        TriageRecord.query
        .filter_by(
            patient_id=patient.id
        )
        .order_by(
            TriageRecord.created_at.desc()
        )
        .first()
    )

    clinical = (
        ClinicalRecord.query
        .filter_by(
            patient_id=patient.id,
            doctor_id=doctor.id
        )
        .order_by(
            ClinicalRecord.created_at.desc()
        )
        .first()
    )

    referrals = (
        Referral.query
        .filter_by(
            patient_id=patient.id
        )
        .order_by(
            Referral.created_at.desc()
        )
        .all()
    )

    # =====================================================
    # LABORATORY REQUESTS / RESULTS
    # =====================================================

    lab_requests = (
        LabRequest.query
        .filter_by(
            patient_id=patient.id
        )
        .order_by(
            LabRequest.requested_at.desc()
        )
        .all()
    )

    laboratory = []

    for lab_request in lab_requests:

        results = (
            LabResult.query
            .filter_by(
                request_id=lab_request.id
            )
            .order_by(
                LabResult.created_at.desc()
            )
            .all()
        )

        result_output = []

        for result in results:

            technician_name = None

            if result.verified_by:

                technician = Staff.query.get(
                    result.verified_by
                )

                if technician:

                    technician_name = (
                        technician.full_name
                    )

            result_output.append({

                "id": result.id,

                "results": (
                    result.results
                ),

                "verification_status": (
                    result.verification_status
                ),

                "technician": (
                    technician_name
                ),

                "verified_by": (
                    result.verified_by
                ),

                "created_at": (
                    result.created_at.isoformat()
                    if result.created_at
                    else None
                )
            })

        laboratory.append({

            "id": lab_request.id,

            "request_id": (
                lab_request.request_id
            ),

            "test_name": (
                lab_request.test_name
            ),

            "sample_type": (
                lab_request.sample_type
            ),

            "barcode": (
                lab_request.barcode
            ),

            "status": (
                lab_request.status
            ),

            "requested_at": (
                lab_request.requested_at.isoformat()
                if lab_request.requested_at
                else None
            ),

            "results": result_output
        })

    # =====================================================
    # PRESCRIPTIONS
    #
    # DATABASE SOURCE OF TRUTH
    #
    # ACTUAL PRESCRIPTION COLUMNS:
    #
    # id
    # patient_id
    # doctor_id
    # drug_name
    # frequency
    # duration
    # status
    # created_at
    #
    # NO dose
    # NO route
    # NO instructions
    # =====================================================

    prescriptions = (
        Prescription.query
        .filter_by(
            patient_id=patient.id
        )
        .order_by(
            Prescription.created_at.desc()
        )
        .all()
    )

    prescription_output = []

    for prescription in prescriptions:

        prescription_output.append({

            "id": prescription.id,

            "patient_id": (
                prescription.patient_id
            ),

            "doctor_id": (
                prescription.doctor_id
            ),

            "drug_name": (
                prescription.drug_name
            ),

            "frequency": (
                prescription.frequency
            ),

            "duration": (
                prescription.duration
            ),

            "status": (
                prescription.status
            ),

            "created_at": (
                prescription.created_at.isoformat()
                if prescription.created_at
                else None
            ),

            # Frontend compatibility
            "medication_name": (
                prescription.drug_name
            ),

            "prescribed_by": (
                prescription.doctor_id
            )
        })

    # =====================================================
    # RETURN PATIENT DATA
    # =====================================================

    return {

        "id": patient.id,

        "patient_id": patient.patient_id,

        "full_name": patient.full_name,

        "date_of_birth": (
            patient.date_of_birth.isoformat()
            if patient.date_of_birth
            else None
        ),

        "gender": patient.gender,

        "phone": patient.phone,

        "clinic": patient.clinic,

        "current_phase": patient.current_phase,

        "current_priority": patient.current_priority,

        # -------------------------------------------------
        # TRIAGE
        # -------------------------------------------------

        "triage": (

            {
                "weight": triage.weight,

                "height": triage.height,

                "bmi": triage.bmi,

                "blood_pressure": (
                    triage.blood_pressure
                ),

                "temperature": (
                    triage.temperature
                ),

                "pulse": (
                    triage.pulse_rate
                ),

                "respiratory_rate": (
                    triage.respiratory_rate
                ),

                "spo2": (
                    triage.oxygen_saturation
                ),

                "blood_sugar": (
                    triage.blood_sugar
                ),

                "pain_score": (
                    triage.pain_score
                ),

                "chief_complaint": (
                    triage.chief_complaint
                ),

                "allergies": (
                    triage.allergies
                ),

                "pregnancy_status": (
                    triage.pregnancy_status
                ),

                "gcs": (
                    triage.gcs
                ),

                "fall_risk": (
                    triage.fall_risk
                ),

                "priority": (
                    triage.priority
                )
            }

            if triage

            else None
        ),

        # -------------------------------------------------
        # CLINICAL RECORD
        #
        # This is HISTORY/DATABASE DATA.
        # It is not a new consultation form.
        # -------------------------------------------------

        "clinical": (

            {
                "hpi": clinical.hpi,

                "past_history": (
                    clinical.past_history
                ),

                "examination": (
                    clinical.examination
                ),

                "social_history": (
                    clinical.social_history
                ),

                "provisional_diagnosis": (
                    clinical.provisional_diagnosis
                ),

                "differential_diagnosis": (
                    clinical.differential_diagnosis
                ),

                "final_diagnosis": (
                    clinical.final_diagnosis
                ),

                "lab_order": (
                    clinical.lab_order
                ),

                "radiology_order": (
                    clinical.radiology_order
                ),

                "review_date": (
                    clinical.review_date.isoformat()
                    if clinical.review_date
                    else None
                ),

                "referral_destination": (
                    clinical.referral_destination
                ),

                "referral_notes": (
                    clinical.referral_notes
                )
            }

            if clinical

            else None
        ),

        # -------------------------------------------------
        # LABORATORY DATA
        # -------------------------------------------------

        "laboratory": laboratory,

        # -------------------------------------------------
        # PRESCRIPTION DATA
        # -------------------------------------------------

        "prescriptions": prescription_output,

        # -------------------------------------------------
        # REFERRALS
        # -------------------------------------------------

        "referrals": [

            {
                "id": referral.id,

                "referral_id": (
                    referral.referral_id
                ),

                "destination": (
                    referral.destination
                ),

                "department": (
                    referral.destination
                ),

                "notes": (
                    referral.notes
                ),

                "note": (
                    referral.notes
                ),

                "status": (
                    referral.status
                ),

                "created_at": (
                    referral.created_at.isoformat()
                    if referral.created_at
                    else None
                ),

                "completed_at": (
                    referral.completed_at.isoformat()
                    if referral.completed_at
                    else None
                )
            }

            for referral in referrals
        ]
    }

# =========================================================
# DOCTOR PROFILE
# =========================================================

@doctor_bp.get("/me")
def doctor_me():

    doctor, error = get_current_doctor()

    if error:
        return error

    return jsonify({

        "success": True,

        "doctor": {

            "staff_id": doctor.id,

            "staff_number": doctor.staff_number,

            "name": doctor.full_name,

            "department_id": session.get("department_id"),

            "department": (
                doctor.department.name
                if doctor.department
                else None
            )
        }
    })


@doctor_bp.get("/nursing-rounds/patients")
def doctor_nursing_round_patients():
    doctor, error = get_current_doctor()
    if error:
        return error
    department_patients = db.session.query(Visit.patient_id).filter(
        Visit.department_id == session.get("department_id"),
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")).notin_(["CANCELLED", "CANCELED"]),
    )
    beds = (Bed.query.filter(db.func.upper(Bed.status) == "OCCUPIED", Bed.patient_id.isnot(None),
                            Bed.patient_id.in_(department_patients))
            .order_by(Bed.bed_number.asc()).all())
    bed_by_patient = {}
    for bed in beds:
        bed_by_patient.setdefault(bed.patient_id, bed.bed_number)
    patient_ids = set(bed_by_patient)
    for query in (
        db.session.query(NursingRecord.patient_id).filter(NursingRecord.patient_id.in_(department_patients)),
        db.session.query(DoctorRoundNote.patient_id).filter(DoctorRoundNote.patient_id.in_(department_patients)),
        db.session.query(Referral.patient_id).filter(
            Referral.patient_id.in_(department_patients),
            Referral.destination == "doctor_review",
            Referral.doctor_id == doctor.id,
        ),
    ):
        patient_ids.update(patient_id for (patient_id,) in query.distinct().all() if patient_id)
    patients = []
    records = Patient.query.filter(Patient.id.in_(patient_ids)).order_by(Patient.full_name.asc()).all() if patient_ids else []
    for patient in records:
        patients.append({"id": patient.id, "patient_id": patient.patient_id,
                         "full_name": patient.full_name, "bed_number": bed_by_patient.get(patient.id, "—"),
                         "current_phase": patient.current_phase})
    return jsonify({"success": True, "patients": patients})


@doctor_bp.route("/nursing-rounds/patient/<int:patient_id>", methods=["GET", "POST"])
def doctor_nursing_round_patient(patient_id):
    doctor, error = get_current_doctor()
    if error:
        return error
    patient = Patient.query.get(patient_id)
    if not patient:
        return jsonify({"success": False, "error": "Patient not found."}), 404
    under_care = Bed.query.filter(
        Bed.patient_id == patient.id,
        db.func.upper(Bed.status) == "OCCUPIED"
    ).first()
    if not under_care and request.method == "POST":
        return jsonify({"success": False, "error": "Patient is not currently under nursing care."}), 404

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        note = str(data.get("note") or "").strip()
        if not note:
            return jsonify({"success": False, "error": "A rounds comment is required."}), 400
        round_note = DoctorRoundNote(patient_id=patient.id, doctor_id=doctor.id, note=note)
        db.session.add(round_note)
        db.session.commit()
        return jsonify({"success": True, "message": "Rounds comment saved.", "note": {
            "id": round_note.id, "doctor_name": doctor.full_name,
            "note": round_note.note, "created_at": round_note.created_at.isoformat()
        }}), 201

    records = NursingRecord.query.filter(
        NursingRecord.patient_id == patient.id,
        NursingRecord.status != "follow_up_report"
    ).order_by(NursingRecord.created_at.desc()).limit(200).all()
    follow_up_records = NursingRecord.query.filter_by(
        patient_id=patient.id, status="follow_up_report"
    ).order_by(NursingRecord.created_at.desc()).limit(100).all()
    referrals = Referral.query.filter(
        Referral.patient_id == patient.id,
        Referral.destination == "doctor_review",
        Referral.doctor_id == doctor.id
    ).order_by(Referral.created_at.desc()).limit(100).all()
    current_review = (ClinicalRecord.query.filter_by(patient_id=patient.id, doctor_id=doctor.id)
        .filter(ClinicalRecord.review_date.isnot(None))
        .order_by(ClinicalRecord.created_at.desc())
        .with_entities(ClinicalRecord.review_date).first())
    current_review_date = current_review[0].isoformat() if current_review and current_review[0] else ""
    previous_instruction_text = None
    referral_report_data = []
    for referral in reversed(referrals):
        report_text = referral.notes or ""
        response_marker = next((marker for marker in ("Doctor instructions:", "Doctor authorization:") if marker in report_text), None)
        doctor_response = report_text.split(response_marker, 1)[1].strip() if response_marker else None
        referral_report_data.append({
            "id": referral.id, "patient_id": patient.id, "patient_code": patient.patient_id,
            "patient_name": patient.full_name, "prior_doctor_instructions": previous_instruction_text,
            "review_date": current_review_date,
            "report": report_text.split("\n\nDoctor ", 1)[0], "doctor_response": doctor_response,
            "status": referral.status, "created_at": referral.created_at.isoformat() if referral.created_at else None
        })
        if referral.status == "INSTRUCTIONS" and doctor_response:
            previous_instruction_text = doctor_response
    round_notes = DoctorRoundNote.query.filter_by(patient_id=patient.id).order_by(DoctorRoundNote.created_at.desc()).limit(200).all()
    return jsonify({"success": True, "patient": {"id": patient.id, "patient_id": patient.patient_id,
                    "full_name": patient.full_name, "bed_number": under_care.bed_number if under_care else "—"},
        "nursing_sessions": [{"id": r.id, "assessment": r.assessment, "nursing_notes": r.nursing_notes,
            "care_plan": r.care_plan, "interventions": r.interventions, "medication_notes": r.medication_notes,
            "patient_response": r.patient_response, "vital_signs": r.vital_signs, "shift": r.shift,
            "status": r.status, "created_at": r.created_at.isoformat() if r.created_at else None}
            for r in records],
        "follow_up_reports": ([{"id": r.id, "patient_id": patient.id, "patient_code": patient.patient_id,
            "patient_name": patient.full_name, "review_date": None, "report": r.nursing_notes, "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None} for r in follow_up_records] +
            referral_report_data),
        "round_notes": [{"id": n.id, "doctor_name": n.doctor.full_name if n.doctor else "Doctor",
            "note": n.note, "created_at": n.created_at.isoformat() if n.created_at else None}
            for n in round_notes]})

# =========================================================
# DOCTOR QUEUE
# =========================================================

@doctor_bp.get("/queue")
def doctor_queue():

    doctor, error = get_current_doctor()

    if error:
        return error

    patients = (
        doctor_patient_query(
            doctor
        )
        .order_by(
            Patient.current_priority.desc(),
            Patient.created_at.asc()
        )
        .all()
    )

    return jsonify({

        "success": True,

        "patients": [

            serialize_patient_for_doctor(
                patient,
                doctor
            )

            for patient in patients
        ]
    })

# =========================================================
# SINGLE DOCTOR PATIENT
# =========================================================

@doctor_bp.get(
    "/patient/<int:patient_id>"
)
def get_doctor_patient(patient_id):

    doctor, error = get_current_doctor()

    if error:
        return error

    patient = Patient.query.get(
        patient_id
    )

    if not patient_belongs_to_doctor(
        patient,
        doctor
    ):

        return jsonify({

            "success": False,

            "error": (
                "Patient is not assigned to this department."
            )

        }), 403

    return jsonify({

        "success": True,

        "patient": (
            serialize_patient_for_doctor(
                patient,
                doctor
            )
        )
    })

# =========================================================
# SAVE DOCTOR CONSULTATION
# =========================================================

@doctor_bp.post("/consultation")
def save_consultation():

    doctor, error = get_current_doctor()

    if error:
        return error

    data = request.get_json(
        silent=True
    ) or {}

    patient_id = data.get(
        "patient_id"
    )

    try:

        patient_id = int(
            patient_id
        )

    except (
        TypeError,
        ValueError
    ):

        return jsonify({

            "success": False,

            "error": (
                "Valid patient_id is required."
            )

        }), 400

    patient = Patient.query.get(
        patient_id
    )

    if not patient_belongs_to_doctor(
        patient,
        doctor
    ):

        return jsonify({

            "success": False,

            "error": (
                "Patient is not assigned to this doctor."
            )

        }), 403

    # =====================================================
    # REVIEW DATE
    # =====================================================

    review_date = data.get(
        "review_date"
    )

    parsed_review_date = None

    if review_date:

        try:

            parsed_review_date = datetime.strptime(
                review_date,
                "%Y-%m-%d"
            ).date()

        except ValueError:

            return jsonify({

                "success": False,

                "error": (
                    "Invalid review date."
                )

            }), 400

    # =====================================================
    # SAVE CLINICAL RECORD
    #
    # IMPORTANT:
    #
    # Saving history, examination, diagnosis, etc.
    # DOES NOT automatically remove the patient from
    # Doctor Queue.
    #
    # The patient only leaves when one of the actual
    # release actions below occurs.
    # =====================================================

    record = ClinicalRecord(

        patient_id=patient.id,

        doctor_id=doctor.id,

        hpi=data.get(
            "hpi"
        ),

        past_history=data.get(
            "past_history"
        ),

        examination=data.get(
            "examination"
        ),

        social_history=data.get(
            "social_history"
        ),

        provisional_diagnosis=data.get(
            "provisional_diagnosis"
        ),

        differential_diagnosis=data.get(
            "differential_diagnosis"
        ),

        final_diagnosis=data.get(
            "final_diagnosis"
        ),

        lab_order=data.get(
            "lab_order"
        ),

        radiology_order=data.get(
            "radiology_order"
        ),

        review_date=parsed_review_date,

        referral_destination=data.get(
            "referral_destination"
        ),

        referral_notes=data.get(
            "referral_notes"
        )
    )

    db.session.add(
        record
    )

    # Keep the diagnosis register synchronized with saved clinical diagnoses.
    diagnosis_text = str(data.get("final_diagnosis") or data.get("provisional_diagnosis") or "").strip()
    if diagnosis_text:
        db.session.add(Diagnosis(
            patient_id=patient.id,
            diagnosis=diagnosis_text[:255],
            diagnosis_type="Final" if str(data.get("final_diagnosis") or "").strip() else "Provisional"
        ))

    # =====================================================
    # SAVE MEDICATION PRESCRIPTIONS
    #
    # ONE DATABASE ROW PER MEDICATION
    #
    # DATABASE COLUMNS USED:
    #
    # drug_name
    # frequency
    # duration
    # status
    #
    # A medication only counts as prescribed when a valid
    # drug_name exists.
    #
    # Empty medication rows DO NOT release the patient.
    # =====================================================

    medications = data.get(
        "medications",
        []
    )

    if not isinstance(
        medications,
        list
    ):
        medications = []

    medication_prescribed = False

    for medication in medications:

        if not isinstance(
            medication,
            dict
        ):
            continue

        drug_name = (
            medication.get(
                "drug_name"
            )
            or medication.get(
                "medication_name"
            )
            or ""
        ).strip()

        frequency = (
            medication.get(
                "frequency"
            )
            or ""
        ).strip()

        duration = (
            medication.get(
                "duration"
            )
            or ""
        ).strip()

        # -------------------------------------------------
        # Ignore completely empty medication rows
        # -------------------------------------------------

        if not drug_name:
            continue

        # -------------------------------------------------
        # A valid drug means a prescription is being made.
        # -------------------------------------------------

        prescription = Prescription(

            patient_id=patient.id,

            doctor_id=doctor.id,

            drug_name=drug_name,

            frequency=(
                frequency
                or None
            ),

            duration=(
                duration
                or None
            ),

            status="Active"
        )

        db.session.add(
            prescription
        )

        medication_prescribed = True

    # =====================================================
    # CREATE LABORATORY REQUEST
    # =====================================================

    lab_order = (
        data.get(
            "lab_order"
        )
        or ""
    ).strip()

    lab_request = None
    lab_requests = []

    if lab_order:
        # Comma-, semicolon-, or newline-separated investigations become
        # individual database requests so each test can be processed separately.
        lab_tests = list(dict.fromkeys(
            part.strip() for part in re.split(r"[,;\n]+", lab_order) if part.strip()
        ))
        for index, test_name in enumerate(lab_tests, start=1):
            request_row = LabRequest(
                request_id=f"LAB-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}-{index}",
                patient_id=patient.id,
                doctor_id=doctor.id,
                test_name=test_name[:255],
                status="PENDING"
            )
            db.session.add(request_row)
            lab_requests.append(request_row)
            if lab_request is None:
                lab_request = request_row

    # =====================================================
    # CREATE RADIOLOGY REQUEST
    # =====================================================

    radiology_order = (
        data.get(
            "radiology_order"
        )
        or ""
    ).strip()

    radiology_request = None

    if radiology_order:

        radiology_request = RadiologyRequest(

            request_id=(
                f"RAD-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
            ),

            patient_id=patient.id,

            examination=radiology_order,

            status="PENDING"
        )

        db.session.add(
            radiology_request
        )

    # =====================================================
    # CREATE DOCTOR REFERRAL
    # =====================================================

    referral_destination = (
        data.get(
            "referral_destination"
        )
        or ""
    ).strip().lower()

    referral_notes = (
        data.get(
            "referral_notes"
        )
        or ""
    ).strip()

    # -----------------------------------------------------
    # NORMALIZE OPD VALUES
    # -----------------------------------------------------

    # The old "Refer to Discharge" destination is intentionally removed.
    # Do not create discharge referrals from the doctor referral selector.
    if referral_destination in (
        "opd", "op", "discharge", "refer to discharge",
        "outpatient", "outpatient department"
    ):
        referral_destination = ""

    if referral_destination in ("counseling", "counselling", "guidance and counseling", "guidance & counseling"):
        referral_destination = "guidance"

    referral = None

    if referral_destination in (
        "nurse",
        "theatre",
        "guidance"
    ):

        referral = Referral(

            referral_id=(
                f"REF-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
            ),

            patient_id=patient.id,

            doctor_id=doctor.id,

            destination=referral_destination,

            notes=referral_notes,

            status="PENDING"
        )

        db.session.add(
            referral
        )

    # =====================================================
    # UPDATE PATIENT PHASE
    #
    # IMPORTANT WORKFLOW RULE
    #
    # The patient MUST NOT leave Doctor Queue merely
    # because consultation/history/diagnosis was saved.
    #
    # The patient leaves only when one of these occurs:
    #
    # 1. Referral
    # 2. Laboratory, radiology, or medication order
    #
    # If none happens, the patient remains in:
    #
    #     Doctor Queue
    # =====================================================

    if referral_destination == "nurse":

        patient.current_phase = (
            "Nurse Referral Queue"
        )

    elif referral_destination == "theatre":

        patient.current_phase = (
            "Theatre Referral Queue"
        )

    elif referral_destination == "guidance":

        patient.current_phase = "Guidance & Counseling Queue"

    elif medication_prescribed:

        # -------------------------------------------------
        # Medication has been prescribed.
        #
        # The patient must leave Doctor Queue so the
        # prescription can proceed to pharmacy.
        # -------------------------------------------------

        patient.current_phase = (
            "Pharmacy Queue"
        )

    elif lab_order:

        patient.current_phase = "Laboratory Queue"

    elif radiology_order:

        patient.current_phase = "Radiology Queue"

    else:

        # -------------------------------------------------
        # HISTORY / EXAMINATION / DIAGNOSIS ONLY
        # The patient remains assigned to the doctor so the
        # consultation can continue after this save.
        # -------------------------------------------------

        patient.current_phase = (
            "Doctor Queue"
        )

    # =====================================================
    # COMMIT
    # =====================================================

    try:

        db.session.flush()
        record_tariff_charge(patient.id, "consultation", f"consultation:{record.id}")
        for request_row in lab_requests:
            record_tariff_charge(
                patient.id,
                "lab",
                f"lab:{request_row.id}",
                detail=request_row.test_name,
            )
        if radiology_request:
            record_tariff_charge(
                patient.id,
                "imaging",
                f"imaging:{radiology_request.id}",
                detail=radiology_request.examination,
            )

        db.session.commit()

    except Exception as exc:

        db.session.rollback()

        print(
            "DOCTOR CONSULTATION ERROR:",
            exc
        )

        return jsonify({

            "success": False,

            "error": (
                "Unable to save doctor consultation."
            )

        }), 500

    # =====================================================
    # RESPONSE
    # =====================================================

    return jsonify({

        "success": True,

        "message": (
            "Doctor consultation saved."
        ),

        "clinical_record_id": (
            record.id
        ),

        "medication_prescribed": (
            medication_prescribed
        ),
        
        "patient_phase": (
            patient.current_phase
        ),

        "lab_request": (

            {
                "id": lab_request.id,

                "request_id": (
                    lab_request.request_id
                ),

                "test_name": (
                    lab_request.test_name
                ),

                "status": (
                    lab_request.status
                )
            }

            if lab_request

            else None
        ),

        "radiology_request": (

            {
                "id": radiology_request.id,

                "request_id": (
                    radiology_request.request_id
                ),

                "examination": (
                    radiology_request.examination
                ),

                "status": (
                    radiology_request.status
                )
            }

            if radiology_request

            else None
        ),

        "referral": (

            {
                "id": referral.id,

                "referral_id": (
                    referral.referral_id
                ),

                "destination": (
                    referral.destination
                ),

                "notes": (
                    referral.notes
                ),

                "status": (
                    referral.status
                )
            }

            if referral

            else None
        )
    }), 201


# =========================================================
# DOCTOR FOLLOW-UP REPORTS FROM NURSING
# =========================================================

@doctor_bp.get("/follow-up-reports")
def doctor_follow_up_reports():

    doctor, error = get_current_doctor()

    if error:
        return error

    today = date.today()

    clinical_records = (
        ClinicalRecord.query
        .filter(
            ClinicalRecord.doctor_id == doctor.id,
            ClinicalRecord.review_date.isnot(None),
            ClinicalRecord.review_date <= today
        )
        .order_by(
            ClinicalRecord.review_date.asc(),
            ClinicalRecord.created_at.desc()
        )
        .all()
    )

    result = []
    seen_patients = set()

    for clinical in clinical_records:

        if clinical.patient_id in seen_patients:
            continue

        seen_patients.add(clinical.patient_id)

        patient = Patient.query.get(clinical.patient_id)

        if not patient:
            continue

        if not Visit.query.filter(
            Visit.patient_id == patient.id,
            Visit.department_id == session.get("department_id"),
            db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING",
        ).first():
            continue

        report = (
            NursingRecord.query
            .filter(
                NursingRecord.patient_id == patient.id,
                NursingRecord.status == "review_reported"
            )
            .order_by(
                NursingRecord.created_at.desc()
            )
            .first()
        )

        if not report:
            continue

        result.append({
            "patient_id": patient.id,
            "patient_code": patient.patient_id,
            "patient_name": patient.full_name,
            "review_date": clinical.review_date.isoformat(),
            "report_id": report.id,
            "report_created_at": (
                report.created_at.isoformat()
                if report.created_at else None
            ),
            "assessment": report.assessment,
            "nursing_notes": report.nursing_notes,
            "care_plan": report.care_plan,
            "interventions": report.interventions,
            "medication_notes": report.medication_notes,
            "patient_response": report.patient_response,
            "vital_signs": report.vital_signs,
            "shift": report.shift
        })

    return jsonify({
        "success": True,
        "reports": result
    })


@doctor_bp.post("/follow-up/<int:patient_id>/acknowledge")
def acknowledge_nurse_follow_up(patient_id):

    doctor, error = get_current_doctor()

    if error:
        return error

    patient = Patient.query.get(patient_id)

    if not patient:
        return jsonify({
            "success": False,
            "error": "Patient not found."
        }), 404

    clinical = (
        ClinicalRecord.query
        .filter(
            ClinicalRecord.patient_id == patient.id,
            ClinicalRecord.doctor_id == doctor.id,
            ClinicalRecord.review_date.isnot(None)
        )
        .order_by(
            ClinicalRecord.created_at.desc()
        )
        .first()
    )

    if not clinical:
        return jsonify({
            "success": False,
            "error": "No review scheduled for this patient by this doctor."
        }), 404

    if clinical.review_date > date.today():
        return jsonify({
            "success": False,
            "error": "The patient's review date has not yet arrived."
        }), 409

    report = (
        NursingRecord.query
        .filter(
            NursingRecord.patient_id == patient.id,
            NursingRecord.status == "review_reported"
        )
        .order_by(
            NursingRecord.created_at.desc()
        )
        .first()
    )

    if not report:
        return jsonify({
            "success": False,
            "error": "No nurse review report has been submitted for this patient."
        }), 409

    report.status = "doctor_acknowledged"

    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Nurse report acknowledged by doctor. Nurse may release the patient to OPD.",
        "patient_id": patient.id,
        "report_id": report.id,
        "review_date": clinical.review_date.isoformat()
    })

# =========================================================
# DOCTOR RADIOLOGY RESULTS
# =========================================================

@doctor_bp.get(
    "/patient/<int:patient_id>/radiology-results"
)
def doctor_radiology_results(
    patient_id
):

    doctor, error = get_current_doctor()

    if error:
        return error

    patient = Patient.query.get(
        patient_id
    )

    if not patient_belongs_to_doctor(
        patient,
        doctor
    ):

        return jsonify({

            "success": False,

            "error": (
                "Patient is not assigned to this department."
            )

        }), 403

    requests = (
        RadiologyRequest.query
        .filter_by(
            patient_id=patient.id
        )
        .order_by(
            RadiologyRequest.created_at.desc()
        )
        .all()
    )

    output = []

    for radiology_request in requests:

        results = (
            RadiologyResult.query
            .filter_by(
                request_id=radiology_request.id
            )
            .order_by(
                RadiologyResult.created_at.desc()
            )
            .all()
        )

        result_output = []

        for result in results:

            radiologist_name = None

            if result.radiologist:

                radiologist_name = (
                    result.radiologist.full_name
                )

            result_output.append({

                "id": result.id,

                "findings": (
                    result.findings
                ),

                "image_url": (
                    f"/{result.image_path}"
                    if result.image_path
                    else None
                ),

                "reported_by": (
                    radiologist_name
                ),

                "created_at": (
                    result.created_at.isoformat()
                    if result.created_at
                    else None
                )
            })

        output.append({

            "id": (
                radiology_request.id
            ),

            "request_id": (
                radiology_request.request_id
            ),

            "examination": (
                radiology_request.examination
            ),

            "status": (
                radiology_request.status
            ),

            "created_at": (
                radiology_request.created_at.isoformat()
                if radiology_request.created_at
                else None
            ),

            "results": result_output
        })

    return jsonify({

        "success": True,

        "radiology": output

    })
