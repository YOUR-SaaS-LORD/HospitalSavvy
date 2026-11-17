from flask import Blueprint, request, jsonify, session
from datetime import datetime

from extensions import db
from billing_service import record_tariff_charge
from models.theatre import SurgicalRecord
from models.clinical import Referral
from models.patient import Patient, Visit
from models.user import User
from models.staff import Staff

surgery_bp = Blueprint(
    "surgery",
    __name__,
    url_prefix="/api/surgery"
)


def _current_staff_department_id():
    user_id = session.get("user_id")
    if not user_id:
        return None
    user = User.query.get(user_id)
    if not user or not user.is_active:
        return None
    staff = Staff.query.filter_by(user_id=user.id).first()
    return session.get("department_id") if staff else None


def _patient_department_id(patient_id):
    visit = Visit.query.filter(
        Visit.patient_id == patient_id
    ).order_by(Visit.created_at.desc()).first()
    return visit.department_id if visit else None

# ============================================================
# DOCTOR REFERRALS → OPERATING THEATRE QUEUE
# ============================================================

@surgery_bp.route("/referrals", methods=["GET"])
def get_theatre_referrals():

    try:

        referrals = (
            Referral.query
            .filter(
                Referral.destination == "theatre",
                Referral.status == "PENDING"
            )
            .order_by(
                Referral.created_at.asc()
            )
            .all()
        )

        result = []
        staff_department_id = _current_staff_department_id()
        if not staff_department_id:
            return jsonify([]), 200

        for referral in referrals:

            patient = Patient.query.get(
                referral.patient_id
            )

            if not patient:
                continue

            # Clinical selections are department-scoped. A theatre referral
            # is visible only to staff in the patient's assigned visit department.
            patient_department_id = _patient_department_id(patient.id)
            if patient_department_id is None or patient_department_id != staff_department_id:
                continue

            result.append({

                # ====================================================
                # REFERRAL DATABASE ID
                # This is the ID that should be sent back when saving
                # the surgical record.
                # ====================================================

                "id":
                    referral.id,

                # ====================================================
                # HUMAN / REFERENCE REFERRAL ID
                # ====================================================

                "referral_id":
                    referral.referral_id,

                # ====================================================
                # ACTUAL patients.id
                # ====================================================

                "patient_id":
                    patient.id,

                # ====================================================
                # HMS PATIENT CODE
                # Example: P-0001
                # ====================================================

                "patient_code":
                    patient.patient_id,

                # ====================================================
                # PATIENT NAME
                # ====================================================

                "patient_name":
                    patient.full_name,

                # ====================================================
                # DESTINATION
                # ====================================================

                "destination":
                    referral.destination,

                # ====================================================
                # REFERRAL NOTES
                # ====================================================

                "notes":
                    referral.notes,

                # ====================================================
                # REFERRAL STATUS
                # ====================================================

                "status":
                    referral.status,

                # ====================================================
                # CREATED TIME
                # ====================================================

                "created_at":
                    (
                        referral.created_at.isoformat()
                        if referral.created_at
                        else None
                    )
            })

        return jsonify(result), 200

    except Exception as error:

        db.session.rollback()

        print(
            "GET THEATRE REFERRALS ERROR:",
            error
        )

        return jsonify({

            "success": False,

            "error":
                "Failed to load theatre referrals.",

            "details":
                str(error)

        }), 500

# ============================================================
# GET ALL SURGICAL RECORDS
# ============================================================

@surgery_bp.route("/", methods=["GET"])
def get_surgeries():

    try:

        surgeries = (
            SurgicalRecord.query
            .order_by(
                SurgicalRecord.created_at.desc()
            )
            .all()
        )

        result = []

        for surgery in surgeries:

            result.append({

                "id":
                    surgery.id,

                "patient_id":
                    surgery.patient_id,

                "surgeon_id":
                    surgery.surgeon_id,

                "procedure":
                    surgery.procedure,

                "consent":
                    surgery.consent,

                "anaesthetist":
                    surgery.anaesthetist,

                "anaesthesia_type":
                    surgery.anaesthesia_type,

                "operation_notes":
                    surgery.operation_notes,

                "status":
                    surgery.status,

                "scheduled_at":
                    (
                        surgery.scheduled_at.isoformat()
                        if surgery.scheduled_at
                        else None
                    ),

                "created_at":
                    (
                        surgery.created_at.isoformat()
                        if surgery.created_at
                        else None
                    )
            })

        return jsonify({

            "success":
                True,

            "surgeries":
                result

        }), 200

    except Exception as error:

        db.session.rollback()

        print(
            "GET SURGICAL RECORDS ERROR:",
            error
        )

        return jsonify({

            "success": False,

            "error":
                "Failed to load surgical records.",

            "details":
                str(error)

        }), 500

# ============================================================
# CREATE SURGICAL RECORD
# ============================================================

