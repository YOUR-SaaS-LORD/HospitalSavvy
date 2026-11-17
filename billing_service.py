"""Tariff-based billing helpers shared by clinical workflow routes."""
from extensions import db
from models.billing import Billing
from models.hospital import Service


TARIFF_LABELS = {
    "registration": "Per patient registration",
    "triage": "Per triage assessment",
    "consultation": "Per doctor consultation",
    "lab": "Per lab test",
    "imaging": "Per radio imaging",
    "surgery": "Per surgery",
    "nursing_day": "Per nursing day from admission",
    "guidance": "Per guidance counseling session",
}


def record_tariff_charge(patient_id, category, event_key, detail=None, quantity=1):
    """Add one idempotent tariff charge to the patient billing ledger.

    If the hospital has not configured the matching tariff yet, the workflow
    remains available and no arbitrary amount is invented.
    """
    label = TARIFF_LABELS.get(str(category or "").strip().lower())
    if not label or not event_key:
        return None

    base = label.casefold()
    tariffs = Service.query.filter(
        db.func.lower(Service.name).startswith(base)
    ).order_by(Service.id.asc()).all()
    if detail:
        requested = f"{label} — {str(detail).strip()}".casefold()
        service = next((row for row in tariffs if row.name.casefold() == requested), None)
        if service is None:
            return None
    else:
        service = next((row for row in tariffs if row.name.casefold() == base), None)
        if service is None and len(tariffs) == 1:
            service = tariffs[0]
        if service is None:
            return None

    marker = f"[AUTO:{event_key}]"
    if Billing.query.filter(
        Billing.patient_id == patient_id,
        Billing.notes.contains(marker),
    ).first():
        return None

    try:
        quantity = max(1, int(quantity))
    except (TypeError, ValueError):
        quantity = 1
    amount = round(float(service.fee or 0) * quantity, 2)
    if amount < 0:
        return None

    number = Billing.query.count() + 1
    invoice_number = f"INV-{number:06d}"
    while Billing.query.filter_by(invoice_number=invoice_number).first():
        number += 1
        invoice_number = f"INV-{number:06d}"

    billing = Billing(
        patient_id=patient_id,
        invoice_number=invoice_number,
        description=f"{service.name}" + (f" × {quantity}" if quantity > 1 else ""),
        service_type=service.name,
        amount=amount,
        discount=0,
        tax=0,
        total_amount=amount,
        amount_paid=0,
        balance=amount,
        payment_status="Unpaid",
        status="Active",
        created_by="Automatic tariff",
        notes=f"Automatically billed from Service Catalog & Tariffs; {marker}",
    )
    billing.calculate_totals()
    db.session.add(billing)
    db.session.flush()
    return billing
