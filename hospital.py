from extensions import db

class Department(db.Model):
    __tablename__ = "departments"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    name = db.Column(
        db.String(150),
        unique=True,
        nullable=False
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name
        }

class Ward(db.Model):
    __tablename__ = "wards"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    name = db.Column(
        db.String(150),
        nullable=False
    )

    capacity = db.Column(
        db.Integer,
        nullable=False
    )

    # Relationship to Bed model
    beds = db.relationship(
        "Bed",
        backref="ward",
        lazy=True,
        cascade="all, delete-orphan"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "capacity": self.capacity,
            "total_beds": len(self.beds) if self.beds else 0
        }

class Bed(db.Model):
    __tablename__ = "beds"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    bed_number = db.Column(
        db.String(50),
        unique=True,
        nullable=False
    )

    ward_id = db.Column(
        db.Integer,
        db.ForeignKey("wards.id"),
        nullable=False
    )

    status = db.Column(
        db.String(50),
        default="AVAILABLE",
        nullable=False
    )

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=True
    )

    def to_dict(self):
        return {
            "id": self.id,
            "bed_number": self.bed_number,
            "ward_id": self.ward_id,
            "status": self.status,
            "patient_id": self.patient_id
        }

class Service(db.Model):
    __tablename__ = "services"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    name = db.Column(
        db.String(200),
        nullable=False
    )

    fee = db.Column(
        db.Numeric(12, 2),
        nullable=False
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "fee": float(self.fee)
        }