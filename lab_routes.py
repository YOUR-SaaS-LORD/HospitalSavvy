from flask import Blueprint, request, jsonify, session

from extensions import db
from models.lab import LabRequest, LabResult
from models.patient import Patient, Visit

lab_bp = Blueprint(
    "lab",
    __name__,
    url_prefix="/api/laboratory"
)


def patient_is_in_active_department(patient_id):
    department_id = session.get("department_id")
    return bool(department_id and Visit.query.filter(
        Visit.patient_id == patient_id,
        Visit.department_id == department_id,
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING",
    ).first())

@lab_bp.get("/requests")
def get_requests():

    department_id = session.get("department_id")
    if not department_id:
        return jsonify([])
    department_patients = db.session.query(Visit.patient_id).filter(
        Visit.department_id == department_id,
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING",
    )

    requests = (
        LabRequest.query
        .filter(
            LabRequest.status == "PENDING",
            LabRequest.patient_id.in_(department_patients),
        )
        .order_by(
            LabRequest.requested_at.asc()
        )
        .all()
    )

    data = []

    for r in requests:

        patient = Patient.query.get(
            r.patient_id
        )

        data.append({

            "id":
                r.id,

            "request_id":
                r.request_id,

            "patient_id":
                r.patient_id,

            "patient_name":
                (
                    patient.full_name
                    if patient
                    else "Unknown Patient"
                ),

            "test_name":
                r.test_name,

            "sample_type":
                r.sample_type,

            "barcode":
                r.barcode,

            "status":
                r.status

        })

    return jsonify(data)


@lab_bp.get("/patients-for-release")
def patients_for_release():
    department_id = session.get("department_id")
    if not department_id:
        return jsonify({"success": True, "patients": []})
    department_patients = db.session.query(Visit.patient_id).filter(
        Visit.department_id == department_id,
        db.func.upper(db.func.coalesce(Visit.status, "WAITING")) == "WAITING",
    )
    patients = (
        Patient.query
        .filter(
            Patient.current_phase == "Laboratory Queue",
            Patient.id.in_(department_patients),
        )
        .order_by(Patient.full_name.asc())
        .all()
    )
    return jsonify({"success": True, "patients": [{
        "id": patient.id,
        "patient_id": patient.patient_id,
        "full_name": patient.full_name,
        "pending_count": LabRequest.query.filter(
            LabRequest.patient_id == patient.id,
            LabRequest.status == "PENDING"
        ).count()
    } for patient in patients]})


@lab_bp.post("/patient/<int:patient_id>/release")
def release_lab_patient(patient_id):
    patient = Patient.query.get(patient_id)
    if not patient:
        return jsonify({"success": False, "error": "Patient not found."}), 404
    if patient.current_phase != "Laboratory Queue":
        return jsonify({"success": False, "error": "This patient is no longer in the laboratory queue."}), 409

    pending_count = LabRequest.query.filter(
        LabRequest.patient_id == patient.id,
        LabRequest.status == "PENDING"
    ).count()
    if pending_count:
        return jsonify({
            "success": False,
            "error": f"Complete all {pending_count} pending laboratory test(s) before releasing this patient."
        }), 409

    patient.current_phase = "Doctor Queue"
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"success": False, "error": "Unable to release patient from the laboratory."}), 500

    return jsonify({"success": True, "message": "Patient released from the laboratory to the Doctor queue."})

@lab_bp.post("/results")
def save_result():

    data = request.get_json() or {}

    request_db_id = data.get(
        "request_id"
    )

    if not request_db_id:

        return jsonify({
            "error":
                "Lab request ID is required"
        }), 400

    lab_request = LabRequest.query.get(
        request_db_id
    )

    if not lab_request:

        return jsonify({
            "error":
                "Lab request not found"
        }), 404

    if lab_request.status != "PENDING":

        return jsonify({
            "error":
                "This lab request has already been completed"
        }), 400

    results_text = data.get(
        "results"
    )

    if not results_text:

        return jsonify({
            "error":
                "Laboratory results are required"
        }), 400

    if not lab_request.patient_id:

        return jsonify({
            "error":
                "This laboratory request has no patient assigned"
        }), 400

    # -------------------------------------------------------
    # UPDATE LABORATORY REQUEST
    # -------------------------------------------------------

    lab_request.barcode = data.get(
        "barcode",
        lab_request.barcode
    )

    lab_request.sample_type = data.get(
        "sample_type",
        lab_request.sample_type
    )

    # -------------------------------------------------------
    # LOGGED-IN LAB STAFF
    # -------------------------------------------------------

    staff_id = session.get(
        "staff_id"
    )

    # -------------------------------------------------------
    # CREATE LAB RESULT
    # -------------------------------------------------------

    result = LabResult(

        patient_id =
            lab_request.patient_id,

        request_id =
            lab_request.id,

        results =
            results_text,

        verification_status =
            data.get(
                "verification_status",
                "Pending Review"
            ),

        verified_by =
            staff_id

    )

    db.session.add(
        result
    )

    # -------------------------------------------------------
    # COMPLETE LAB REQUEST
    # -------------------------------------------------------

    lab_request.status = "COMPLETED"

    # Keep the patient in the laboratory queue until staff explicitly
    # release them after all requested tests are complete.
    pending_count = LabRequest.query.filter(
        LabRequest.patient_id == lab_request.patient_id,
        LabRequest.status == "PENDING"
    ).count()

    db.session.commit()

    return jsonify({

        "success":
            True,

        "message":
            "Laboratory result saved. Patient remains in Lab until released.",

        "pending_count":
            pending_count,

        "request_id":
            lab_request.id,

        "patient_id":
            lab_request.patient_id,

        "doctor_id":
            lab_request.doctor_id

    }), 201
