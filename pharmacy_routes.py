from datetime import datetime

from flask import Blueprint, request, jsonify, session

from extensions import db

from models.pharmacy import (
    Prescription,
    DispensingRecord,
    DepartmentDispensing
)

from models.inventory import InventoryItem
from models.patient import Patient, Visit
from models.billing import Billing
from models.hospital import Department
from models.staff import Staff

pharmacy_bp = Blueprint(
    "pharmacy",
    __name__,
    url_prefix="/api/pharmacy"
)


def patient_in_active_department(patient_id):
    department_id = session.get("department_id")
    return bool(department_id and Visit.query.filter(
        Visit.patient_id == patient_id,
        Visit.department_id == department_id,
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING",
    ).first())

# =========================================================
# GET CURRENT LOGGED-IN STAFF ID
#
# IMPORTANT:
# session["user_id"] is the User.id.
#
# dispensing_records.dispensed_by has a FOREIGN KEY
# to staff.id.
#
# Therefore:
#
# User.id
#    ↓
# Staff.user_id
#    ↓
# Staff.id
#    ↓
# dispensing_records.dispensed_by
# =========================================================

def get_current_staff_id():

    user_id = session.get("user_id")

    if not user_id:
        return None

    staff = (
        Staff.query
        .filter_by(
            user_id=int(user_id)
        )
        .first()
    )

    if not staff:
        return None

    return staff.id

# =========================================================
# PRESCRIPTION QUEUE
# DATABASE IS THE SOURCE OF TRUTH
# =========================================================

@pharmacy_bp.get("/queue")
def pharmacy_queue():

    department_id = session.get("department_id")
    if not department_id:
        return jsonify({"success": True, "patients": []})
    department_patients = db.session.query(Visit.patient_id).filter(
        Visit.department_id == department_id,
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING",
    )

    rows = (
        db.session.query(
            Patient.id,
            Patient.patient_id,
            Patient.full_name,
            db.func.count(
                Prescription.id
            ).label(
                "prescription_count"
            )
        )
        .join(
            Prescription,
            Prescription.patient_id == Patient.id
        )
        .filter(
            Prescription.status == "Active",
            Patient.id.in_(department_patients),
        )
        .group_by(
            Patient.id,
            Patient.patient_id,
            Patient.full_name
        )
        .order_by(
            Patient.full_name.asc()
        )
        .all()
    )

    return jsonify({
        "success": True,
        "patients": [
            {
                "patient_id": row.id,

                "hospital_patient_id":
                    row.patient_id,

                "full_name":
                    row.full_name,

                "prescription_count":
                    row.prescription_count
            }

            for row in rows
        ]
    })

# =========================================================
# PATIENT PRESCRIPTIONS
#
# PRESCRIPTIONS TABLE ACTUAL COLUMNS:
#
# id
# patient_id
# doctor_id
# drug_name
# frequency
# duration
# status
# created_at
# =========================================================

@pharmacy_bp.get("/patient/<int:patient_id>")
def patient_prescriptions(patient_id):

    prescriptions = (
        Prescription.query
        .filter_by(
            patient_id=patient_id,
            status="Active"
        )
        .order_by(
            Prescription.created_at.asc()
        )
        .all()
    )

    return jsonify({
        "success": True,

        "prescriptions": [

            {
                "id":
                    prescription.id,

                "patient_id":
                    prescription.patient_id,

                "doctor_id":
                    prescription.doctor_id,

                "drug_name":
                    prescription.drug_name,

                "frequency":
                    prescription.frequency,

                "duration":
                    prescription.duration,

                "status":
                    prescription.status,

                "created_at": (
                    prescription.created_at.isoformat()
                    if prescription.created_at
                    else None
                )
            }

            for prescription in prescriptions
        ]
    })

# =========================================================
# ADMINISTRATION INVENTORY
#
# ALWAYS READ CURRENT STOCK FROM DATABASE
# =========================================================

@pharmacy_bp.get("/inventory")
def pharmacy_inventory():

    items = (
        InventoryItem.query
        .order_by(
            InventoryItem.item_name.asc()
        )
        .all()
    )

    return jsonify({

        "success": True,

        "items": [

            {
                "id":
                    item.id,

                "item_code":
                    item.item_code,

                "item_name":
                    item.item_name,

                "category":
                    item.category,

                "drug_type":
                    item.drug_type,

                "valuation_method":
                    item.valuation_method,

                "strips_per_box":
                    item.strips_per_box,

                "price_per_unit":
                    float(item.price_per_unit or 0),

                "price_per_box":
                    float(item.price_per_box) if item.price_per_box is not None else None,

                "quantity":
                    item.quantity,

                "loose_strips":
                    item.loose_strips,

                "reorder_level":
                    item.reorder_level,

                "supplier":
                    item.supplier
            }

            for item in items
        ]
    })

