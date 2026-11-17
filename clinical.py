from extensions import db
from datetime import datetime

# =========================================================
# CLINICAL RECORD
# =========================================================

class ClinicalRecord(db.Model):
    __tablename__ = "clinical_records"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False,
        index=True
    )

    doctor_id = db.Column(
        db.Integer,
        db.ForeignKey("staff.id"),
        nullable=True,
        index=True
    )

    hpi = db.Column(
        db.Text
    )

    past_history = db.Column(
        db.Text
    )

    examination = db.Column(
        db.Text
    )

    social_history = db.Column(
        db.Text
    )

    provisional_diagnosis = db.Column(
        db.Text
    )

    differential_diagnosis = db.Column(
        db.Text
    )

    final_diagnosis = db.Column(
        db.Text
    )

    lab_order = db.Column(
        db.Text
    )

    radiology_order = db.Column(
        db.Text
    )

    review_date = db.Column(
        db.Date
    )

    referral_destination = db.Column(
        db.String(100)
    )

    referral_notes = db.Column(
        db.Text
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow
    )

# =========================================================
# DIAGNOSIS
# =========================================================

class Diagnosis(db.Model):
    __tablename__ = "diagnoses"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False
    )

    diagnosis = db.Column(
        db.String(255),
        nullable=False
    )

    icd10_code = db.Column(
        db.String(50)
    )

    diagnosis_type = db.Column(
        db.String(50)
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow
    )

# =========================================================
# REFERRAL
# =========================================================

class Referral(db.Model):
    __tablename__ = "referrals"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    referral_id = db.Column(
        db.String(40),
        unique=True,
        nullable=False,
        index=True
    )

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False,
        index=True
    )

    doctor_id = db.Column(
        db.Integer,
        db.ForeignKey("staff.id"),
        nullable=False,
        index=True
    )

    destination = db.Column(
        db.String(50),
        nullable=False,
        index=True
    )

    notes = db.Column(
        db.Text,
        nullable=True
    )

    status = db.Column(
        db.String(30),
        default="PENDING",
        nullable=False,
        index=True
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True
    )

    completed_at = db.Column(
        db.DateTime,
        nullable=True
    )