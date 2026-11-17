from flask import Blueprint, request, jsonify, session
from werkzeug.security import (
    generate_password_hash,
    check_password_hash
)

from extensions import db
from models.staff import Staff
from models.user import User
from models.hospital import Department

staff_bp = Blueprint(
    "staff_bp",
    __name__,
    url_prefix="/api/staff"
)

# =========================================================
# ADMIN AUTHORIZATION
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
        return None, (
            jsonify({
                "success": False,
                "error": "Invalid session."
            }),
            401
        )

    role = " ".join(str(user.role or "").strip().lower().replace("_", " ").replace("-", " ").split())
    if role in {"admin", "administrator", "admin user"}:
        role = "system admin"

    if role not in ("system admin", "system administrator"):
        return None, (
            jsonify({
                "success": False,
                "error": "Administrator privileges are required."
            }),
            403
        )

    return user, None

# =========================================================
# STAFF NUMBER
# =========================================================

def next_staff_number():

    last = Staff.query.order_by(
        Staff.id.desc()
    ).first()

    next_number = (
        last.id + 1
        if last
        else 1
    )

    return f"ST-{next_number:04d}"

# =========================================================
# NORMALIZE USER ROLE
# =========================================================

def normalized_user_role(role):

    value = str(
        role or ""
    ).strip().lower()

    if "physician" in value or "doctor" in value:
        return "doctor"

    if "radiologist" in value:
        return "radiologist"

    if "pharmac" in value:
        return "pharmacist"

    if "nurse" in value:
        return "nurse"

    if "surgeon" in value:
        return "surgeon"

    if "lab" in value:
        return "labtech"

    if value.strip() in ("opd", "opd officer"):
        return "opd"

    if "reception" in value:
        return "receptionist"

    if "account" in value:
        return "accountant"

    if value in ("admin", "administrator", "system admin", "system administrator", "system_admin"):
        return "system_admin"

    if value in ("hospital admin", "hospital administrator", "hospital_manager"):
        return "hospital_manager"

    return value

# =========================================================
# LIST STAFF
# =========================================================

@staff_bp.get("/")
def list_staff():

    admin, error = require_admin()

    if error:
        return error

    staff = Staff.query.order_by(
        Staff.created_at.desc()
    ).all()

    return jsonify({
        "success": True,
        "staff": [
            item.to_dict()
            for item in staff
        ]
    })

# =========================================================
# CREATE STAFF
#
# IMPORTANT:
# Existing User accounts are synchronized with Staff.
#
# If username exists:
#     - do NOT create another User
#     - verify password
#     - verify role
#     - link existing User to Staff
#
# If username does not exist:
#     - create User
#     - create Staff
#     - link them
# =========================================================