# =========================================================
# STOCK CONSUMPTION
#
# TABLETS:
#     FULL BOXES + LOOSE STRIPS
#
# OTHER ITEMS:
#     UNITS
# =========================================================

# =========================================================
# CONVERT DISPENSING QUANTITY TO INVENTORY STOCK UNITS
#
# UNIT:
#     1 stored inventory quantity
#
# STRIP:
#     1 strip
#
# BOX:
#     TABLETS:
#         1 box = strips_per_box strips
#
#     OTHER MATERIALS:
#         1 box = 1 stored inventory quantity
#
# The returned value is what deduct_inventory_stock()
# removes from the database.
# =========================================================
def calculate_stock_units(
    item,
    quantity,
    unit
):
    quantity = int(quantity)

    if quantity < 1:
        raise ValueError(
            "Quantity must be greater than zero."
        )

    unit = str(
        unit or ""
    ).strip().lower()

    valuation_method = str(
        item.valuation_method or ""
    ).strip().lower()

    drug_type = str(
        item.drug_type or ""
    ).strip().lower()

    strips_per_box = int(
        item.strips_per_box or 0
    )

    # =====================================================
    # VALUATION METHOD IS THE DATABASE SOURCE OF TRUTH
    # =====================================================

    # -----------------------------------------------------
    # STRIPS / BOXES
    # -----------------------------------------------------
    if valuation_method == "strips / boxes":

        if strips_per_box <= 0:
            raise ValueError(
                "This item uses Strips / Boxes valuation "
                "but has no strips-per-box value."
            )

        if unit == "strip":
            return quantity

        if unit == "box":
            return (
                quantity *
                strips_per_box
            )

        raise ValueError(
            "This item must be dispensed in strips or boxes."
        )

    # -----------------------------------------------------
    # BOTTLES
    # -----------------------------------------------------
    if valuation_method == "bottles":

        if unit != "bottle":
            raise ValueError(
                "This item must be dispensed in bottles."
            )

        return quantity

    # -----------------------------------------------------
    # TUBES
    # -----------------------------------------------------
    if valuation_method == "tubes":

        if unit != "tube":
            raise ValueError(
                "This item must be dispensed in tubes."
            )

        return quantity

    # -----------------------------------------------------
    # PIECES
    # -----------------------------------------------------
    if valuation_method == "pieces":

        if unit != "piece":
            raise ValueError(
                "This item must be dispensed in pieces."
            )

        return quantity

    # -----------------------------------------------------
    # BOXES
    # -----------------------------------------------------
    if valuation_method == "boxes":

        if unit != "box":
            raise ValueError(
                "This item must be dispensed in boxes."
            )

        return quantity

    # -----------------------------------------------------
    # PACKS
    # -----------------------------------------------------
    if valuation_method == "packs":

        if unit != "pack":
            raise ValueError(
                "This item must be dispensed in packs."
            )

        return quantity

    # -----------------------------------------------------
    # UNITS
    # -----------------------------------------------------
    if valuation_method == "units":

        if unit != "unit":
            raise ValueError(
                "This item must be dispensed in units."
            )

        return quantity

    # =====================================================
    # UNKNOWN / MISSING VALUATION METHOD
    # =====================================================

    raise ValueError(
        "This inventory item has an invalid or missing "
        "valuation method."
    )
    
def deduct_inventory_stock(
    item,
    stock_units
):

    drug_type = str(
        item.drug_type or ""
    ).strip().lower()

    strips_per_box = int(
        item.strips_per_box or 0
    )

    is_tablet = (
        drug_type == "tablets"
        or strips_per_box > 0
    )

    # -----------------------------------------------------
    # TABLETS
    # -----------------------------------------------------

    if is_tablet:

        if strips_per_box <= 0:

            raise ValueError(
                "This tablet item has no "
                "strips-per-box value."
            )

        full_boxes = int(
            item.quantity or 0
        )

        loose_strips = int(
            item.loose_strips or 0
        )

        total_available_strips = (
            full_boxes *
            strips_per_box
            +
            loose_strips
        )

        if (
            total_available_strips
            <
            stock_units
        ):

            raise ValueError(
                "Insufficient tablet stock. "
                f"Available: "
                f"{total_available_strips} strips."
            )

        remaining_strips = (
            total_available_strips
            -
            stock_units
        )

        item.quantity = (
            remaining_strips
            //
            strips_per_box
        )

        item.loose_strips = (
            remaining_strips
            %
            strips_per_box
        )

        return

    # -----------------------------------------------------
    # NORMAL UNITS
    # -----------------------------------------------------

    available_units = int(
        item.quantity or 0
    )

    if available_units < stock_units:

        raise ValueError(
            "Insufficient stock. "
            f"Available stock: "
            f"{available_units} units."
        )

    item.quantity = (
        available_units -
        stock_units
    )

