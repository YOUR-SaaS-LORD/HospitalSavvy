from datetime import datetime
from extensions import db


class MedicalReport(db.Model):
    __tablename__ = "medical_reports"

    id = db.Column(db.Integer, primary_key=True)

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False
    )

    report_type = db.Column(
        db.String(100),
        nullable=False
    )

    title = db.Column(
        db.String(200),
        nullable=False
    )

    report_date = db.Column(
        db.DateTime,
        default=datetime.utcnow
    )

    doctor_name = db.Column(
        db.String(150)
    )

    department = db.Column(
        db.String(150)
    )

    diagnosis = db.Column(
        db.Text
    )

    findings = db.Column(
        db.Text
    )

    recommendations = db.Column(
        db.Text
    )

    report_content = db.Column(
        db.Text
    )

    status = db.Column(
        db.String(50),
        default="Completed"
    )

    created_by = db.Column(
        db.String(150)
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow
    )

    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )

    patient = db.relationship(
        "Patient",
        backref=db.backref(
            "medical_reports",
            lazy=True
        )
    )

    def to_dict(self):
        return {
            "id": self.id,
            "patient_id": self.patient_id,
            "report_type": self.report_type,
            "title": self.title,
            "report_date": (
                self.report_date.isoformat()
                if self.report_date
                else None
            ),
            "doctor_name": self.doctor_name,
            "department": self.department,
            "diagnosis": self.diagnosis,
            "findings": self.findings,
            "recommendations": self.recommendations,
            "report_content": self.report_content,
            "status": self.status,
            "created_by": self.created_by,
            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            ),
            "updated_at": (
                self.updated_at.isoformat()
                if self.updated_at
                else None
            )
        }