@staff_bp.post("/")
def create_staff():

    admin, error = require_admin()

    if error:
        return error

    data = request.get_json(
        silent=True
    ) or {}

    name = (
        data.get("name")
        or data.get("full_name")
        or ""
    ).strip()

    role = (
        data.get("role")
        or ""
    ).strip()

    username = (
        data.get("username")
        or ""
    ).strip()

    password = data.get(
        "password"
    ) or ""

    phone = (
        data.get("phone")
        or ""
    ).strip()

    email = (
        data.get("email")
        or ""
    ).strip()

    # -----------------------------------------------------
    # REQUIRED FIELDS
    # -----------------------------------------------------

    if not name or not role:
        return jsonify({
            "success": False,
            "error": "Name and role are required."
        }), 400

    if not username or not password:
        return jsonify({
            "success": False,
            "error": "Username and password are required."
        }), 400

    if len(password) < 6:
        return jsonify({
            "success": False,
            "error": "Password must contain at least 6 characters."
        }), 400

    # -----------------------------------------------------
    # NORMALIZED ROLE
    # -----------------------------------------------------

    staff_role = str(
        role
    ).strip()

    user_role = normalized_user_role(
        staff_role
    )

    # -----------------------------------------------------
    # FIND EXISTING USER
    # -----------------------------------------------------

    existing_user = User.query.filter(
        db.func.lower(
            User.username
        ) == username.lower()
    ).first()

    # =====================================================
    # EXISTING USER
    # =====================================================

    if existing_user:

        # -------------------------------------------------
        # USER ALREADY LINKED TO STAFF
        # -------------------------------------------------

        existing_staff = Staff.query.filter_by(
            user_id=existing_user.id
        ).first()

        if existing_staff:

            return jsonify({
                "success": False,
                "error": (
                    "This username is already linked "
                    "to Staff "
                    f"{existing_staff.staff_number}."
                )
            }), 409

        # -------------------------------------------------
        # VERIFY PASSWORD
        # -------------------------------------------------

        if not existing_user.password_hash:

            return jsonify({
                "success": False,
                "error": (
                    "The existing user account has no "
                    "valid password."
                )
            }), 400

        if not check_password_hash(
            existing_user.password_hash,
            password
        ):

            return jsonify({
                "success": False,
                "error": (
                    "The username already exists, "
                    "but the supplied password does "
                    "not match that user account."
                )
            }), 409

        # -------------------------------------------------
        # VERIFY ROLE
        # -------------------------------------------------

        existing_role = normalized_user_role(
            existing_user.role
        )

        if existing_role != user_role:

            return jsonify({
                "success": False,
                "error": (
                    "The existing user account has role "
                    f"'{existing_user.role}', but this "
                    f"Staff record requires role '{role}'."
                )
            }), 409

        # -------------------------------------------------
        # CREATE STAFF USING EXISTING USER
        # -------------------------------------------------

        staff = Staff(
            staff_number=next_staff_number(),
            full_name=name,
            department_id=None,
            role=staff_role,
            status="OFF DUTY",
            phone=phone,
            email=email,
            user_id=existing_user.id
        )

        try:

            db.session.add(
                staff
            )

            db.session.commit()

        except Exception as exc:

            db.session.rollback()

            return jsonify({
                "success": False,
                "error": str(exc)
            }), 500

        return jsonify({
            "success": True,
            "message": (
                "Staff registered and linked "
                "to the existing user account."
            ),
            "staff": staff.to_dict()
        }), 201

    # =====================================================
    # NEW USER
    # =====================================================

    user = User(
        username=username,
        password_hash=generate_password_hash(
            password
        ),
        role=user_role,
        is_active=True
    )

    staff = Staff(
        staff_number=next_staff_number(),
        full_name=name,
        department_id=None,
        role=staff_role,
        status="OFF DUTY",
        phone=phone,
        email=email
    )

    # -----------------------------------------------------
    # LINK NEW USER TO NEW STAFF
    # -----------------------------------------------------

    staff.user = user

    try:

        db.session.add(user)
        db.session.add(staff)

        db.session.commit()

    except Exception as exc:

        db.session.rollback()

        return jsonify({
            "success": False,
            "error": str(exc)
        }), 500

    return jsonify({
        "success": True,
        "message": (
            "Staff and user account created successfully."
        ),
        "staff": staff.to_dict()
    }), 201

# =========================================================
# GET ONE STAFF MEMBER
# =========================================================

@staff_bp.get("/<int:staff_id>")
def get_staff(staff_id):

    admin, error = require_admin()

    if error:
        return error

    staff = Staff.query.get(
        staff_id
    )

    if not staff:
        return jsonify({
            "success": False,
            "error": "Staff member not found."
        }), 404

    return jsonify({
        "success": True,
        "staff": staff.to_dict()
    })

# =========================================================
# TOGGLE STAFF STATUS
# =========================================================