# =========================================================
# PARSE EXPIRY DATE
# =========================================================

def parse_expiry_date(value):

    if not value:

        return None

    try:

        return datetime.strptime(
            str(value),
            "%Y-%m-%d"
        ).date()

    except ValueError:

        raise ValueError(
            "Expiry date must use YYYY-MM-DD format."
        )

# =========================================================
# DISPENSE PRESCRIPTION MEDICATION
#
# DATABASE TRANSACTION:
#
# 1. Lock prescription
# 2. Lock inventory
# 3. Deduct inventory
# 4. Create dispensing record
# 5. Mark prescription DISPENSED
# 6. Commit
#
# IF ANY STEP FAILS:
# EVERYTHING IS ROLLED BACK.
# =========================================================

@pharmacy_bp.post("/dispense")
def dispense():

    data = request.get_json() or {}

    prescription_id = (
        data.get("prescription_id")
    )

    patient_id = (
        data.get("patient_id")
    )

    inventory_item_id = (
        data.get("inventory_item_id")
    )

    quantity = (
        data.get("quantity")
    )

    unit = str(
        data.get("unit") or "unit"
    ).strip().lower()

    expiry_date = (
        data.get("expiry_date")
    )

    # =====================================================
    # VALIDATE REQUIRED DATA
    # =====================================================

    if not all([
        prescription_id,
        patient_id,
        inventory_item_id,
        quantity
    ]):

        return jsonify({

            "success": False,

            "error": (
                "Prescription, patient, inventory item "
                "and quantity are required."
            )

        }), 400

    try:
        scoped_patient_id = int(patient_id)
    except (TypeError, ValueError):
        scoped_patient_id = None
    if not scoped_patient_id:
        return jsonify({"success": False, "error": "A valid patient is required."}), 400

    # =====================================================
    # VALIDATE QUANTITY
    # =====================================================

    try:

        quantity = int(quantity)

    except (
        TypeError,
        ValueError
    ):

        return jsonify({

            "success": False,

            "error":
                "Quantity must be a whole number."

        }), 400

    # =====================================================
    # GET LOGGED-IN STAFF
    #
    # IMPORTANT:
    # dispensing_records.dispensed_by
    # REFERENCES staff.id
    # =====================================================

    current_staff_id = (
        get_current_staff_id()
    )

    if not current_staff_id:

        return jsonify({

            "success": False,

            "error": (
                "The logged-in user is not linked "
                "to a staff record."
            )

        }), 401

    # =====================================================
    # DATABASE TRANSACTION
    # =====================================================

    try:

        # -------------------------------------------------
        # EXPIRY
        # -------------------------------------------------

        expiry = (
            parse_expiry_date(
                expiry_date
            )
        )

        # -------------------------------------------------
        # LOCK PRESCRIPTION
        # -------------------------------------------------

        prescription = (

            Prescription.query

            .filter_by(
                id=int(
                    prescription_id
                )
            )

            .with_for_update()

            .first()
        )

        if not prescription:

            raise ValueError(
                "Prescription was not found."
            )

        # -------------------------------------------------
        # VERIFY PATIENT
        # -------------------------------------------------

        if (
            prescription.patient_id
            !=
            int(patient_id)
        ):

            raise ValueError(
                "Prescription does not belong "
                "to the selected patient."
            )

        # -------------------------------------------------
        # VERIFY PRESCRIPTION STATUS
        # -------------------------------------------------

        if (
            prescription.status
            !=
            "Active"
        ):

            raise ValueError(
                "This prescription is no longer active."
            )

        # -------------------------------------------------
        # LOCK INVENTORY ITEM
        # -------------------------------------------------

        item = (

            InventoryItem.query

            .filter_by(
                id=int(
                    inventory_item_id
                )
            )

            .with_for_update()

            .first()
        )

        if not item:

            raise ValueError(
                "Inventory item was not found."
            )

        # -------------------------------------------------
        # CALCULATE STOCK CONSUMPTION
        # -------------------------------------------------

        stock_units = (
            calculate_stock_units(
                item,
                quantity,
                unit
            )
        )

        # -------------------------------------------------
        # DEDUCT INVENTORY
        # -------------------------------------------------

        deduct_inventory_stock(
            item,
            stock_units
        )

        # -------------------------------------------------
        # CREATE DISPENSING RECORD
        #
        # ACTUAL dispensing_records COLUMNS:
        #
        # id
        # patient_id
        # prescription_id
        # inventory_item_id
        # quantity_dispensed
        # expiry_date_checked
        # dispensed_by
        # created_at
        # expiry_date
        #
        # dispensed_by MUST BE staff.id
        # -------------------------------------------------

        record = DispensingRecord(

            patient_id=
                prescription.patient_id,

            prescription_id=
                prescription.id,

            inventory_item_id=
                item.id,

            quantity_dispensed=
                quantity,

            expiry_date_checked=
                expiry,

            dispensed_by=
                current_staff_id,

            expiry_date=
                expiry
        )

        db.session.add(
            record
        )
        db.session.flush()

        # Bill at the stocking cost for the unit that was actually dispensed.
        # Stock deduction remains in strips for tablet boxes, but the billed box
        # cost is independently recorded and is not derived from the strip rate.
        valuation = str(item.valuation_method or '').strip().lower()
        if valuation == 'strips / boxes' and unit == 'box':
            price_per_unit = item.price_per_box
            if price_per_unit is None:
                # Legacy tablet items only stored the strip rate.
                price_per_unit = float(item.price_per_unit or 0) * int(item.strips_per_box or 0)
            billed_units = quantity
        else:
            price_per_unit = float(item.price_per_unit or 0)
            billed_units = stock_units
        price_per_unit = float(price_per_unit or 0)
        pharmacy_charge = round(price_per_unit * billed_units, 2)
        if pharmacy_charge > 0:
            invoice_number = f"INV-PH-{record.id:08d}"
            bill = Billing(
                patient_id=prescription.patient_id,
                invoice_number=invoice_number,
                description=(f"Pharmacy dispense #{record.id}: {item.item_name} "
                             f"({quantity} {unit}{'s' if quantity != 1 else ''} @ {price_per_unit:,.2f} per {unit})"),
                service_type="Pharmacy",
                amount=pharmacy_charge,
                discount=0, tax=0, total_amount=pharmacy_charge,
                amount_paid=0, balance=pharmacy_charge,
                payment_status="Unpaid", status="Active",
                created_by=session.get("username") or "Pharmacy",
                notes=(f"Inventory item ID {item.id}; valuation {valuation}; "
                       f"stock units deducted {stock_units}; billed {quantity} {unit}(s) "
                       f"at {price_per_unit:.2f} per {unit} from the cost saved during stocking." )
            )
            bill.calculate_totals()
            db.session.add(bill)

        # -------------------------------------------------
        # MARK PRESCRIPTION AS DISPENSED
        # -------------------------------------------------

        prescription.status = (
            "DISPENSED"
        )

        # -------------------------------------------------
        # COMMIT EVERYTHING TO DATABASE
        # -------------------------------------------------

        db.session.commit()

        # -------------------------------------------------
        # DETERMINE REMAINING TABLET STOCK
        # -------------------------------------------------

        is_tablet = (

            str(
                item.drug_type or ""
            ).strip().lower()
            ==
            "tablets"

            or

            int(
                item.strips_per_box or 0
            )
            >
            0
        )

        # -------------------------------------------------
        # SUCCESS RESPONSE
        # -------------------------------------------------

        return jsonify({

            "success":
                True,

            "message":
                "Medication dispensed successfully.",

            "inventory_item_id":
                item.id,

            "stock_remaining":
                item.quantity,

            "loose_strips": (

                item.loose_strips
                if is_tablet
                else 0
            ),

            "stock_deducted":
                stock_units,

            "quantity_dispensed":
                quantity,

            "unit":
                unit,

            "pharmacy_bill_amount":
                pharmacy_charge,

            "pharmacy_bill_unit_cost":
                price_per_unit,

            "prescription_id":
                prescription.id,

            "patient_id":
                prescription.patient_id,

            "dispensed_by":
                current_staff_id

        }), 201

    # =====================================================
    # EXPECTED VALIDATION ERROR
    # =====================================================

    except ValueError as error:

        db.session.rollback()

        return jsonify({

            "success":
                False,

            "error":
                str(error)

        }), 400

    # =====================================================
    # DATABASE / UNEXPECTED ERROR
    # =====================================================

    except Exception as error:

        db.session.rollback()

        print(
            "PHARMACY DISPENSE ERROR:",
            error
        )

        return jsonify({

            "success":
                False,

            "error":
                "Unable to complete medication dispensing."

        }), 500