@surgery_bp.route("/", methods=["POST"])
def create_surgery():

    data = request.get_json(silent=True) or {}

    try:

        # ====================================================
        # REFERRAL
        #
        # The theatre patient selector represents a REFERRAL,
        # not merely a patient.
        #
        # Therefore the frontend should send:
        #
        # referral_id = selected theatre referral database ID
        #
        # This allows us to complete the exact referral that
        # was selected.
        # ====================================================

        referral_id = data.get(
            "referral_id"
        )

        if referral_id in (
            "",
            None,
            "null",
            "undefined"
        ):

            referral_id = None

        else:

            try:

                referral_id = int(
                    referral_id
                )

            except (TypeError, ValueError):

                return jsonify({

                    "success": False,

                    "error":
                        "Invalid theatre referral ID."

                }), 400

        # ====================================================
        # PATIENT
        # ====================================================

        patient_id = data.get(
            "patient_id"
        )

        if not patient_id:

            return jsonify({

                "success": False,

                "error":
                    "Patient is required."

            }), 400

        try:

            patient_id = int(
                patient_id
            )

        except (TypeError, ValueError):

            return jsonify({

                "success": False,

                "error":
                    "Invalid patient ID."

            }), 400

        patient = Patient.query.get(
            patient_id
        )

        if not patient:

            return jsonify({

                "success": False,

                "error":
                    "Selected patient does not exist."

            }), 404

        # ====================================================
        # VALIDATE THE EXACT THEATRE REFERRAL
        #
        # If referral_id was supplied, it MUST:
        #
        # 1. Exist
        # 2. Belong to this patient
        # 3. Have destination = theatre
        # 4. Still be PENDING
        #
        # Nothing is deleted.
        # ====================================================

        theatre_referral = None

        if referral_id is not None:

            theatre_referral = (
                Referral.query
                .filter(
                    Referral.id == referral_id,
                    Referral.patient_id == patient_id,
                    Referral.destination == "theatre"
                )
                .first()
            )

            if not theatre_referral:

                return jsonify({

                    "success": False,

                    "error":
                        "The selected theatre referral does not exist or does not belong to this patient."

                }), 404

            if str(
                theatre_referral.status or ""
            ).upper() != "PENDING":

                return jsonify({

                    "success": False,

                    "error":
                        "The selected theatre referral has already been processed."

                }), 409

        # ====================================================
        # BACKWARD COMPATIBILITY
        #
        # If an older frontend does not yet send referral_id,
        # locate a pending theatre referral for this patient.
        #
        # This does NOT delete anything.
        #
        # Once the current frontend sends referral_id, the exact
        # referral above will always be used.
        # ====================================================

        else:

            theatre_referral = (
                Referral.query
                .filter(
                    Referral.patient_id == patient_id,
                    Referral.destination == "theatre",
                    Referral.status == "PENDING"
                )
                .order_by(
                    Referral.created_at.asc()
                )
                .first()
            )

        # ====================================================
        # PROCEDURE
        # ====================================================

        procedure = (
            data.get("procedure") or ""
        ).strip()

        if not procedure:

            return jsonify({

                "success": False,

                "error":
                    "Procedure is required."

            }), 400

        # ====================================================
        # SURGEON
        # ====================================================

        surgeon_id = data.get(
            "surgeon_id"
        )

        if surgeon_id in (
            "",
            None,
            "null",
            "undefined"
        ):

            surgeon_id = None

        else:

            try:

                surgeon_id = int(
                    surgeon_id
                )

            except (TypeError, ValueError):

                return jsonify({

                    "success": False,

                    "error":
                        "Invalid surgeon ID."

                }), 400

            surgeon = Staff.query.get(
                surgeon_id
            )

            if not surgeon:

                return jsonify({

                    "success": False,

                    "error":
                        "Selected surgeon does not exist."

                }), 404

        # ====================================================
        # CONSENT
        # ====================================================

        consent = data.get(
            "consent"
        )

        if consent is not None:

            consent = str(
                consent
            ).strip()

        # ====================================================
        # ANAESTHETIST
        # ====================================================

        anaesthetist = data.get(
            "anaesthetist"
        )

        if anaesthetist is not None:

            anaesthetist = str(
                anaesthetist
            ).strip()

        # ====================================================
        # ANAESTHESIA TYPE
        # ====================================================

        anaesthesia_type = data.get(
            "anaesthesia_type"
        )

        if anaesthesia_type is not None:

            anaesthesia_type = str(
                anaesthesia_type
            ).strip()

        # ====================================================
        # OPERATION / RECOVERY NOTES
        # ====================================================

        operation_notes = data.get(
            "operation_notes"
        )

        if operation_notes is not None:

            operation_notes = str(
                operation_notes
            ).strip()

        # ====================================================
        # STATUS
        #
        # Theatre HTML currently has no status field.
        # Therefore default to SCHEDULED.
        # ====================================================

        status = data.get(
            "status"
        )

        if not status:

            status = "SCHEDULED"

        status = str(
            status
        ).strip().upper()

        # ====================================================
        # SCHEDULED AT
        #
        # Theatre HTML currently has no date/time field.
        #
        # If JavaScript sends scheduled_at, use it.
        # Otherwise use current server time.
        # ====================================================

        scheduled_at_value = data.get(
            "scheduled_at"
        )

        if scheduled_at_value:

            if isinstance(
                scheduled_at_value,
                str
            ):

                try:

                    scheduled_at = (
                        datetime.fromisoformat(
                            scheduled_at_value.replace(
                                "Z",
                                "+00:00"
                            )
                        )
                    )

                except ValueError:

                    return jsonify({

                        "success": False,

                        "error":
                            "Invalid scheduled_at format."

                    }), 400

            else:

                return jsonify({

                    "success": False,

                    "error":
                        "Invalid scheduled_at value."

                }), 400

        else:

            scheduled_at = datetime.utcnow()

        # ====================================================
        # CREATE SURGICAL RECORD
        # ====================================================

        surgery = SurgicalRecord(

            patient_id=
                patient_id,

            surgeon_id=
                surgeon_id,

            procedure=
                procedure,

            consent=
                consent,

            anaesthetist=
                anaesthetist,

            anaesthesia_type=
                anaesthesia_type,

            operation_notes=
                operation_notes,

            status=
                status,

            scheduled_at=
                scheduled_at
        )

        db.session.add(
            surgery
        )
        db.session.flush()
        record_tariff_charge(
            patient.id,
            "surgery",
            f"surgery:{surgery.id}",
            detail=procedure,
        )

        # ====================================================
        # COMPLETE THE THEATRE REFERRAL
        #
        # IMPORTANT:
        #
        # We DO NOT delete:
        #
        # - Patient
        # - Patient history
        # - Referral
        # - Surgical record
        #
        # We only change:
        #
        # PENDING → COMPLETED
        #
        # Therefore the referral remains in the database for
        # history/audit purposes but disappears from the active
        # theatre queue.
        # ====================================================

        if theatre_referral:
            theatre_referral.status = "COMPLETED"

        post_op_destination = str(data.get("post_op_destination") or "").strip().lower()
        if post_op_destination == "nurse":
            # Theatre-to-nursing is a real referral, retained for audit history.
            nursing_referral = Referral(
                referral_id=f"REF-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}",
                patient_id=patient.id,
                doctor_id=(
                    theatre_referral.doctor_id if theatre_referral
                    else (patient.assigned_doctor_id or surgeon_id)
                ),
                destination="nurse",
                notes=(f"Post-operative nursing referral. {operation_notes or ''}").strip(),
                status="PENDING"
            )
            db.session.add(nursing_referral)
            patient.current_phase = "Nurse Referral Queue"

        # ====================================================
        # SAVE EVERYTHING IN ONE TRANSACTION
        #
        # SurgicalRecord and Referral status are committed
        # together.
        #
        # If something fails, BOTH changes are rolled back.
        # ====================================================

        db.session.commit()

        # ====================================================
        # RETURN COMPLETE SAVED RECORD
        # ====================================================

        return jsonify({

            "success":
                True,

            "message":
                "Surgical record saved successfully.",

            "surgery": {

                "id":
                    surgery.id,

                "patient_id":
                    surgery.patient_id,

                "surgeon_id":
                    surgery.surgeon_id,

                "procedure":
                    surgery.procedure,

                "consent":
                    surgery.consent,

                "anaesthetist":
                    surgery.anaesthetist,

                "anaesthesia_type":
                    surgery.anaesthesia_type,

                "operation_notes":
                    surgery.operation_notes,

                "status":
                    surgery.status,

                "scheduled_at":
                    (
                        surgery.scheduled_at.isoformat()
                        if surgery.scheduled_at
                        else None
                    ),

                "created_at":
                    (
                        surgery.created_at.isoformat()
                        if surgery.created_at
                        else None
                    )
            },

            # =================================================
            # REFERRAL INFORMATION
            # Useful for the frontend and debugging.
            # =================================================

            "referral": (

                {

                    "id":
                        theatre_referral.id,

                    "referral_id":
                        theatre_referral.referral_id,

                    "patient_id":
                        theatre_referral.patient_id,

                    "destination":
                        theatre_referral.destination,

                    "status":
                        theatre_referral.status

                }

                if theatre_referral

                else None
            )

        }), 201

    # ========================================================
    # DATABASE / SERVER ERROR
    # ========================================================

    except Exception as error:

        db.session.rollback()

        print(
            "CREATE SURGERY ERROR:",
            error
        )

        return jsonify({

            "success": False,

            "error":
                "Failed to save surgical record.",

            "details":
                str(error)

        }), 500
