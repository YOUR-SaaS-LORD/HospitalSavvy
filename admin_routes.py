from flask import Blueprint, request, jsonify, session, current_app
from werkzeug.security import generate_password_hash

from extensions import db
from models.user import User
from models.patient import Patient, Visit

# =========================================================
# ADMIN BLUEPRINT
# =========================================================

admin_bp = Blueprint(
    "admin",
    __name__,
    url_prefix="/api/admin"
)

# =========================================================
# ADMIN AUTHENTICATION
# =========================================================

def require_admin():

    user_id = session.get("user_id")

    if not user_id:

        return None, (
            jsonify({
                "success": False,
                "error": "Authentication required."
            }),
            401
        )

    user = User.query.get(user_id)

    if not user:

        session.clear()

        return None, (
            jsonify({
                "success": False,
                "error": "User session is invalid."
            }),
            401
        )

    if not user.is_active:

        session.clear()

        return None, (
            jsonify({
                "success": False,
                "error": "Account is inactive."
            }),
            403
        )

    role = " ".join(str(user.role or "").strip().lower().replace("_", " ").replace("-", " ").split())
    if role in {"admin", "administrator", "admin user"}:
        role = "system admin"
    if role not in {"system admin", "system administrator"}:

        return None, (
            jsonify({
                "success": False,
                "error": "Administrator privileges are required."
            }),
            403
        )

    return user, None

# =========================================================
# ADMIN PATIENT MANAGEMENT
# =========================================================

# ---------------------------------------------------------
# GET ALL PATIENTS
# ---------------------------------------------------------

@admin_bp.get("/patients")
def admin_get_patients():

    print(
        "******** ADMIN GET PATIENTS ROUTE HIT ********"
    )

    admin, error = require_admin()

    if error:
        return error

    try:

        patients = (
            Patient.query
            .filter(db.func.upper(db.func.coalesce(Patient.status, "ACTIVE")) != "MERGED")
            .order_by(Patient.created_at.desc())
            .all()
        )

        return jsonify({
            "success": True,
            "patients": [
                patient.to_dict()
                for patient in patients
            ]
        })

    except Exception as e:

        db.session.rollback()

        print(
            "=================================================="
        )

        print(
            "ADMIN PATIENT LOAD ERROR:"
        )

        print(
            repr(e)
        )

        print(
            "=================================================="
        )

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

# ---------------------------------------------------------
# GET ONE PATIENT
# ---------------------------------------------------------

@admin_bp.get("/patients/<int:patient_id>")
def admin_get_patient(patient_id):

    admin, error = require_admin()

    if error:
        return error

    patient = Patient.query.get(patient_id)

    if not patient:

        return jsonify({
            "success": False,
            "error": "Patient not found."
        }), 404

    return jsonify({
        "success": True,
        "patient": patient.to_dict()
    })

# ---------------------------------------------------------
# UPDATE PATIENT
# ---------------------------------------------------------

@admin_bp.put("/patients/<int:patient_id>")
def admin_update_patient(patient_id):

    admin, error = require_admin()

    if error:
        return error

    patient = Patient.query.get(patient_id)

    if not patient:

        return jsonify({
            "success": False,
            "error": "Patient not found."
        }), 404

    data = request.get_json(
        silent=True
    )

    if not isinstance(data, dict):

        return jsonify({
            "success": False,
            "error": "Invalid request body."
        }), 400

    # -----------------------------------------------------
    # FULL NAME
    # -----------------------------------------------------

    if "full_name" in data:

        full_name = str(
            data.get("full_name") or ""
        ).strip()

        if not full_name:

            return jsonify({
                "success": False,
                "error": "Patient full name is required."
            }), 400

        if len(full_name) > 200:

            return jsonify({
                "success": False,
                "error": "Patient full name is too long."
            }), 400

        patient.full_name = full_name

    # -----------------------------------------------------
    # PHONE
    # -----------------------------------------------------

    if "phone" in data:

        phone = str(
            data.get("phone") or ""
        ).strip()

        if not phone:

            return jsonify({
                "success": False,
                "error": "Patient phone number is required."
            }), 400

        if len(phone) > 50:

            return jsonify({
                "success": False,
                "error": "Patient phone number is too long."
            }), 400

        patient.phone = phone

    # -----------------------------------------------------
    # SAVE
    # -----------------------------------------------------

    try:

        if "national_id" in data:
            national_id = str(data.get("national_id") or "").strip() or None
            if national_id and len(national_id) > 50:
                return jsonify({"success": False, "error": "National ID is too long."}), 400
            if national_id:
                existing = Patient.query.filter(
                    Patient.national_id == national_id,
                    Patient.id != patient.id
                ).first()
                if existing:
                    return jsonify({"success": False, "error": "This National ID is already assigned to another patient."}), 409
            patient.national_id = national_id

        db.session.commit()

    except Exception:

        db.session.rollback()

        return jsonify({
            "success": False,
            "error": "Patient update failed."
        }), 500

    return jsonify({
        "success": True,
        "message": "Patient details updated successfully.",
        "patient": patient.to_dict()
    })

