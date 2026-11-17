from flask import Blueprint, request, jsonify, session
from datetime import datetime

from extensions import db
from models.billing import Billing
from models.patient import Patient, Visit
from models.hospital import Service

billing_bp = Blueprint(
    "billing",
    __name__,
    url_prefix="/api/billing"
)


def patient_in_active_department(patient_id):
    department_id = session.get("department_id")
    return bool(session.get("user_id") and department_id and Visit.query.filter(
        Visit.patient_id == patient_id,
        Visit.department_id == department_id,
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")).notin_(["CANCELLED", "CANCELED"]),
    ).first())


@billing_bp.get("/patients")
def get_finance_patients():
    role = str(session.get("role") or "").strip().lower().replace("-", "_").replace(" ", "_")
    if role not in {"accountant", "accounts", "accounts_officer", "finance", "finance_officer", "admin", "system_admin", "hospital_manager"}:
        return jsonify({"success": False, "error": "Finance authorization is required."}), 403

    if not session.get("user_id"):
        return jsonify({"success": False, "error": "Authentication is required."}), 401

    patients = (
        Patient.query.join(Visit, Visit.patient_id == Patient.id)
        .filter(
            db.func.upper(db.func.coalesce(Visit.status, "WAITING")).notin_(["CANCELLED", "CANCELED"]),
        )
        .order_by(Patient.id.asc())
        .distinct()
        .all()
    )
    return jsonify({"success": True, "patients": [
        {"id": patient.id, "patient_id": patient.patient_id, "full_name": patient.full_name}
        for patient in patients
    ]})

# ============================================================
# BILLING HELPERS
# ============================================================

def billing_to_dict(billing):
    return {
        "id": billing.id,
        "patient_id": billing.patient_id,
        "invoice_number": billing.invoice_number,

        "bill_date": (
            billing.bill_date.isoformat()
            if billing.bill_date
            else None
        ),

        "description": billing.description,
        "service_type": billing.service_type,

        "amount": float(billing.amount or 0),
        "discount": float(billing.discount or 0),
        "tax": float(billing.tax or 0),
        "total_amount": float(
            billing.total_amount or 0
        ),

        "amount_paid": float(
            billing.amount_paid or 0
        ),

        "balance": float(
            billing.balance or 0
        ),

        "payment_method": billing.payment_method,
        "payment_status": billing.payment_status,
        "status": billing.status,
        "created_by": billing.created_by,
        "notes": billing.notes,

        "created_at": (
            billing.created_at.isoformat()
            if billing.created_at
            else None
        ),

        "updated_at": (
            billing.updated_at.isoformat()
            if billing.updated_at
            else None
        )
    }

def generate_invoice_number():
    count = Billing.query.count()

    number = count + 1

    invoice = f"INV-{number:06d}"

    # Protect against an accidental duplicate.
    while Billing.query.filter_by(
        invoice_number=invoice
    ).first():

        number += 1

        invoice = f"INV-{number:06d}"

    return invoice

# ============================================================
# GET PATIENT BILLING HISTORY
# ============================================================

@billing_bp.get("/patient/<int:patient_id>")
def get_patient_billing(patient_id):

    patient = Patient.query.get(patient_id)

    if not patient:
        return jsonify({
            "success": False,
            "error": "Patient not found"
        }), 404

    billings = (
        Billing.query
        .filter(
            Billing.patient_id == patient_id,
            Billing.status != "Cancelled"
        )
        .order_by(
            Billing.created_at.desc()
        )
        .all()
    )

    return jsonify({
        "success": True,
        "patient_id": patient_id,
        "billings": [
            billing_to_dict(item)
            for item in billings
        ]
    })

# ============================================================
# CREATE / UPDATE A BILL
# ============================================================

