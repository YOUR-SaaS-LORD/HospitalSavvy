from extensions import db
from datetime import datetime

class SurgicalRecord(db.Model):
    __tablename__ = "surgical_records"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False
    )

    procedure = db.Column(
        db.String(255),
        nullable=False
    )

    consent = db.Column(
        db.String(100)
    )

    surgeon_id = db.Column(
        db.Integer,
        db.ForeignKey("staff.id"),
        nullable=True
    )

    anaesthetist = db.Column(
        db.String(255)
    )

    anaesthesia_type = db.Column(
        db.String(100)
    )

    operation_notes = db.Column(
        db.Text
    )

    status = db.Column(
        db.String(50),
        default="SCHEDULED"
    )

    scheduled_at = db.Column(
        db.DateTime
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow
    )