from datetime import datetime

from extensions import db

class LabRequest(db.Model):
    __tablename__ = "lab_requests"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    request_id = db.Column(
        db.String(30),
        unique=True,
        nullable=False
    )

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False
    )

    doctor_id = db.Column(
        db.Integer,
        db.ForeignKey("staff.id"),
        nullable=True
    )

    test_name = db.Column(
        db.String(255),
        nullable=False
    )

    sample_type = db.Column(
        db.String(100),
        nullable=True
    )

    barcode = db.Column(
        db.String(100),
        nullable=True
    )

    status = db.Column(
        db.String(50),
        nullable=False,
        default="PENDING"
    )

    requested_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False
    )

class LabResult(db.Model):
    __tablename__ = "lab_results"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False
    )

    request_id = db.Column(
        db.Integer,
        db.ForeignKey("lab_requests.id"),
        nullable=False
    )

    results = db.Column(
        db.Text
    )

    verification_status = db.Column(
        db.String(100)
    )

    verified_by = db.Column(
        db.Integer,
        db.ForeignKey("staff.id"),
        nullable=True
    )
    
    verified_staff = db.relationship(
    "Staff",
    foreign_keys=[verified_by]
    )
    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow
    )