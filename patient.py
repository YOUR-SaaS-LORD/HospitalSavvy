from datetime import datetime

from extensions import db


class Patient(db.Model):
    __tablename__ = "patients"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    patient_id = db.Column(
        db.String(30),
        unique=True,
        nullable=False,
        index=True
    )

    full_name = db.Column(
        db.String(200),
        nullable=False
    )

    date_of_birth = db.Column(
        db.Date,
        nullable=False
    )

    gender = db.Column(
        db.String(30),
        nullable=False
    )

    phone = db.Column(
        db.String(50),
        nullable=False
    )

    # Optional government identity; never required for registration.
    national_id = db.Column(
        db.String(50),
        nullable=True,
        unique=True,
        index=True
    )

    # Registration / routing
    clinic = db.Column(
        db.String(150),
        nullable=True,
        index=True
    )

    registration_date = db.Column(
        db.DateTime,
        nullable=True,
        index=True
    )

    status = db.Column(
        db.String(50),
        default="ACTIVE",
        nullable=False,
        index=True
    )

    current_phase = db.Column(
        db.String(100),
        nullable=True,
        index=True
    )

    current_priority = db.Column(
        db.String(50),
        nullable=True,
        index=True
    )

    # The doctor is identified by Staff.id.
    assigned_doctor_id = db.Column(
        db.Integer,
        db.ForeignKey("staff.id"),
        nullable=True,
        index=True
    )

    current_bed_id = db.Column(
        db.Integer,
        nullable=True,
        index=True
    )

    notes = db.Column(
        db.Text,
        nullable=True
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True
    )

    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        index=True
    )

    admission_date = db.Column(
        db.DateTime,
        nullable=True,
        index=True
    )

    admitted_at = db.Column(
        db.DateTime,
        nullable=True,
        index=True
    )

    discharge_date = db.Column(
        db.DateTime,
        nullable=True,
        index=True
    )

    discharged_at = db.Column(
        db.DateTime,
        nullable=True,
        index=True
    )

    assigned_doctor = db.relationship(
        "Staff",
        foreign_keys=[assigned_doctor_id],
        backref=db.backref(
            "assigned_patients",
            lazy=True
        )
    )

    visits = db.relationship(
        "Visit",
        backref="patient",
        lazy=True,
        cascade="all, delete-orphan"
    )

    emergency_cases = db.relationship(
        "EmergencyCase",
        backref="patient",
        lazy=True
    )

    def to_dict(self):
        return {
            "id": self.id,
            "patient_id": self.patient_id,
            "full_name": self.full_name,
            "date_of_birth": (
                self.date_of_birth.isoformat()
                if self.date_of_birth
                else None
            ),
            "gender": self.gender,
            "phone": self.phone,
            "national_id": self.national_id,
            "clinic": self.clinic,
            "registration_date": (
                self.registration_date.isoformat()
                if self.registration_date
                else None
            ),
            "status": self.status,
            "current_phase": self.current_phase,
            "current_priority": self.current_priority,
            "assigned_doctor_id": self.assigned_doctor_id,
            "assigned_doctor": (
                self.assigned_doctor.full_name
                if self.assigned_doctor
                else None
            ),
            "current_bed_id": self.current_bed_id,
            "notes": self.notes,
            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            ),
            "updated_at": (
                self.updated_at.isoformat()
                if self.updated_at
                else None
            ),
            "admission_date": (
                self.admission_date.isoformat()
                if self.admission_date
                else None
            ),
            "admitted_at": (
                self.admitted_at.isoformat()
                if self.admitted_at
                else None
            ),
            "discharge_date": (
                self.discharge_date.isoformat()
                if self.discharge_date
                else None
            ),
            "discharged_at": (
                self.discharged_at.isoformat()
                if self.discharged_at
                else None
            )
        }


class Visit(db.Model):
    __tablename__ = "visits"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    visit_id = db.Column(
        db.String(30),
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

    # Department/clinic routing belongs to the visit.
    department_id = db.Column(
        db.Integer,
        db.ForeignKey("departments.id"),
        nullable=True,
        index=True
    )

    status = db.Column(
        db.String(50),
        default="WAITING",
        nullable=False,
        index=True
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True
    )

    department = db.relationship(
        "Department",
        backref=db.backref(
            "visits",
            lazy=True
        )
    )

    def to_dict(self):
        return {
            "id": self.id,
            "visit_id": self.visit_id,
            "patient_id": self.patient_id,
            "department_id": self.department_id,
            "consultation_fee": float(
                getattr(self, "consultation_fee", 0) or 0
            ),
            "status": self.status,
            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            )
        }
