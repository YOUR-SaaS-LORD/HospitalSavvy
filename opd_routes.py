from flask import Blueprint, request, jsonify, session

from extensions import db

from models.patient import Patient, Visit
from models.clinical import ClinicalRecord, Referral
from models.lab import LabRequest, LabResult
from models.radiology import RadiologyRequest, RadiologyResult
from models.pharmacy import PharmacyDispense
from models.nursing import NursingCare
from models.theatre import SurgicalRecord
from models.billing import Billing
from models.triage import TriageRecord
from models.staff import Staff

opd_bp = Blueprint(
    "opd_bp",
    __name__,
    url_prefix="/api/opd"
)


def patient_in_active_department(patient_id):
    department_id = session.get("department_id")
    return bool(department_id and Visit.query.filter(
        Visit.patient_id == patient_id,
        Visit.department_id == department_id,
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING",
    ).first())

# =========================================================
# OPD REFERRAL QUEUE
# =========================================================

@opd_bp.get("/referrals")
def get_opd_referrals():

    referrals = (
        Referral.query
        .filter(
            Referral.destination == "op",
            Referral.status == "PENDING"
        )
        .order_by(
            Referral.id.asc()
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

        result.append({

            "id":
                referral.id,

            "patient_id":
                patient.id,

            "patient_code":
                patient.patient_id,

            "patient_name":
                patient.full_name,

            "referral_destination":
                referral.destination,

            "referral_notes":
                getattr(
                    referral,
                    "notes",
                    getattr(
                        referral,
                        "referral_notes",
                        None
                    )
                ),

            "status":
                referral.status,

            "created_at":
                (
                    referral.created_at.isoformat()
                    if getattr(
                        referral,
                        "created_at",
                        None
                    )
                    else None
                )
        })

    return jsonify({
        "success": True,
        "referrals": result
    })

# =========================================================
# COMPLETE OPD REFERRAL
# =========================================================

@opd_bp.post(
    "/referrals/<int:referral_id>/complete"
)
def complete_opd_referral(
    referral_id
):

    referral = Referral.query.get(
        referral_id
    )

    if not referral:

        return jsonify({
            "success": False,
            "message": "Referral not found"
        }), 404

    referral.status = "COMPLETED"

    patient = Patient.query.get(
        referral.patient_id
    )

    if patient:

        patient.current_phase = "OPD"

    db.session.commit()

    return jsonify({
        "success": True,
        "message": "OPD referral completed"
    })

# =========================================================
# OPD PATIENT SELECTION
#
# DATABASE IS THE ONLY SOURCE OF TRUTH
#
# A patient belongs in OPD selection when:
#
# 1. Patient.current_phase == "OPD"
#
# OR
#
# 2. The patient has a PENDING referral whose destination
#    is "op".
#
# =========================================================

@opd_bp.get("/patients")
def get_opd_patients():

    result = []

    seen_patient_ids = set()

    # =====================================================
    # PATIENTS ALREADY ACTIVE IN OPD
    # =====================================================

    opd_patients = (
        Patient.query
        .filter(
            Patient.current_phase == "OPD"
        )
        .order_by(
            Patient.id.asc()
        )
        .all()
    )

    for patient in opd_patients:

        if not patient:
            continue

        if not patient_in_active_department(patient.id):
            continue

        if patient.id in seen_patient_ids:
            continue

        seen_patient_ids.add(
            patient.id
        )

        result.append({

            "id":
                patient.id,

            "patient_id":
                patient.patient_id,

            "full_name":
                patient.full_name

        })

    # =====================================================
    # PENDING OPD REFERRALS
    #
    # Do not depend on database capitalization.
    # =====================================================

    pending_referrals = (
        Referral.query
        .filter(
            Referral.status == "PENDING"
        )
        .order_by(
            Referral.id.asc()
        )
        .all()
    )

    for referral in pending_referrals:

        if not referral:
            continue

        destination = str(
            getattr(
                referral,
                "destination",
                ""
            ) or ""
        ).strip().lower()

        if destination != "op":
            continue

        patient = Patient.query.get(
            referral.patient_id
        )

        if not patient:
            continue

        if patient.id in seen_patient_ids:
            continue

        seen_patient_ids.add(
            patient.id
        )

        result.append({

            "id":
                patient.id,

            "patient_id":
                patient.patient_id,

            "full_name":
                patient.full_name

        })

    # =====================================================
    # FINAL DATABASE RESPONSE
    # =====================================================

    return jsonify({

        "success":
            True,

        "patients":
            result

    })

@opd_bp.post(
    "/patient/<int:patient_id>/complete"
)
def complete_opd_patient(
    patient_id
):

    patient = Patient.query.get(
        patient_id
    )

    if not patient:

        return jsonify({
            "success": False,
            "message": "Patient not found"
        }), 404

    # =====================================================
    # COMPLETE ANY PENDING OP REFERRALS FOR THIS PATIENT
    #
    # This preserves the referral history in the database
    # while closing any referral that is still pending.
    # =====================================================

    pending_referrals = (
        Referral.query
        .filter(
            Referral.patient_id == patient.id,
            Referral.destination == "op",
            Referral.status == "PENDING"
        )
        .all()
    )

    completed_referral_ids = []

    for referral in pending_referrals:

        referral.status = "COMPLETED"

        completed_referral_ids.append(
            referral.id
        )

    # =====================================================
    # REMOVE PATIENT FROM ACTIVE OPD SELECTION
    # =====================================================

    patient.current_phase = (
        "OPD Completed"
    )

    try:

        db.session.commit()

    except Exception as exc:

        db.session.rollback()

        print(
            "OPD PATIENT COMPLETION ERROR:",
            exc
        )

        return jsonify({
            "success": False,
            "message": "Unable to complete patient visit."
        }), 500

    return jsonify({

        "success": True,

        "message": "Patient visit completed successfully.",

        "patient_id":
            patient.id,

        "current_phase":
            patient.current_phase,

        "completed_referral_ids":
            completed_referral_ids
    })

# =========================================================
# COMPLETE OPD PATIENT RECORD
#
# DATABASE SOURCE OF TRUTH
#
# RETURNS:
#
# 1. Patient information
# 2. Registration / visit history
# 3. All triage records
# 4. All doctor consultations
# 5. All pharmacy records
# 6. All laboratory requests + results
# 7. All radiology requests + results
# 8. All theatre records
# 9. All nursing sessions
# 10. All referrals
# 11. All billing / accounts records
#
# The existing OPD JavaScript expects clinical records
# underneath data.reports.
# =========================================================

@opd_bp.get(
    "/patient/<int:patient_id>"
)
def get_opd_patient_record(
    patient_id
):

    # =====================================================
    # PATIENT
    # =====================================================

    patient = Patient.query.get(
        patient_id
    )

    if not patient:

        return jsonify({
            "success": False,
            "message": "Patient not found"
        }), 404

    # =====================================================
    # PATIENT MASTER RECORD
    # =====================================================

    patient_record = {

        "id":
            patient.id,

        "patient_id":
            patient.patient_id,

        "full_name":
            patient.full_name,

        "date_of_birth":
            (
                patient.date_of_birth.isoformat()
                if getattr(
                    patient,
                    "date_of_birth",
                    None
                )
                else None
            ),

        "gender":
            patient.gender,

        "phone":
            patient.phone,

        "clinic":
            getattr(
                patient,
                "clinic",
                None
            ),

        "current_phase":
            getattr(
                patient,
                "current_phase",
                None
            ),

        "current_priority":
            getattr(
                patient,
                "current_priority",
                None
            ),

        "status":
            getattr(
                patient,
                "status",
                None
            )
    }

    # =====================================================
    # REGISTRATION / VISIT HISTORY
    # =====================================================

    visits = (
        Visit.query
        .filter(
            Visit.patient_id ==
            patient_id
        )
        .order_by(
            Visit.created_at.desc()
        )
        .all()
    )

    registration = []

    for visit in visits:

        registration.append({

            "id":
                visit.id,

            "visit_id":
                getattr(
                    visit,
                    "visit_id",
                    None
                ),

            "patient_id":
                visit.patient_id,

            "department_id":
                getattr(
                    visit,
                    "department_id",
                    None
                ),

            "status":
                getattr(
                    visit,
                    "status",
                    None
                ),

            "created_at":
                (
                    visit.created_at.isoformat()
                    if getattr(
                        visit,
                        "created_at",
                        None
                    )
                    else None
                )
        })

    # =====================================================
    # TRIAGE
    #
    # ALL TRIAGE RECORDS ARE RETURNED.
    # =====================================================

    triage_records = (
        TriageRecord.query
        .filter(
            TriageRecord.patient_id ==
            patient_id
        )
        .order_by(
            TriageRecord.id.asc()
        )
        .all()
    )

    triage = []

    for record in triage_records:

        triage.append({

            "id":
                record.id,

            "patient_id":
                record.patient_id,

            "weight":
                getattr(
                    record,
                    "weight",
                    None
                ),

            "height":
                getattr(
                    record,
                    "height",
                    None
                ),

            "bmi":
                getattr(
                    record,
                    "bmi",
                    None
                ),

            "blood_pressure":
                getattr(
                    record,
                    "blood_pressure",
                    None
                ),

            "temperature":
                getattr(
                    record,
                    "temperature",
                    None
                ),

            "pulse":
                getattr(
                    record,
                    "pulse",
                    None
                ),

            "respiratory_rate":
                getattr(
                    record,
                    "respiratory_rate",
                    None
                ),

            "spo2":
                getattr(
                    record,
                    "spo2",
                    None
                ),

            "blood_sugar":
                getattr(
                    record,
                    "blood_sugar",
                    None
                ),

            "pain_score":
                getattr(
                    record,
                    "pain_score",
                    None
                ),

            "chief_complaint":
                getattr(
                    record,
                    "chief_complaint",
                    None
                ),

            "allergies":
                getattr(
                    record,
                    "allergies",
                    None
                ),

            "pregnancy_status":
                getattr(
                    record,
                    "pregnancy_status",
                    None
                ),

            "gcs":
                getattr(
                    record,
                    "gcs",
                    None
                ),

            "fall_risk":
                getattr(
                    record,
                    "fall_risk",
                    None
                ),

            "priority":
                getattr(
                    record,
                    "priority",
                    None
                ),

            "created_at":
                (
                    record.created_at.isoformat()
                    if getattr(
                        record,
                        "created_at",
                        None
                    )
                    else None
                )
        })

    # =====================================================
    # DOCTOR CONSULTATION RECORDS
    # =====================================================

    clinical_records = (
        ClinicalRecord.query
        .filter(
            ClinicalRecord.patient_id ==
            patient_id
        )
        .order_by(
            ClinicalRecord.created_at.desc()
        )
        .all()
    )

    doctor_records = []

    for record in clinical_records:

        doctor_records.append({

            "id":
                record.id,

            "hpi":
                getattr(
                    record,
                    "hpi",
                    None
                ),

            "past_history":
                getattr(
                    record,
                    "past_history",
                    None
                ),

            "examination":
                getattr(
                    record,
                    "examination",
                    None
                ),

            "social_history":
                getattr(
                    record,
                    "social_history",
                    None
                ),

            "provisional_diagnosis":
                getattr(
                    record,
                    "provisional_diagnosis",
                    None
                ),

            "differential_diagnosis":
                getattr(
                    record,
                    "differential_diagnosis",
                    None
                ),

            "final_diagnosis":
                getattr(
                    record,
                    "final_diagnosis",
                    None
                ),

            "lab_order":
                getattr(
                    record,
                    "lab_order",
                    None
                ),

            "radiology_order":
                getattr(
                    record,
                    "radiology_order",
                    None
                ),

            "prescription":
                getattr(
                    record,
                    "prescription",
                    None
                ),

            "prescription_frequency":
                getattr(
                    record,
                    "prescription_frequency",
                    None
                ),

            "prescription_duration":
                getattr(
                    record,
                    "prescription_duration",
                    None
                ),

            "review_date":
                (
                    record.review_date.isoformat()
                    if getattr(
                        record,
                        "review_date",
                        None
                    )
                    else None
                ),

            "referral_destination":
                getattr(
                    record,
                    "referral_destination",
                    None
                ),

            "referral_notes":
                getattr(
                    record,
                    "referral_notes",
                    None
                ),

            "created_at":
                (
                    record.created_at.isoformat()
                    if getattr(
                        record,
                        "created_at",
                        None
                    )
                    else None
                )
        })

    # =====================================================
    # PHARMACY RECORDS
    # =====================================================

    pharmacy_records = (
        PharmacyDispense.query
        .filter(
            PharmacyDispense.patient_id ==
            patient_id
        )
        .order_by(
            PharmacyDispense.id.desc()
        )
        .all()
    )

    pharmacy = []

    for record in pharmacy_records:

        medication_name = (

            getattr(
                record,
                "medicine_name",
                None
            )

            or

            getattr(
                record,
                "drug_name",
                None
            )

            or

            getattr(
                record,
                "medicine",
                None
            )
        )

        pharmacy.append({

            "id":
                record.id,

            "medication_name":
                medication_name,

            "medicine_name":
                medication_name,

            "quantity":
                getattr(
                    record,
                    "quantity",
                    None
                ),

            "dosage":
                getattr(
                    record,
                    "dosage",
                    None
                ),

            "frequency":
                getattr(
                    record,
                    "frequency",
                    None
                ),

            "duration":
                getattr(
                    record,
                    "duration",
                    None
                ),

            "total_amount":
                float(
                    getattr(
                        record,
                        "total_amount",
                        getattr(
                            record,
                            "amount",
                            0
                        )
                    )
                    or 0
                ),

            "dispensed_by":
                getattr(
                    record,
                    "dispensed_by",
                    getattr(
                        record,
                        "pharmacist",
                        None
                    )
                ),

            "status":
                getattr(
                    record,
                    "status",
                    None
                ),

            "created_at":
                (
                    record.created_at.isoformat()
                    if getattr(
                        record,
                        "created_at",
                        None
                    )
                    else None
                )
        })

    # =====================================================
    # LABORATORY RECORDS
    #
    # LabRequest uses requested_at.
    # LabResult.request_id points to LabRequest.id.
    # =====================================================

    lab_requests = (
        LabRequest.query
        .filter(
            LabRequest.patient_id ==
            patient_id
        )
        .order_by(
            LabRequest.requested_at.desc()
        )
        .all()
    )

    laboratory = []

    for request_record in lab_requests:

        latest_result = (
            LabResult.query
            .filter(
                LabResult.request_id ==
                request_record.id
            )
            .order_by(
                LabResult.created_at.desc()
            )
            .first()
        )

        lab_staff = (
            Staff.query.get(latest_result.verified_by)
            if latest_result and latest_result.verified_by
            else None
        )

        lab_reported_by = (
            getattr(lab_staff, "full_name", None)
            or getattr(lab_staff, "name", None)
            if lab_staff
            else None
        )

        laboratory.append({

            "id":
                request_record.id,

            "request_id":
                request_record.request_id,

            "test_name":
                request_record.test_name,

            "sample_type":
                request_record.sample_type,

            "barcode":
                request_record.barcode,

            "status":
                request_record.status,

            "created_at":
                (
                    request_record.requested_at.isoformat()
                    if request_record.requested_at
                    else None
                ),

            "result":
                (
                    latest_result.results
                    if latest_result
                    else None
                ),

            "result_details":
                (
                    {

                        "id":
                            latest_result.id,

                        "results":
                            latest_result.results,

                        "verification_status":
                            latest_result.verification_status,

                        "verified_by":
                            lab_reported_by,

                        "created_at":
                            (
                                latest_result.created_at.isoformat()
                                if latest_result.created_at
                                else None
                            )
                    }

                    if latest_result

                    else None
                )
        })

    # =====================================================
    # RADIOLOGY RECORDS
    # =====================================================

    radiology_requests = (
        RadiologyRequest.query
        .filter(
            RadiologyRequest.patient_id ==
            patient_id
        )
        .order_by(
            RadiologyRequest.created_at.desc()
        )
        .all()
    )

    radiology = []

    for request_record in radiology_requests:

        latest_result = (
            RadiologyResult.query
            .filter(
                RadiologyResult.request_id ==
                request_record.id
            )
            .order_by(
                RadiologyResult.created_at.desc()
            )
            .first()
        )

        radiology_staff = (
            Staff.query.get(latest_result.reported_by)
            if latest_result and latest_result.reported_by
            else None
        )

        radiology_reported_by = (
            getattr(radiology_staff, "full_name", None)
            or getattr(radiology_staff, "name", None)
            if radiology_staff
            else None
        )

        radiology_image_url = (
            f"/{latest_result.image_path}"
            if latest_result and latest_result.image_path
            else None
        )

        radiology.append({

            "id":
                request_record.id,

            "request_id":
                request_record.request_id,

            "examination":
                request_record.examination,

            "status":
                request_record.status,

            "created_at":
                (
                    request_record.created_at.isoformat()
                    if request_record.created_at
                    else None
                ),

            "findings":
                (
                    latest_result.findings
                    if latest_result
                    else None
                ),

            "image_path":
                (
                    latest_result.image_path
                    if latest_result
                    else None
                ),

            "image_url":
                radiology_image_url,

            "reported_by":
                radiology_reported_by,

            "result":
                (
                    {

                        "id":
                            latest_result.id,

                        "image_path":
                            latest_result.image_path,

                        "image_url":
                            radiology_image_url,

                        "findings":
                            latest_result.findings,

                        "reported_by":
                            radiology_reported_by,

                        "created_at":
                            (
                                latest_result.created_at.isoformat()
                                if latest_result.created_at
                                else None
                            )
                    }

                    if latest_result

                    else None
                )
        })

    # =====================================================
    # OPERATING THEATRE RECORDS
    #
    # Use ID for ordering because the existing route does
    # not assume SurgicalRecord has created_at.
    # =====================================================

    theatre_records = (
        SurgicalRecord.query
        .filter(
            SurgicalRecord.patient_id ==
            patient_id
        )
        .order_by(
            SurgicalRecord.id.desc()
        )
        .all()
    )

    theatre = []

    for record in theatre_records:

        theatre.append({

            "id":
                record.id,

            "procedure":
                getattr(
                    record,
                    "procedure",
                    getattr(
                        record,
                        "operation",
                        getattr(
                            record,
                            "procedure_name",
                            None
                        )
                    )
                ),

            "diagnosis":
                getattr(
                    record,
                    "diagnosis",
                    None
                ),

            "surgeon":
                getattr(
                    record,
                    "surgeon",
                    getattr(
                        record,
                        "surgeon_name",
                        None
                    )
                ),

            "anaesthesia":
                getattr(
                    record,
                    "anaesthesia",
                    getattr(
                        record,
                        "anesthesia",
                        None
                    )
                ),

            "status":
                getattr(
                    record,
                    "status",
                    None
                ),

            "notes":
                getattr(
                    record,
                    "notes",
                    None
                ),

            "created_at":
                (
                    record.created_at.isoformat()
                    if getattr(
                        record,
                        "created_at",
                        None
                    )
                    else None
                )
        })

    # =====================================================
    # NURSING RECORDS
    #
    # ALL NURSING SESSIONS ARE RETURNED.
    # =====================================================

    nursing_records = (
        NursingCare.query
        .filter(
            NursingCare.patient_id ==
            patient_id
        )
        .order_by(
            NursingCare.id.asc()
        )
        .all()
    )

    nursing = []

    for session_number, record in enumerate(
        nursing_records,
        start=1
    ):

        nursing.append({

            "id":
                record.id,

            "session_number":
                session_number,

            "assessment":
                record.assessment,

            "nursing_notes":
                record.nursing_notes,

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

            "status":
                record.status,

            "created_at":
                (
                    record.created_at.isoformat()
                    if record.created_at
                    else None
                )
        })

    # =====================================================
    # REFERRALS
    # =====================================================

    referral_records = (
        Referral.query
        .filter(
            Referral.patient_id ==
            patient_id
        )
        .order_by(
            Referral.id.desc()
        )
        .all()
    )

    referrals = []

    for referral in referral_records:

        referrals.append({

            "id":
                referral.id,

            "destination":
                referral.destination,

            "status":
                referral.status,

            "notes":
                getattr(
                    referral,
                    "notes",
                    getattr(
                        referral,
                        "referral_notes",
                        None
                    )
                ),

            "created_at":
                (
                    referral.created_at.isoformat()
                    if getattr(
                        referral,
                        "created_at",
                        None
                    )
                    else None
                )
        })

    # =====================================================
    # BILLING / ACCOUNTS
    # =====================================================

    billing_records = (
        Billing.query
        .filter(
            Billing.patient_id ==
            patient_id
        )
        .order_by(
            Billing.created_at.desc()
        )
        .all()
    )

    billing = []

    for record in billing_records:

        billing.append({

            "id":
                record.id,

            "patient_id":
                record.patient_id,

            "invoice_number":
                record.invoice_number,

            "bill_date":
                (
                    record.bill_date.isoformat()
                    if getattr(
                        record,
                        "bill_date",
                        None
                    )
                    else None
                ),

            "description":
                record.description,

            "service_type":
                record.service_type,

            "amount":
                float(
                    record.amount or 0
                ),

            "discount":
                float(
                    record.discount or 0
                ),

            "tax":
                float(
                    record.tax or 0
                ),

            "total_amount":
                float(
                    record.total_amount or 0
                ),

            "amount_paid":
                float(
                    record.amount_paid or 0
                ),

            "balance":
                float(
                    record.balance or 0
                ),

            "payment_method":
                record.payment_method,

            "payment_status":
                record.payment_status,

            "status":
                record.status,

            "created_by":
                record.created_by,

            "notes":
                record.notes,

            "created_at":
                (
                    record.created_at.isoformat()
                    if record.created_at
                    else None
                ),

            "updated_at":
                (
                    record.updated_at.isoformat()
                    if record.updated_at
                    else None
                )
        })

    # =====================================================
    # FINAL RESPONSE
    #
    # This structure is what the JavaScript will consume.
    # =====================================================

    return jsonify({

        "success":
            True,

        "patient_id":
            patient.id,

        "patient":
            patient_record,

        "registration":
            {
                "visits":
                    registration
            },

        "triage":
            triage,

        "reports":
            {

                "doctor":
                    doctor_records,

                "pharmacy":
                    pharmacy,

                "laboratory":
                    laboratory,

                "radiology":
                    radiology,

                "theatre":
                    theatre,

                "nursing":
                    nursing
            },

        "referrals":
            referrals,

        "billing":
            billing
    })
