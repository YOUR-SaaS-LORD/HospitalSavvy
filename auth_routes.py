from flask import Blueprint, request, jsonify, session
from werkzeug.security import check_password_hash

from extensions import db
from models.user import User
from models.staff import Staff
from models.hospital import Department

auth_bp = Blueprint("auth_bp", __name__)


# ============================================================
# ROLE NORMALIZATION
# ============================================================
# Keep System Admin and Hospital Manager distinct from the legacy
# generic "admin" role. The frontend uses these canonical names.
# ============================================================
ROLE_ALIASES = {
    # Legacy administrator labels resolve to the single System Admin role.
    "admin": "system_admin",
    "administrator": "system_admin",
    "admin user": "system_admin",

    # System Admin
    "system admin": "system_admin",
    "system administrator": "system_admin",
    "system administrator user": "system_admin",
    "system_admin": "system_admin",

    # Hospital Manager
    "hospital admin": "hospital_manager",
    "hospital administrator": "hospital_manager",
    "hospital admin user": "hospital_manager",
    "hospital manager": "hospital_manager",
    "hospital_manager": "hospital_manager",

    # Clinical and operational roles
    "doctor": "doctor",
    "physician": "doctor",
    "medical doctor": "doctor",
    "nurse": "nurse",
    "nursing": "nurse",
    "nursing officer": "nurse",
    "surgeon": "surgeon",
    "theatre": "surgeon",
    "surgery": "surgeon",
    "operating theatre": "surgeon",
    "receptionist": "receptionist",
    "reception": "receptionist",
    # OPD has its own role, login and page (separate from legacy receptionist).
    "opd": "opd",
    "opd officer": "opd",
    "opd user": "opd",
    "lab tech": "labtech",
    "lab technician": "labtech",
    "laboratory technician": "labtech",
    "laboratory tech": "labtech",
    "lab technologist": "labtech",
    "laboratory technologist": "labtech",
    "labtech": "labtech",
    "pharmacist": "pharmacist",
    "pharmacy": "pharmacist",
    "radiologist": "radiologist",
    "radiology": "radiologist",
    "accountant": "accountant",
    "finance": "accountant",
    "finance officer": "accountant",
    "finance manager": "accountant",
    "accounts": "accountant",
    "billing": "accountant",
    "accounts officer": "accountant",
    "secretary": "secretary",
    "secretariate": "secretary",
    "secretariat": "secretary",
    "procurement officer": "procurement_officer",
    "procurement": "procurement_officer",
    "purchasing officer": "procurement_officer",
    "purchasing": "procurement_officer",
    "guidance counselor": "guidance_counselor",
    "guidance counsellor": "guidance_counselor",
    "counselor": "guidance_counselor",
    "counsellor": "guidance_counselor",
}


def normalize_role(role):
    value = str(role or "").strip().lower()
    value = " ".join(value.replace("_", " ").replace("-", " ").split())
    return ROLE_ALIASES.get(value, value.replace(" ", "_") if value else "")


def get_staff_for_user(user_id):
    return Staff.query.filter_by(user_id=user_id).first()


# ============================================================
# FIRST-ADMIN SETUP STATUS
# ============================================================
@auth_bp.route("/api/auth/setup-status", methods=["GET"])
def setup_status():
    administrator_roles = [
        "admin",
        "administrator",
        "system admin",
        "system administrator",
        "system_admin",
        "system-administrator",
    ]

    existing_admin = User.query.filter(
        db.func.lower(db.func.trim(User.role)).in_(administrator_roles)
    ).first()

    return jsonify({
        "success": True,
        "setup_required": existing_admin is None,
    }), 200