@billing_bp.post("/bill")
def create_or_update_bill():

    return jsonify({
        "success": False,
        "error": "Manual patient billing is disabled. Charges are created from configured service tariffs.",
    }), 410

    data = request.get_json() or {}

    patient_id = data.get("patient_id")

    if not patient_id:
        return jsonify({
            "success": False,
            "error": "patient_id is required"
        }), 400

    patient = Patient.query.get(patient_id)

    if not patient:
        return jsonify({
            "success": False,
            "error": "Patient not found"
        }), 404

    try:
        amount = float(
            data.get("amount", 0) or 0
        )

        discount = float(
            data.get("discount", 0) or 0
        )

        tax = float(
            data.get("tax", 0) or 0
        )

    except (TypeError, ValueError):

        return jsonify({
            "success": False,
            "error": "Invalid billing amount"
        }), 400

    if amount < 0:
        return jsonify({
            "success": False,
            "error": "Amount cannot be negative"
        }), 400

    if discount < 0:
        return jsonify({
            "success": False,
            "error": "Discount cannot be negative"
        }), 400

    if discount > amount:
        discount = amount

    total = max(
        amount - discount + tax,
        0
    )

    billing = Billing(
        patient_id=patient_id,

        invoice_number=
            generate_invoice_number(),

        description=data.get(
            "description",
            "OPD Service"
        ),

        service_type=data.get(
            "service_type",
            "OPD"
        ),

        amount=amount,
        discount=discount,
        tax=tax,
        total_amount=total,

        amount_paid=0,
        balance=total,

        payment_method=None,

        payment_status="Unpaid",

        status="Active",

        created_by=(
            session.get("username")
            or "System"
        ),

        notes=data.get("notes")
    )

    billing.calculate_totals()

    db.session.add(billing)

    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Bill created",
        "billing": billing_to_dict(
            billing
        )
    }), 201


# ============================================================
# CREATE A BILL FROM THE CONFIGURED SERVICE CATALOG TARIFF
# ============================================================

@billing_bp.post("/service-charge")
def create_service_charge():
    return jsonify({
        "success": False,
        "error": "Service charges are added automatically when the patient completes the corresponding workflow step.",
    }), 410

    data = request.get_json(silent=True) or {}
    patient_id = data.get("patient_id")
    service_name = str(data.get("service_name") or "").strip()
    quantity_raw = data.get("quantity", 1)
    try:
        patient_id = int(patient_id)
        quantity = int(quantity_raw)
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "Valid patient_id and whole-number quantity are required."}), 400
    if quantity < 1:
        return jsonify({"success": False, "error": "Quantity must be at least one."}), 400
    patient = Patient.query.get(patient_id)
    if not patient:
        return jsonify({"success": False, "error": "Patient not found."}), 404
    if not service_name:
        return jsonify({"success": False, "error": "service_name from Service Catalog & Tariffs is required."}), 400
    service = Service.query.filter(db.func.lower(Service.name) == service_name.lower()).first()
    if not service:
        return jsonify({"success": False, "error": f"No matching tariff found for '{service_name}'. Add it in Service Catalog & Tariffs first."}), 404
    amount = round(float(service.fee or 0) * quantity, 2)
    billing = Billing(
        patient_id=patient.id, invoice_number=generate_invoice_number(),
        description=f"{service.name} x {quantity}", service_type=service.name,
        amount=amount, discount=0, tax=0, total_amount=amount,
        amount_paid=0, balance=amount, payment_status="Unpaid", status="Active",
        created_by=session.get("username") or "System",
        notes=f"Automatically calculated from Service Catalog & Tariffs (service ID {service.id}, fee {float(service.fee):.2f}, quantity {quantity})."
    )
    billing.calculate_totals()
    db.session.add(billing)
    db.session.commit()
    return jsonify({"success": True, "message": "Tariff charge added to the patient's Accounts billing card.", "billing": billing_to_dict(billing)}), 201

# ============================================================
# PROCESS PAYMENT AGAINST EXISTING BILL
# ============================================================

