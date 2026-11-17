from flask import Blueprint, jsonify
from datetime import datetime, date

from extensions import db
from models.patient import Patient, Visit
from models.staff import Staff
from models.hospital import Bed
from models.lab import LabRequest
from models.pharmacy import Prescription
from models.emergency import EmergencyCase


reports_bp = Blueprint(
    "reports",
    __name__,
    url_prefix="/api/reports"
)

@reports_bp.get("/dashboard")
def dashboard():
    today = date.today()

    patients_today = Patient.query.filter(
        db.func.date(Patient.created_at) == today
    ).count()

    waiting = Visit.query.filter_by(
        status="WAITING"
    ).count()

    admissions = Visit.query.filter_by(
        status="ADMITTED"
    ).count()

    discharges = Visit.query.filter_by(
        status="DISCHARGED"
    ).count()

    revenue = db.session.query(
        db.func.coalesce(
            db.func.sum(Payment.amount),
            0
        )
    ).scalar()

    total_beds = Bed.query.count()

    available_beds = Bed.query.filter_by(
        status="AVAILABLE"
    ).count()

    lab_pending = LabRequest.query.filter_by(
        status="PENDING"
    ).count()

    pharmacy_pending = Prescription.query.filter_by(
        status="PENDING"
    ).count()

    staff_on_duty = Staff.query.filter_by(
        shift_status="ON DUTY"
    ).count()

    emergencies = EmergencyCase.query.filter_by(
        status="ACTIVE"
    ).count()

    return jsonify({
        "patients_today": patients_today,
        "waiting": waiting,
        "admissions": admissions,
        "discharges": discharges,
        "revenue": float(revenue or 0),
        "beds": {
            "available": available_beds,
            "total": total_beds
        },
        "lab_workload": lab_pending,
        "pharmacy_workload": pharmacy_pending,
        "staff_on_duty": staff_on_duty,
        "emergencies": emergencies
    })