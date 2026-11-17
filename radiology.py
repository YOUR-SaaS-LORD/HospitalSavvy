from extensions import db
from datetime import datetime

class RadiologyRequest(db.Model):
    __tablename__ = "radiology_requests"

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

    examination = db.Column(
        db.String(255),
        nullable=False
    )

    status = db.Column(
        db.String(50),
        default="PENDING",
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow
    )

    patient = db.relationship(
        "Patient",
        foreign_keys=[patient_id],
        lazy=True
    )

class RadiologyResult(db.Model):
    __tablename__ = "radiology_results"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    request_id = db.Column(
        db.Integer,
        db.ForeignKey("radiology_requests.id"),
        nullable=False
    )

    image_path = db.Column(
        db.String(500)
    )

    findings = db.Column(
        db.Text
    )

    reported_by = db.Column(
        db.Integer,
        db.ForeignKey("staff.id"),
        nullable=True
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow
    )

    request = db.relationship(
        "RadiologyRequest",
        foreign_keys=[request_id],
        lazy=True
    )

    radiologist = db.relationship(
        "Staff",
        foreign_keys=[reported_by],
        lazy=True
    )