@billing_bp.post("/payment")
def process_payment():

    data = request.get_json() or {}

    patient_id = data.get("patient_id")
    billing_id = data.get("billing_id")

    if not patient_id:
        return jsonify({
            "success": False,
            "error": "patient_id is required"
        }), 400

    patient = Patient.query.get(patient_id)

    if not patient:
        return jsonify({
            "success": False,
            "error": "Patient not found"
        }), 404

    # --------------------------------------------------------
    # Find the specific bill if supplied.
    # Otherwise use the latest active bill.
    # --------------------------------------------------------

    if billing_id:

        billing = Billing.query.filter(
            Billing.id == billing_id,
            Billing.patient_id == patient_id
        ).first()

    else:

        billing = (
            Billing.query
            .filter(
                Billing.patient_id == patient_id,
                Billing.status == "Active",
                Billing.balance > 0
            )
            .order_by(
                Billing.created_at.desc()
            )
            .first()
        )

    if not billing:

        return jsonify({
            "success": False,
            "error": "No active bill found for this patient"
        }), 404

    # --------------------------------------------------------
    # Payment amount
    # --------------------------------------------------------

    try:

        payment_amount = float(
            data.get("amount", 0) or 0
        )

    except (TypeError, ValueError):

        return jsonify({
            "success": False,
            "error": "Invalid payment amount"
        }), 400

    if payment_amount <= 0:

        return jsonify({
            "success": False,
            "error": "Payment amount must be greater than zero"
        }), 400

    current_balance = float(
        billing.balance or 0
    )

    if payment_amount > current_balance:

        return jsonify({
            "success": False,
            "error": (
                "Payment exceeds the outstanding balance"
            )
        }), 400

    # --------------------------------------------------------
    # Payment method
    # --------------------------------------------------------

    payment_method = (
        data.get("payment_method")
        or "Cash"
    )

    # --------------------------------------------------------
    # Update database bill
    # --------------------------------------------------------

    billing.amount_paid = float(
        billing.amount_paid or 0
    ) + payment_amount

    billing.payment_method = payment_method

    billing.calculate_totals()

    billing.updated_at = datetime.utcnow()

    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Payment processed",

        "billing": billing_to_dict(
            billing
        )
    }), 200

# ============================================================
# APPLY DISCOUNT / WAIVER TO EXISTING BILL
# ============================================================

@billing_bp.post("/discount")
def apply_discount():

    role = str(session.get("role") or "").strip().lower().replace("-", "_").replace(" ", "_")
    if role not in {"accountant", "accounts", "accounts_officer", "finance", "finance_officer", "admin", "hospital_manager"}:
        return jsonify({"success": False, "error": "Finance authorization is required to apply an invoice waiver."}), 403

    data = request.get_json() or {}

    patient_id = data.get("patient_id")
    billing_id = data.get("billing_id")

    if not patient_id:
        return jsonify({
            "success": False,
            "error": "patient_id is required"
        }), 400

    if not billing_id:
        return jsonify({
            "success": False,
            "error": "billing_id is required"
        }), 400

    billing = Billing.query.filter(
        Billing.id == billing_id,
        Billing.patient_id == patient_id,
        Billing.status == "Active"
    ).first()

    if not billing:

        return jsonify({
            "success": False,
            "error": "Active bill not found"
        }), 404

    try:

        discount = float(
            data.get("discount", 0) or 0
        )

    except (TypeError, ValueError):

        return jsonify({
            "success": False,
            "error": "Invalid discount"
        }), 400

    if discount < 0:

        return jsonify({
            "success": False,
            "error": "Discount cannot be negative"
        }), 400

    if discount > float(billing.amount or 0):

        discount = float(
            billing.amount or 0
        )

    billing.discount = discount

    billing.calculate_totals()

    billing.updated_at = datetime.utcnow()

    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Discount / waiver applied",
        "billing": billing_to_dict(
            billing
        )
    }), 200