# ============================================================
# LOGIN
# ============================================================
@auth_bp.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    password = str(data.get("password") or "")
    selected_department_id = data.get("department_id")
    selected_role = normalize_role(data.get("selected_role"))

    if not username or not password:
        return jsonify({
            "success": False,
            "error": "Username and password are required.",
        }), 400

    user = User.query.filter_by(username=username).first()
    if user is None:
        user = User.query.filter(
            db.func.lower(db.func.trim(User.username)) == username.lower()
        ).first()

    if user is None:
        return jsonify({
            "success": False,
            "error": "Invalid username or password.",
        }), 401

    if not user.is_active:
        return jsonify({
            "success": False,
            "error": "This user account has been disabled.",
        }), 403

    stored_password_hash = user.password_hash
    if not stored_password_hash:
        return jsonify({
            "success": False,
            "error": "This account has no configured password. Contact the system administrator.",
        }), 401

    try:
        password_is_valid = check_password_hash(stored_password_hash, password)
    except (ValueError, TypeError):
        password_is_valid = False

    if not password_is_valid:
        return jsonify({
            "success": False,
            "error": "Invalid username or password.",
        }), 401

    database_role = normalize_role(user.role)
    if selected_role and selected_role != database_role:
        return jsonify({
            "success": False,
            "error": "The chosen administrator type does not match this account's saved role.",
        }), 401
    else:
        authenticated_role = database_role

    staff = get_staff_for_user(user.id)
    department = None
    # These are hospital-wide workspaces. Their staff record can still belong
    # to a department, but login must not ask them to select one each session.
    department_optional_role = authenticated_role in {
        "system_admin", "hospital_manager", "opd", "procurement_officer", "accountant"
    }
    if staff and not department_optional_role:
        try:
            selected_department_id = int(selected_department_id)
        except (TypeError, ValueError):
            selected_department_id = None
        department = Department.query.get(selected_department_id) if selected_department_id else None
        if not selected_department_id:
            return jsonify({
                "success": True,
                "requires_department": True,
                "user": {
                    "username": user.username,
                    "role": authenticated_role,
                },
                "departments": [
                    {"id": item.id, "name": item.name}
                    for item in Department.query.order_by(Department.name).all()
                ],
            }), 200
        if not department:
            return jsonify({
                "success": False,
                "error": "Choose a valid department to continue.",
            }), 400

    session.clear()
    session["user_id"] = user.id
    session["role"] = authenticated_role
    session["username"] = user.username
    session["staff_id"] = staff.id if staff else None
    session["department_id"] = department.id if department else None
    session["department_name"] = department.name if department else None

    if staff:
        try:
            staff.status = "ON DUTY"
            if department is not None:
                staff.department_id = department.id
            elif department_optional_role:
                staff.department_id = None
            db.session.commit()
        except Exception:
            db.session.rollback()
            session.clear()
            return jsonify({
                "success": False,
                "error": "Unable to complete login because the staff status could not be updated.",
            }), 500

    return jsonify({
        "success": True,
        "message": "Login successful.",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": authenticated_role,
            "staff_id": staff.id if staff else None,
            "department_id": department.id if department else None,
            "department_name": department.name if department else None,
        },
    }), 200


# ============================================================
# CURRENT SESSION USER
# ============================================================
@auth_bp.route("/api/auth/me", methods=["GET"])
def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({
            "success": False,
            "authenticated": False,
        }), 401

    user = db.session.get(User, user_id)
    if not user or not user.is_active:
        session.clear()
        return jsonify({
            "success": False,
            "authenticated": False,
        }), 401

    database_role = normalize_role(user.role)
    session_role = normalize_role(session.get("role"))

    # The saved database role remains authoritative for every session.
    # Keep compatibility for any pre-existing restricted legacy admin session.
    role_is_valid = session_role == database_role

    if not role_is_valid:
        session.clear()
        return jsonify({
            "success": False,
            "authenticated": False,
        }), 401

    staff = get_staff_for_user(user.id)

    return jsonify({
        "success": True,
        "authenticated": True,
        "user": {
            "id": user.id,
            "username": user.username,
            "role": session_role,
            "staff_id": staff.id if staff else None,
            "department_id": session.get("department_id"),
            "department_name": session.get("department_name"),
        },
    }), 200


@auth_bp.route("/api/auth/department", methods=["GET", "POST"])
def active_department():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"success": False, "error": "Authentication required."}), 401

    staff = get_staff_for_user(user_id)
    if not staff:
        return jsonify({"success": False, "error": "A staff workspace is required."}), 403

    if request.method == "GET":
        return jsonify({
            "success": True,
            "department_id": session.get("department_id"),
            "departments": [
                {"id": item.id, "name": item.name}
                for item in Department.query.order_by(Department.name).all()
            ],
        }), 200

    data = request.get_json(silent=True) or {}
    try:
        department_id = int(data.get("department_id"))
    except (TypeError, ValueError):
        department_id = None
    department = Department.query.get(department_id) if department_id else None
    if not department:
        return jsonify({"success": False, "error": "Choose a valid department."}), 400

    try:
        staff.department_id = department.id
        staff.status = "ON DUTY"
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"success": False, "error": "Could not change the active department."}), 500

    session["department_id"] = department.id
    session["department_name"] = department.name
    return jsonify({
        "success": True,
        "department_id": department.id,
        "department_name": department.name,
    }), 200


# ============================================================
# LOGOUT
# ============================================================
@auth_bp.route("/api/auth/logout", methods=["POST"])
def logout():
    user_id = session.get("user_id")
    if user_id:
        staff = get_staff_for_user(user_id)
        if staff:
            try:
                staff.status = "OFF DUTY"
                staff.department_id = None
                db.session.commit()
            except Exception:
                db.session.rollback()

    session.clear()
    return jsonify({"success": True}), 200
