from datetime import datetime

from extensions import db

# =========================================================
# PRESCRIPTION
#
# DATABASE TABLE: prescriptions
#
# ACTUAL COLUMNS:
# id
# patient_id
# doctor_id
# drug_name
# frequency
# duration
# status
# created_at
#
# NO dose
# NO route
# NO instructions
# =========================================================

class Prescription(db.Model):

    __tablename__ = "prescriptions"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False
    )

    doctor_id = db.Column(
        db.Integer,
        nullable=True
    )

    drug_name = db.Column(
        db.String(200),
        nullable=False
    )

    frequency = db.Column(
        db.String(100),
        nullable=True
    )

    duration = db.Column(
        db.String(100),
        nullable=True
    )

    status = db.Column(
        db.String(50),
        nullable=True,
        default="Active"
    )

    created_at = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.utcnow
    )

    def to_dict(self):

        return {
            "id":
                self.id,

            "patient_id":
                self.patient_id,

            "doctor_id":
                self.doctor_id,

            "drug_name":
                self.drug_name,

            "frequency":
                self.frequency,

            "duration":
                self.duration,

            "status":
                self.status,

            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            )
        }

# =========================================================
# DISPENSING RECORD
#
# DATABASE TABLE: dispensing_records
#
# ACTUAL COLUMNS:
# id
# patient_id
# prescription_id
# inventory_item_id
# quantity_dispensed
# expiry_date_checked
# dispensed_by
# created_at
# expiry_date
# =========================================================

class DispensingRecord(db.Model):

    __tablename__ = "dispensing_records"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False
    )

    prescription_id = db.Column(
        db.Integer,
        db.ForeignKey("prescriptions.id"),
        nullable=False
    )

    inventory_item_id = db.Column(
        db.Integer,
        db.ForeignKey("inventory_items.id"),
        nullable=False
    )

    quantity_dispensed = db.Column(
        db.Integer,
        nullable=False
    )

    expiry_date_checked = db.Column(
        db.Date,
        nullable=True
    )

    dispensed_by = db.Column(
        db.Integer,
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.utcnow
    )

    expiry_date = db.Column(
        db.Date,
        nullable=True
    )

    patient = db.relationship(
        "Patient",
        foreign_keys=[patient_id]
    )

    prescription = db.relationship(
        "Prescription",
        foreign_keys=[prescription_id]
    )

    inventory_item = db.relationship(
        "InventoryItem",
        foreign_keys=[inventory_item_id]
    )

    def to_dict(self):

        return {
            "id":
                self.id,

            "patient_id":
                self.patient_id,

            "prescription_id":
                self.prescription_id,

            "inventory_item_id":
                self.inventory_item_id,

            "quantity_dispensed":
                self.quantity_dispensed,

            "expiry_date_checked": (
                self.expiry_date_checked.isoformat()
                if self.expiry_date_checked
                else None
            ),

            "dispensed_by":
                self.dispensed_by,

            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            ),

            "expiry_date": (
                self.expiry_date.isoformat()
                if self.expiry_date
                else None
            )
        }

# =========================================================
# DEPARTMENT DISPENSING
#
# EXISTING MODEL PRESERVED
# =========================================================

class DepartmentDispensing(db.Model):

    __tablename__ = "department_dispensing"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    department_id = db.Column(
        db.Integer,
        db.ForeignKey("departments.id"),
        nullable=False
    )

    inventory_item_id = db.Column(
        db.Integer,
        db.ForeignKey("inventory_items.id"),
        nullable=False
    )

    quantity = db.Column(
        db.Integer,
        nullable=False
    )

    unit = db.Column(
        db.String(50),
        nullable=False
    )

    stock_units_deducted = db.Column(
        db.Integer,
        nullable=False
    )

    dispensed_by = db.Column(
        db.String(100),
        nullable=True
    )

    dispense_date = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.utcnow
    )

    department = db.relationship(
        "Department",
        foreign_keys=[department_id]
    )

    inventory_item = db.relationship(
        "InventoryItem",
        foreign_keys=[inventory_item_id]
    )

    def to_dict(self):

        return {
            "id":
                self.id,

            "department_id":
                self.department_id,

            "inventory_item_id":
                self.inventory_item_id,

            "quantity":
                self.quantity,

            "unit":
                self.unit,

            "stock_units_deducted":
                self.stock_units_deducted,

            "dispensed_by":
                self.dispensed_by,

            "dispense_date": (
                self.dispense_date.isoformat()
                if self.dispense_date
                else None
            )
        }

# =========================================================
# PHARMACY DISPENSE
#
# DATABASE TABLE: pharmacy_dispenses
#
# ACTUAL COLUMNS:
# id
# patient_id
# medication_name
# medication_code
# quantity
# dosage
# frequency
# duration
# prescribed_by
# dispensed_by
# unit_price
# total_amount
# status
# instructions
# remarks
# dispense_date
# created_at
# =========================================================

class PharmacyDispense(db.Model):

    __tablename__ = "pharmacy_dispenses"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id"),
        nullable=False
    )

    medication_name = db.Column(
        db.String(200),
        nullable=False
    )

    medication_code = db.Column(
        db.String(100),
        nullable=True
    )

    quantity = db.Column(
        db.Integer,
        nullable=False
    )

    dosage = db.Column(
        db.String(100),
        nullable=True
    )

    frequency = db.Column(
        db.String(100),
        nullable=True
    )

    duration = db.Column(
        db.String(100),
        nullable=True
    )

    prescribed_by = db.Column(
        db.String(100),
        nullable=True
    )

    dispensed_by = db.Column(
        db.String(100),
        nullable=True
    )

    unit_price = db.Column(
        db.Float,
        nullable=True,
        default=0.0
    )

    total_amount = db.Column(
        db.Float,
        nullable=True,
        default=0.0
    )

    status = db.Column(
        db.String(50),
        nullable=True
    )

    instructions = db.Column(
        db.Text,
        nullable=True
    )

    remarks = db.Column(
        db.Text,
        nullable=True
    )

    dispense_date = db.Column(
        db.DateTime,
        nullable=True
    )

    created_at = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.utcnow
    )

    patient = db.relationship(
        "Patient",
        foreign_keys=[patient_id]
    )

    def to_dict(self):

        return {
            "id":
                self.id,

            "patient_id":
                self.patient_id,

            "medication_name":
                self.medication_name,

            "medication_code":
                self.medication_code,

            "quantity":
                self.quantity,

            "dosage":
                self.dosage,

            "frequency":
                self.frequency,

            "duration":
                self.duration,

            "prescribed_by":
                self.prescribed_by,

            "dispensed_by":
                self.dispensed_by,

            "unit_price":
                self.unit_price,

            "total_amount":
                self.total_amount,

            "status":
                self.status,

            "instructions":
                self.instructions,

            "remarks":
                self.remarks,

            "dispense_date": (
                self.dispense_date.isoformat()
                if self.dispense_date
                else None
            ),

            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            )
        }