@staff_bp.patch(
    "/<int:staff_id>/toggle-status"
)
def toggle_staff_status(staff_id):

    admin, error = require_admin()

    if error:
        return error

    staff = Staff.query.get(
        staff_id
    )

    if not staff:
        return jsonify({
            "success": False,
            "error": "Staff member not found."
        }), 404

    current = str(
        staff.status or ""
    ).strip().upper()

    if current != "ON DUTY":
        return jsonify({
            "success": False,
            "error": "Staff become on duty by signing in and choosing a department."
        }), 409

    staff.status = "OFF DUTY"
    staff.department_id = None

    try:

        db.session.commit()

    except Exception as exc:

        db.session.rollback()

        return jsonify({
            "success": False,
            "error": str(exc)
        }), 500

    return jsonify({
        "success": True,
        "staff": staff.to_dict()
    })

# =========================================================
# UPDATE STAFF
# =========================================================

@staff_bp.put("/<int:staff_id>")
def update_staff(staff_id):

    admin, error = require_admin()

    if error:
        return error

    staff = Staff.query.get(
        staff_id
    )

    if not staff:
        return jsonify({
            "success": False,
            "error": "Staff member not found."
        }), 404

    data = request.get_json(
        silent=True
    ) or {}

    name = data.get("name")
    role = data.get("role")
    phone = data.get("phone")
    email = data.get("email")
    username = data.get("username")
    password = data.get("password")

    # -----------------------------------------------------
    # NAME
    # -----------------------------------------------------

    if name is not None:

        staff.full_name = str(
            name
        ).strip()

    # -----------------------------------------------------
    # ROLE
    # -----------------------------------------------------

    if role is not None:

        staff.role = str(
            role
        ).strip()

        if staff.user:

            staff.user.role = normalized_user_role(
                staff.role
            )

    # -----------------------------------------------------
    # PHONE
    # -----------------------------------------------------

    if phone is not None:

        staff.phone = str(
            phone
        ).strip()

    # -----------------------------------------------------
    # EMAIL
    # -----------------------------------------------------

    if email is not None:

        staff.email = str(
            email
        ).strip()

    # -----------------------------------------------------
    # USERNAME
    # -----------------------------------------------------

    if username is not None:

        username = str(
            username
        ).strip()

        if not staff.user:

            return jsonify({
                "success": False,
                "error": (
                    "Staff has no linked user account."
                )
            }), 400

        duplicate = User.query.filter(
            db.func.lower(
                User.username
            ) == username.lower(),
            User.id != staff.user.id
        ).first()

        if duplicate:

            return jsonify({
                "success": False,
                "error": (
                    "Username is already registered."
                )
            }), 409

        staff.user.username = username

    # -----------------------------------------------------
    # PASSWORD
    # -----------------------------------------------------

    if password:

        if not staff.user:

            return jsonify({
                "success": False,
                "error": (
                    "Staff has no linked user account."
                )
            }), 400

        if len(password) < 6:

            return jsonify({
                "success": False,
                "error": (
                    "Password must contain at least "
                    "6 characters."
                )
            }), 400

        staff.user.password_hash = (
            generate_password_hash(
                password
            )
        )

    # -----------------------------------------------------
    # SAVE
    # -----------------------------------------------------

    try:

        db.session.commit()

    except Exception as exc:

        db.session.rollback()

        return jsonify({
            "success": False,
            "error": str(exc)
        }), 500

    return jsonify({
        "success": True,
        "staff": staff.to_dict()
    })

# =========================================================
# DELETE STAFF
# =========================================================

@staff_bp.delete("/<int:staff_id>")
def delete_staff(staff_id):

    admin, error = require_admin()

    if error:
        return error

    staff = Staff.query.get(
        staff_id
    )

    if not staff:
        return jsonify({
            "success": False,
            "error": "Staff member not found."
        }), 404

    user = staff.user

    try:

        db.session.delete(
            staff
        )

        if user:
            db.session.delete(
                user
            )

        db.session.commit()

    except Exception as exc:

        db.session.rollback()

        return jsonify({
            "success": False,
            "error": str(exc)
        }), 500

    return jsonify({
        "success": True
    })