# ---------------------------------------------------------
# MERGE PATIENT
# ---------------------------------------------------------

@admin_bp.post("/patients/<int:patient_id>/merge")
def admin_merge_patient(patient_id):

    admin, error = require_admin()

    if error:
        return error

    primary = Patient.query.get(
        patient_id
    )

    if not primary:

        return jsonify({
            "success": False,
            "error": "Primary patient not found."
        }), 404

    data = request.get_json(
        silent=True
    )

    if not isinstance(data, dict):

        return jsonify({
            "success": False,
            "error": "Invalid request body."
        }), 400

    duplicate_patient_code = str(
        data.get(
            "duplicate_patient_id"
        ) or ""
    ).strip()

    if not duplicate_patient_code:

        return jsonify({
            "success": False,
            "error": "Duplicate Patient ID is required."
        }), 400

    duplicate = Patient.query.filter_by(
        patient_id=duplicate_patient_code
    ).first()

    if not duplicate:

        return jsonify({
            "success": False,
            "error": "Duplicate patient was not found."
        }), 404

    if duplicate.id == primary.id:

        return jsonify({
            "success": False,
            "error": "A patient cannot be merged into itself."
        }), 400

    if str(
        duplicate.status or ""
    ).upper() == "MERGED":

        return jsonify({
            "success": False,
            "error": "The selected duplicate has already been merged."
        }), 409

    # -----------------------------------------------------
    # TRANSFER PATIENT-REFERENCING RECORDS TRANSACTIONALLY.
    # Prefer declared foreign keys, and also support legacy tables that
    # use integer patient_id columns or patient-code strings without FK
    # constraints. A uniqueness conflict aborts the whole transaction.
    # -----------------------------------------------------
    moved_records = {}
    try:
        from sqlalchemy import update
        from sqlalchemy.sql.sqltypes import Integer, String

        integer_patient_names = {"patient_id", "patient_db_id", "patient_record_id", "patient_fk"}
        code_patient_names = {"patient_id", "patient_code", "hospital_patient_id", "patient_number", "patient_identifier"}

        for table in db.metadata.sorted_tables:
            if table.name == Patient.__tablename__:
                continue

            for column in table.columns:
                if column.primary_key:
                    continue

                fk_targets = {fk.target_fullname for fk in column.foreign_keys}
                is_patient_fk = f"{Patient.__tablename__}.id" in fk_targets
                normalized_name = column.name.lower()

                # Declared FK to patients.id: always reassign the internal ID.
                # Legacy integer patient_id fields without FKs are also handled.
                is_legacy_integer_patient_id = (
                    not fk_targets
                    and normalized_name in integer_patient_names
                    and isinstance(column.type, Integer)
                )
                if is_patient_fk or is_legacy_integer_patient_id:
                    result = db.session.execute(
                        update(table)
                        .where(column == duplicate.id)
                        .values({column.name: primary.id})
                    )
                    if result.rowcount:
                        moved_records[table.name] = moved_records.get(table.name, 0) + result.rowcount
                    continue

                # Some legacy records store the public patient code instead of
                # the internal database ID. Move those references as well.
                is_legacy_patient_code = (
                    not fk_targets
                    and normalized_name in code_patient_names
                    and isinstance(column.type, String)
                )
                if is_legacy_patient_code:
                    result = db.session.execute(
                        update(table)
                        .where(column == duplicate.patient_id)
                        .values({column.name: primary.patient_id})
                    )
                    if result.rowcount:
                        moved_records[table.name] = moved_records.get(table.name, 0) + result.rowcount

        # Keep useful patient-level workflow data on the surviving record too.
        # These columns belong to the patient row itself, so they are not found
        # by the related-record scan above. Never replace a value already set
        # on the primary patient; append notes so neither record's history is
        # lost.
        for field in (
            "clinic",
            "registration_date",
            "current_phase",
            "current_priority",
            "assigned_doctor_id",
            "current_bed_id",
            "admission_date",
            "admitted_at",
            "discharge_date",
            "discharged_at",
        ):
            if getattr(primary, field) is None and getattr(duplicate, field) is not None:
                setattr(primary, field, getattr(duplicate, field))

        duplicate_notes = (duplicate.notes or "").strip()
        if duplicate_notes:
            primary.notes = "\n".join(
                part for part in ((primary.notes or "").strip(),
                                  f"Notes from merged patient {duplicate.patient_id}:\n{duplicate_notes}")
                if part
            )

        # Preserve the duplicate identity for audit traceability but exclude it
        # from active selectors only after every transfer succeeds.
        duplicate.status = "MERGED"
        duplicate.current_phase = "Merged Patient Record"
        merge_note = f"Merged into patient database ID {primary.id} ({primary.patient_id})"
        duplicate.notes = f"{(duplicate.notes or '').strip()}\n{merge_note}".strip()
        db.session.commit()

    except Exception:
        db.session.rollback()
        current_app.logger.exception("Patient merge failed; transaction rolled back")
        return jsonify({
            "success": False,
            "error": "Patient merge failed. No changes were committed. Check the server log for a conflicting unique value or an unsupported legacy relationship."
        }), 500

    return jsonify({
        "success": True,
        "message": "Patient records merged successfully.",
        "primary_patient": primary.to_dict(),
        "merged_patient": duplicate.to_dict(),
        "moved_records": moved_records
    })

