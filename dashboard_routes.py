from datetime import datetime, date, timedelta

from flask import Blueprint, jsonify, render_template

from extensions import db

from models.patient import Patient
from models.triage import TriageRecord
from models.clinical import ClinicalRecord, Diagnosis
from models.billing import Billing
from models.lab import LabRequest
from models.pharmacy import Prescription, PharmacyDispense
from models.hospital import Bed
from models.staff import Staff
from models.nursing import NursingRecord
from models.radiology import RadiologyRequest

dashboard_bp = Blueprint(
    "dashboard",
    __name__,
    url_prefix="/dashboard"
)

# =========================================================
# HELPERS
# =========================================================

def today_start():
    return datetime.combine(
        date.today(),
        datetime.min.time()
    )

def tomorrow_start():
    return today_start() + timedelta(days=1)

def patient_name(patient):

    if patient is None:
        return "Unknown"

    if getattr(patient, "full_name", None):
        return patient.full_name

    if getattr(patient, "name", None):
        return patient.name

    if getattr(patient, "patient_name", None):
        return patient.patient_name

    first = getattr(patient, "first_name", "") or ""
    middle = getattr(patient, "middle_name", "") or ""
    last = getattr(patient, "last_name", "") or ""

    full = " ".join(
        part.strip()
        for part in [first, middle, last]
        if part and part.strip()
    )

    if full:
        return full

    return f"Patient #{patient.id}"

