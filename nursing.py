from extensions import db
from datetime import datetime

class NursingRecord(db.Model):

    __tablename__ = "nursing_records"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False
    )

    nurse_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=True
    )

    assessment = db.Column(
        db.Text,
        nullable=True
    )

    nursing_notes = db.Column(
        db.Text,
        nullable=True
    )

    care_plan = db.Column(
        db.Text,
        nullable=True
    )

    interventions = db.Column(
        db.Text,
        nullable=True
    )

    medication_notes = db.Column(
        db.Text,
        nullable=True
    )

    patient_response = db.Column(
        db.Text,
        nullable=True
    )

    vital_signs = db.Column(
        db.Text,
        nullable=True
    )

    shift = db.Column(
        db.String(50),
        nullable=True
    )

    status = db.Column(
        db.String(50),
        default="active",
        nullable=False
    )

    # Time the patient entered inpatient care.
    admitted_at = db.Column(
        db.DateTime,
        nullable=True,
        index=True
    )

    # Time the patient was released from inpatient care to OPD.
    released_to_opd_at = db.Column(
        db.DateTime,
        nullable=True,
        index=True
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False
    )

NursingCare = NursingRecord


class DoctorRoundNote(db.Model):
    __tablename__ = "doctor_round_notes"

    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey("patients.id"), nullable=False, index=True)
    doctor_id = db.Column(db.Integer, db.ForeignKey("staff.id"), nullable=False, index=True)
    note = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)
    doctor = db.relationship("Staff")
