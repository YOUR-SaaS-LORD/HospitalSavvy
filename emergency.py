from datetime import datetime

from extensions import db

class EmergencyCase(db.Model):
    __tablename__ = "emergency_cases"

    # =====================================================
    # PRIMARY KEY
    # =====================================================

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    # =====================================================
    # CASE IDENTIFICATION
    # =====================================================

    case_id = db.Column(
        db.String(30),
        unique=True,
        nullable=False,
        index=True
    )

    # =====================================================
    # PATIENT
    # =====================================================

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False,
        index=True
    )

    # =====================================================
    # ARRIVAL
    # =====================================================

    arrival_mode = db.Column(
        db.String(100)
    )

    arrival_time = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True
    )

    # =====================================================
    # TRIAGE PRIORITY
    #
    # Dashboard uses this to identify RED cases.
    # =====================================================

    priority = db.Column(
        db.String(50),
        default="GREEN",
        index=True
    )

    # =====================================================
    # EMERGENCY AREA
    # =====================================================

    area = db.Column(
        db.String(100)
    )

    # =====================================================
    # PRIMARY SURVEY
    # =====================================================

    airway = db.Column(
        db.String(100)
    )

    breathing = db.Column(
        db.String(100)
    )

    circulation = db.Column(
        db.String(100)
    )

    consciousness = db.Column(
        db.String(100)
    )

    # =====================================================
    # VITAL SIGNS
    # =====================================================

    blood_pressure = db.Column(
        db.String(30)
    )

    pulse = db.Column(
        db.Integer
    )

    spo2 = db.Column(
        db.Integer
    )

    gcs = db.Column(
        db.Integer
    )

    # =====================================================
    # CLINICAL INFORMATION
    # =====================================================

    complaint = db.Column(
        db.Text
    )

    medical_history = db.Column(
        db.Text
    )

    intervention = db.Column(
        db.Text
    )

    medication = db.Column(
        db.Text
    )

    # =====================================================
    # RESPONSIBLE DOCTOR
    #
    # Dashboard uses doctor_id IS NULL to determine
    # emergencies awaiting a doctor.
    # =====================================================

    doctor_id = db.Column(
        db.Integer,
        db.ForeignKey("staff.id"),
        nullable=True,
        index=True
    )

    # =====================================================
    # NOTES
    # =====================================================

    notes = db.Column(
        db.Text
    )

    # =====================================================
    # DISPOSITION
    #
    # Examples:
    # ADMIT
    # DISCHARGE
    # TRANSFER
    # REFER
    # DECEASED
    # =====================================================

    disposition = db.Column(
        db.String(100),
        index=True
    )

    # =====================================================
    # STATUS
    #
    # Dashboard considers these active unless status is:
    # completed
    # closed
    # discharged
    # resolved
    # death
    # deceased
    # =====================================================

    status = db.Column(
        db.String(50),
        default="ACTIVE",
        nullable=False,
        index=True
    )

    # =====================================================
    # CREATED
    # =====================================================

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True
    )

    # =====================================================
    # DOCTOR RELATIONSHIP
    # =====================================================

    doctor = db.relationship(
        "Staff",
        foreign_keys=[doctor_id],
        backref=db.backref(
            "emergency_cases",
            lazy=True
        )
    )

    # =====================================================
    # SERIALIZATION
    # =====================================================

    def to_dict(self):

        return {
            "id": self.id,

            "case_id": self.case_id,

            "patient_id": self.patient_id,

            "arrival_mode": self.arrival_mode,

            "arrival_time": (
                self.arrival_time.isoformat()
                if self.arrival_time
                else None
            ),

            "priority": self.priority,

            "area": self.area,

            "airway": self.airway,

            "breathing": self.breathing,

            "circulation": self.circulation,

            "consciousness": self.consciousness,

            "blood_pressure": self.blood_pressure,

            "pulse": self.pulse,

            "spo2": self.spo2,

            "gcs": self.gcs,

            "complaint": self.complaint,

            "medical_history": self.medical_history,

            "intervention": self.intervention,

            "medication": self.medication,

            "doctor_id": self.doctor_id,

            "notes": self.notes,

            "disposition": self.disposition,

            "status": self.status,

            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            )
        }