# =========================================================
# DEPARTMENT MATERIAL DISPENSING
#
# SAME ADMINISTRATION INVENTORY IS REDUCED.
# =========================================================

@pharmacy_bp.post("/department-dispense")
def department_dispense():

    data = (
        request.get_json()
        or {}
    )

    department_id = (
        data.get("department_id")
    )

    inventory_item_id = (
        data.get("inventory_item_id")
    )

    quantity = (
        data.get("quantity")
    )

    unit = str(
        data.get("unit") or "unit"
    ).strip().lower()

    # =====================================================
    # VALIDATE REQUIRED DATA
    # =====================================================

    if not all([
        department_id,
        inventory_item_id,
        quantity
    ]):

        return jsonify({

            "success":
                False,

            "error": (
                "Department, inventory item "
                "and quantity are required."
            )

        }), 400

    # =====================================================
    # VALIDATE QUANTITY
    # =====================================================

    try:

        quantity = int(
            quantity
        )

    except (
        TypeError,
        ValueError
    ):

        return jsonify({

            "success":
                False,

            "error":
                "Quantity must be a whole number."

        }), 400

    # =====================================================
    # DATABASE TRANSACTION
    # =====================================================

    try:

        # -------------------------------------------------
        # VERIFY DEPARTMENT
        # -------------------------------------------------

        department = (

            Department.query

            .filter_by(
                id=int(
                    department_id
                )
            )

            .first()
        )

        if not department:

            raise ValueError(
                "Department was not found."
            )

        # -------------------------------------------------
        # LOCK INVENTORY ITEM
        # -------------------------------------------------

        item = (

            InventoryItem.query

            .filter_by(
                id=int(
                    inventory_item_id
                )
            )

            .with_for_update()

            .first()
        )

        if not item:

            raise ValueError(
                "Inventory item was not found."
            )

        # -------------------------------------------------
        # CALCULATE STOCK UNITS
        # -------------------------------------------------

        stock_units = (
            calculate_stock_units(
                item,
                quantity,
                unit
            )
        )

        # -------------------------------------------------
        # DEDUCT INVENTORY
        # -------------------------------------------------

        deduct_inventory_stock(
            item,
            stock_units
        )

        # -------------------------------------------------
        # CREATE DEPARTMENT DISPENSING RECORD
        #
        # KEEPING THE EXISTING MODEL STRUCTURE:
        #
        # department_id
        # inventory_item_id
        # quantity
        # unit
        # stock_units_deducted
        # dispensed_by
        # -------------------------------------------------

        record = DepartmentDispensing(

            department_id=
                department.id,

            inventory_item_id=
                item.id,

            quantity=
                quantity,

            unit=
                unit,

            stock_units_deducted=
                stock_units,

            dispensed_by=(
                session.get(
                    "username"
                )
                or
                "Pharmacy"
            )
        )

        db.session.add(
            record
        )

        # -------------------------------------------------
        # COMMIT INVENTORY + RECORD
        # -------------------------------------------------

        db.session.commit()

        # -------------------------------------------------
        # TABLET CHECK
        # -------------------------------------------------

        is_tablet = (

            str(
                item.drug_type or ""
            ).strip().lower()
            ==
            "tablets"

            or

            int(
                item.strips_per_box or 0
            )
            >
            0
        )

        # -------------------------------------------------
        # SUCCESS
        # -------------------------------------------------

        return jsonify({

            "success":
                True,

            "message":
                "Material dispensed to department successfully.",

            "department_id":
                department.id,

            "inventory_item_id":
                item.id,

            "stock_remaining":
                item.quantity,

            "loose_strips": (

                item.loose_strips
                if is_tablet
                else 0
            ),

            "stock_deducted":
                stock_units,

            "quantity_dispensed":
                quantity,

            "unit":
                unit

        }), 201

    # =====================================================
    # EXPECTED VALIDATION ERROR
    # =====================================================

    except ValueError as error:

        db.session.rollback()

        return jsonify({

            "success":
                False,

            "error":
                str(error)

        }), 400

    # =====================================================
    # DATABASE / UNEXPECTED ERROR
    # =====================================================

    except Exception as error:

        db.session.rollback()

        print(
            "PHARMACY DEPARTMENT DISPENSE ERROR:",
            error
        )

        return jsonify({

            "success":
                False,

            "error":
                "Unable to complete department dispensing."

        }), 500