# =========================================================
# ADMIN DASHBOARD
# =========================================================

@admin_bp.get("/")
def admin_home():

    return jsonify({
        "success": True,
        "message": "Admin API is running."
    })

@admin_bp.get("/dashboard")
def admin_dashboard():

    admin, error = require_admin()

    if error:
        return error

    return jsonify({
        "success": True,
        "message": "Admin dashboard."
    })

# =========================================================
# USER MANAGEMENT
# =========================================================

@admin_bp.get("/users")
def admin_get_users():

    admin, error = require_admin()

    if error:
        return error

    users = User.query.all()

    return jsonify({
        "success": True,
        "users": [
            {
                "id": user.id,
                "username": user.username,
                "role": user.role,
                "status": (
                    "Active"
                    if user.is_active
                    else "Inactive"
                )
            }
            for user in users
        ]
    })

# ---------------------------------------------------------
# CREATE USER
# ---------------------------------------------------------

@admin_bp.post("/users")
def admin_create_user():

    admin, error = require_admin()

    if error:
        return error

    data = request.get_json(
        silent=True
    ) or {}

    username = str(
        data.get("username") or ""
    ).strip()

    password = str(
        data.get("password") or ""
    )

    role = str(
        data.get("role") or ""
    ).strip()

    if not username:

        return jsonify({
            "success": False,
            "error": "Username is required."
        }), 400

    if not password:

        return jsonify({
            "success": False,
            "error": "Password is required."
        }), 400

    if not role:

        return jsonify({
            "success": False,
            "error": "Role is required."
        }), 400

    existing = User.query.filter_by(
        username=username
    ).first()

    if existing:

        return jsonify({
            "success": False,
            "error": "Username already exists."
        }), 409

    user = User(
        username=username,
        password_hash=generate_password_hash(
            password
        ),
        role=role
    )

    db.session.add(user)

    try:

        db.session.commit()

    except Exception:

        db.session.rollback()

        return jsonify({
            "success": False,
            "error": "User creation failed."
        }), 500

    return jsonify({
        "success": True,
        "message": "User created successfully.",
        "id": user.id
    }), 201

# ---------------------------------------------------------
# INITIAL ADMIN
# ---------------------------------------------------------

@admin_bp.post("/initial-admin")
def create_initial_admin():

    existing_admin = User.query.filter(
        db.func.lower(db.func.trim(User.role)).in_(
            ["admin", "administrator", "system admin", "system administrator", "system_admin", "system-administrator"]
        )
    ).first()

    if existing_admin:

        return jsonify({
            "success": False,
            "error": "The System Admin account already exists."
        }), 409

    data = request.get_json(
        silent=True
    ) or {}

    username = str(
        data.get("username") or ""
    ).strip()

    password = str(
        data.get("password") or ""
    )

    if not username or not password:

        return jsonify({
            "success": False,
            "error": "Username and password are required."
        }), 400

    user = User(
        username=username,
        password_hash=generate_password_hash(
            password
        ),
        role="System Admin",
        is_active=True
    )

    db.session.add(user)

    try:

        db.session.commit()

    except Exception:

        db.session.rollback()

        return jsonify({
            "success": False,
            "error": "System Admin creation failed."
        }), 500

    # The first credentials submitted during setup belong to the System Admin
    # and establish the first authenticated session immediately.
    session.clear()
    session["user_id"] = user.id
    session["role"] = "system_admin"
    session["username"] = user.username
    session["staff_id"] = None
    session["department_id"] = None
    session["department_name"] = None

    return jsonify({
        "success": True,
        "message": "System Admin created successfully.",
        "id": user.id,
        "user": {"id": user.id, "username": user.username, "role": "system_admin"}
    }), 201
