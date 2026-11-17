from extensions import db
from datetime import datetime

# =========================================================
# TRIAGE RECORD
# =========================================================

class TriageRecord(db.Model):

    __tablename__ = "triage_records"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False
    )

    # =====================================================
    # VITAL SIGNS
    # =====================================================

    weight = db.Column(
        db.Float
    )

    height = db.Column(
        db.Float
    )

    bmi = db.Column(
        db.Float
    )

    blood_pressure = db.Column(
        db.String(30)
    )

    temperature = db.Column(
        db.Float
    )

    pulse_rate = db.Column(
        db.Integer
    )

    respiratory_rate = db.Column(
        db.Integer
    )

    oxygen_saturation = db.Column(
        db.Float
    )

    blood_sugar = db.Column(
        db.Float
    )

    pain_score = db.Column(
        db.Integer
    )

    # =====================================================
    # NURSING / RISK ASSESSMENT
    # =====================================================

    chief_complaint = db.Column(
        db.Text
    )

    allergies = db.Column(
        db.Text
    )

    pregnancy_status = db.Column(
        db.String(50)
    )

    gcs = db.Column(
        db.Integer
    )

    fall_risk = db.Column(
        db.String(50)
    )

    priority = db.Column(
        db.String(50)
    )

    # =====================================================
    # ASSESSMENT
    # =====================================================

    assessed_by = db.Column(
        db.Integer
    )

    # =====================================================
    # CREATED
    # =====================================================

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow
    )