def safe_float(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0

# =========================================================
# DASHBOARD PAGE
# =========================================================

@dashboard_bp.route("/", methods=["GET"])
def dashboard():

    return render_template(
        "dashboard.html"
    )

# =========================================================
# DASHBOARD API
# =========================================================

@dashboard_bp.route("/api", methods=["GET"])
def dashboard_api():

    today = today_start()
    tomorrow = tomorrow_start()

    # =====================================================
    # PATIENTS TODAY
    # =====================================================

    patients_today = 0

    try:

        patients_today = Patient.query.filter(
            Patient.created_at >= today,
            Patient.created_at < tomorrow
        ).count()

    except Exception:

        patients_today = 0

    # =====================================================
    # TRIAGE / WAITING QUEUE
    # Use the live database queue, not today's triage records
    # or the existence of a clinical record.
    # =====================================================

    waiting = 0

    try:
        waiting = Patient.query.filter(
            Patient.current_phase == "Triage Queue"
        ).count()
    except Exception as e:
        db.session.rollback()
        print(f"Dashboard waiting queue error: {e}")
        waiting = 0

    # =====================================================
    # ADMISSIONS TODAY
    # Count nursing admission sessions created when a patient
    # is assigned an available bed.
    # =====================================================

    admissions = 0

    try:
        admissions = NursingRecord.query.filter(
            NursingRecord.admitted_at >= today,
            NursingRecord.admitted_at < tomorrow
        ).count()
    except Exception:
        db.session.rollback()
        admissions = 0

    # =====================================================
    # DISCHARGES TODAY
    # Count distinct patients released from nursing care to OPD.
    # =====================================================

    discharges = 0

    try:
        discharges = (
            db.session.query(
                db.func.count(
                    db.func.distinct(NursingRecord.patient_id)
                )
            )
            .filter(
                NursingRecord.released_to_opd_at >= today,
                NursingRecord.released_to_opd_at < tomorrow
            )
            .scalar()
            or 0
        )
    except Exception:
        db.session.rollback()
        discharges = 0

    # =====================================================
    # REVENUE TODAY
    # =====================================================

    revenue_today = 0.0

    try:

        bills = Billing.query.filter(
            Billing.bill_date >= today,
            Billing.bill_date < tomorrow
        ).all()

        for bill in bills:

            revenue_today += safe_float(
                bill.amount_paid
            )

    except Exception:

        revenue_today = 0.0

    # =====================================================
    # BEDS
    # =====================================================

    total_beds = 0
    available_beds = 0

    try:

        total_beds = Bed.query.count()

        available_beds = Bed.query.filter(
            db.func.upper(
                Bed.status
            ) == "AVAILABLE"
        ).count()

    except Exception:

        total_beds = 0
        available_beds = 0

    # =====================================================
    # LAB WORKLOAD
    # =====================================================

    lab_pending = 0

    try:

        lab_pending = LabRequest.query.filter(
            db.func.upper(
                LabRequest.status
            ).in_([
                "PENDING",
                "PROCESSING",
                "REQUESTED",
                "IN PROGRESS"
            ])
        ).count()

    except Exception:

        lab_pending = 0

    # =====================================================
    # RADIOLOGY WORKLOAD
    # Use the request queue that radiology staff actually see.
    # =====================================================

    radiology_pending = 0

    try:
        radiology_pending = RadiologyRequest.query.filter(
            db.func.upper(db.func.trim(RadiologyRequest.status)) == "PENDING"
        ).count()
    except Exception:
        db.session.rollback()
        radiology_pending = 0

    # =====================================================
    # NURSING / WARD WORKLOAD
    # A patient is under nursing care only while assigned to an
    # occupied bed. This deliberately excludes the nurse-referral
    # queue, which is not the ward's current patient workload.
    # =====================================================

    nursing_ward_workload = 0

    try:
        nursing_ward_workload = (
            db.session.query(db.func.count(db.func.distinct(Bed.patient_id)))
            .filter(
                db.func.upper(db.func.trim(Bed.status)) == "OCCUPIED",
                Bed.patient_id.isnot(None)
            )
            .scalar()
            or 0
        )
    except Exception:
        db.session.rollback()
        nursing_ward_workload = 0

    # =====================================================
    # PHARMACY WORKLOAD
    # =====================================================

    pharmacy_pending = 0

    try:

        pharmacy_pending = Prescription.query.filter(
            db.func.lower(
                Prescription.status
            ).in_([
                "active",
                "pending",
                "ordered",
                "prescribed"
            ])
        ).count()

    except Exception:

        try:

            pharmacy_pending = PharmacyDispense.query.filter(
                db.func.lower(
                    PharmacyDispense.status
                ).in_([
                    "pending",
                    "active",
                    "processing"
                ])
            ).count()

        except Exception:

            pharmacy_pending = 0

    # =====================================================
    # STAFF COUNTS
    # =====================================================

    staff_on_duty = 0
    total_staff = 0

    try:
        staff_on_duty = Staff.query.filter(
            db.func.upper(
                db.func.trim(Staff.status)
            ).in_([
                "ON DUTY",
                "ON_DUTY",
                "ON-DUTY",
                "ACTIVE"
            ])
        ).count()

        total_staff = Staff.query.count()

    except Exception:
        db.session.rollback()
        staff_on_duty = 0
        total_staff = 0

    # =====================================================
    # LIVE CLINICAL WORKFLOW
    # =====================================================

    workflow = []

    try:

        triages = TriageRecord.query.order_by(
            TriageRecord.created_at.desc()
        ).limit(50).all()

        for triage in triages:

            # ---------------------------------------------
            # PATIENT
            # ---------------------------------------------

            try:

                patient = db.session.get(
                    Patient,
                    triage.patient_id
                )

            except Exception:

                patient = None

            # ---------------------------------------------
            # CLINICAL RECORD
            # ---------------------------------------------

            try:

                clinical = ClinicalRecord.query.filter_by(
                    patient_id=triage.patient_id
                ).order_by(
                    ClinicalRecord.created_at.desc()
                ).first()

            except Exception:

                clinical = None

            # ---------------------------------------------
            # DIAGNOSIS
            # ---------------------------------------------

            try:

                diagnosis = Diagnosis.query.filter_by(
                    patient_id=triage.patient_id
                ).order_by(
                    Diagnosis.created_at.desc()
                ).first()

            except Exception:

                diagnosis = None

            # ---------------------------------------------
            # BILLING
            # ---------------------------------------------

            try:

                billing = Billing.query.filter_by(
                    patient_id=triage.patient_id
                ).order_by(
                    Billing.bill_date.desc()
                ).first()

            except Exception:

                billing = None

            # ---------------------------------------------
            # WORKFLOW STAGE
            # ---------------------------------------------

            if clinical:

                stage = "Doctor Consultation"

            else:

                stage = "Waiting / Triage"

            # ---------------------------------------------
            # PRIORITY
            # ---------------------------------------------

            priority = (
                getattr(
                    triage,
                    "priority",
                    None
                )
                or "P3 (Low)"
            )

            # ---------------------------------------------
            # BLOOD PRESSURE
            # ---------------------------------------------

            bp = (
                getattr(
                    triage,
                    "blood_pressure",
                    None
                )
                or "-"
            )

            # ---------------------------------------------
            # SPO2
            # ---------------------------------------------

            spo2_value = (
                getattr(triage, "spo2", None)
                or getattr(triage, "oxygen_saturation", None)
                or getattr(triage, "spo2_percent", None)
            )

            # Show only measurements that exist in the database.
            vital_parts = []
            if bp is not None and str(bp).strip() and str(bp).strip() != "-":
                vital_parts.append(f"BP: {str(bp).strip()}")
            if spo2_value is not None and str(spo2_value).strip():
                vital_parts.append(f"SpO2: {str(spo2_value).strip()}%")
            vitals = " · ".join(vital_parts) if vital_parts else "Not recorded"

            # ---------------------------------------------
            # DIAGNOSIS
            # ---------------------------------------------

            diagnosis_text = "-"

            if diagnosis:

                diagnosis_text = (
                    getattr(
                        diagnosis,
                        "diagnosis",
                        None
                    )
                    or "-"
                )

            elif clinical:

                diagnosis_text = (
                    getattr(
                        clinical,
                        "final_diagnosis",
                        None
                    )
                    or getattr(
                        clinical,
                        "provisional_diagnosis",
                        None
                    )
                    or "-"
                )

            # ---------------------------------------------
            # BILLING STATUS
            # ---------------------------------------------

            billing_status = "No Bill"

            billing_amount = 0.0
            balance = 0.0

            if billing:

                billing_status = (
                    getattr(
                        billing,
                        "payment_status",
                        None
                    )
                    or "Unpaid"
                )

                billing_amount = safe_float(
                    getattr(
                        billing,
                        "total_amount",
                        0
                    )
                )

                balance = safe_float(
                    getattr(
                        billing,
                        "balance",
                        0
                    )
                )

            # ---------------------------------------------
            # WORKFLOW ITEM
            # ---------------------------------------------

            workflow.append({

                "patient_id": (
                    getattr(
                        patient,
                        "id",
                        None
                    )
                    or triage.patient_id
                ),

                "patient_number": (
                    getattr(
                        patient,
                        "patient_id",
                        None
                    )
                    if patient
                    else None
                ),

                "name": patient_name(
                    patient
                ),

                "stage": stage,

                "priority": priority,

                "vitals": vitals,

                "blood_pressure": bp,

                "spo2": spo2_value,

                "diagnosis": diagnosis_text,

                "billing": billing_status,

                "billing_amount": billing_amount,

                "balance": balance,

                "action": (
                    "Open Clinical Record"
                    if clinical
                    else "Start Consultation"
                )
            })

    except Exception:

        workflow = []

    # =====================================================
    # TRIAGE AND DOCTOR QUEUES (DATABASE SOURCE OF TRUTH)
    # =====================================================

    triage_workload = 0
    doctor_workload = 0

    try:
        triage_workload = Patient.query.filter(
            Patient.current_phase == "Triage Queue"
        ).count()
    except Exception:
        triage_workload = waiting

    try:
        doctor_workload = Patient.query.filter(
            Patient.current_phase == "Doctor Queue"
        ).count()
    except Exception:
        doctor_workload = 0

    # =====================================================
    # FINAL RESPONSE
    # =====================================================

    return jsonify({

        "success": True,

        "statistics": {

            "patients_today": patients_today,

            "waiting": waiting,

            "triage_workload": triage_workload,

            "doctor_workload": doctor_workload,

            "admissions": admissions,

            "discharges": discharges,

            "revenue_today": round(
                revenue_today,
                2
            ),

            "beds": {

                "available": available_beds,

                "total": total_beds
            },

            "lab_workload": lab_pending,

            "radiology_workload": radiology_pending,

            "nursing_workload": nursing_ward_workload,

            "pharmacy_workload": pharmacy_pending,

            "staff_on_duty": staff_on_duty,

            "total_staff": total_staff
        },

        "workflow": workflow,

        "generated_at": (
            datetime.utcnow().isoformat()
        )
    })

# =========================================================
# STATS ENDPOINT
# =========================================================

@dashboard_bp.route(
    "/api/stats",
    methods=["GET"]
)
def dashboard_stats():

    response = dashboard_api()

    data = response.get_json()

    return jsonify({

        "success": data.get(
            "success",
            True
        ),

        "statistics": data.get(
            "statistics",
            {}
        )
    })

# =========================================================
# WORKFLOW ENDPOINT
# =========================================================

@dashboard_bp.route(
    "/api/workflow",
    methods=["GET"]
)
def dashboard_workflow():

    response = dashboard_api()

    data = response.get_json()

    return jsonify({

        "success": data.get(
            "success",
            True
        ),

        "workflow": data.get(
            "workflow",
            []
        )
    })
