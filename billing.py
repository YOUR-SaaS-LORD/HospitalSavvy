from datetime import datetime
from extensions import db

class Billing(db.Model):
    __tablename__ = "billings"

    id = db.Column(db.Integer, primary_key=True)

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False
    )

    invoice_number = db.Column(
        db.String(100),
        unique=True,
        nullable=False
    )

    bill_date = db.Column(
        db.DateTime,
        default=datetime.utcnow
    )

    description = db.Column(db.Text)

    service_type = db.Column(
        db.String(100)
    )

    amount = db.Column(
        db.Float,
        default=0.0,
        nullable=False
    )

    discount = db.Column(
        db.Float,
        default=0.0
    )

    tax = db.Column(
        db.Float,
        default=0.0
    )

    total_amount = db.Column(
        db.Float,
        default=0.0
    )

    amount_paid = db.Column(
        db.Float,
        default=0.0
    )

    balance = db.Column(
        db.Float,
        default=0.0
    )

    payment_method = db.Column(
        db.String(50)
    )

    payment_status = db.Column(
        db.String(50),
        default="Unpaid"
    )

    status = db.Column(
        db.String(50),
        default="Active"
    )

    created_by = db.Column(
        db.String(150)
    )

    notes = db.Column(db.Text)

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
            "billing_records",
            lazy=True
        )
    )

    def calculate_totals(self):
        self.total_amount = (
            (self.amount or 0.0)
            - (self.discount or 0.0)
            + (self.tax or 0.0)
        )

        self.balance = max(
            (self.total_amount or 0.0)
            - (self.amount_paid or 0.0),
            0.0
        )

        if self.amount_paid <= 0:
            self.payment_status = "Unpaid"
        elif self.amount_paid < self.total_amount:
            self.payment_status = "Partially Paid"
        else:
            self.payment_status = "Paid"

    def to_dict(self):
        return {
            "id": self.id,
            "patient_id": self.patient_id,
            "invoice_number": self.invoice_number,
            "bill_date": (
                self.bill_date.isoformat()
                if self.bill_date
                else None
            ),
            "description": self.description,
            "service_type": self.service_type,
            "amount": self.amount,
            "discount": self.discount,
            "tax": self.tax,
            "total_amount": self.total_amount,
            "amount_paid": self.amount_paid,
            "balance": self.balance,
            "payment_method": self.payment_method,
            "payment_status": self.payment_status,
            "status": self.status,
            "created_by": self.created_by,
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
            )
        }

class HospitalFundDispensing(db.Model):
    """Database-backed register for hospital facilitation fund disbursements."""
    __tablename__ = "hospital_fund_dispensings"

    id = db.Column(db.Integer, primary_key=True)
    reference = db.Column(db.String(80), unique=True, nullable=False, index=True)
    fund_date = db.Column(db.Date, nullable=False, index=True)
    fund_type = db.Column(db.String(120), nullable=False)
    recipient = db.Column(db.String(200), nullable=False)
    department = db.Column(db.String(150), nullable=True)
    amount = db.Column(db.Float, nullable=False, default=0)
    purpose = db.Column(db.Text, nullable=False)
    approved_by = db.Column(db.String(200), nullable=True)
    status = db.Column(db.String(40), nullable=False, default="PENDING")
    notes = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.String(150), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
