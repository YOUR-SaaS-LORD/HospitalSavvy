from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash

from extensions import db
from models.user import User

users_bp = Blueprint(
    "users_bp",
    __name__
)

@users_bp.route("/api/users", methods=["POST"])
def create_user():

    data = request.get_json(silent=True) or {}

    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    role = (data.get("role") or "").strip().lower()

    if not username or not password or not role:
        return jsonify({
            "success": False,
            "error": "Username, password and role are required."
        }), 400

    if len(password) < 6:
        return jsonify({
            "success": False,
            "error": "Password must contain at least 6 characters."
        }), 400

    existing_user = User.query.filter_by(
        username=username
    ).first()

    if existing_user:
        return jsonify({
            "success": False,
            "error": "A user with this username already exists."
        }), 409

    role_aliases = {
        "administrator": "system_admin",
        "system administrator": "system_admin",
        "admin": "system_admin",
        "system admin": "system_admin",
        "hospital manager": "hospital_manager",
        "hospital administrator": "hospital_manager",
        "hospital admin": "hospital_manager",

        "lab tech": "labtech",
        "lab technician": "labtech",
        "laboratory technician": "labtech",
        "labtech": "labtech",
        "secretariat": "secretary",
        "secretariate": "secretary",
        "procurement": "procurement_officer",
        "procurement officer": "procurement_officer",
        "guidance counselor": "guidance_counselor",
        "guidance counsellor": "guidance_counselor",
        "counselor": "guidance_counselor",
        "counsellor": "guidance_counselor",
        "opd officer": "opd",
        "opd": "opd"
    }

    role = role_aliases.get(role, role)

    user = User(
        username=username,
        password_hash=generate_password_hash(password),
        role=role,
        is_active=True
    )

    db.session.add(user)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "User account created successfully.",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role,
            "is_active": user.is_active
        }
    }), 201

@users_bp.route("/api/users", methods=["GET"])
def get_users():

    users = User.query.order_by(User.id.desc()).all()

    return jsonify({
        "success": True,
        "users": [
            {
                "id": user.id,
                "username": user.username,
                "role": user.role,
                "is_active": user.is_active,
                "created_at": (
                    user.created_at.isoformat()
                    if user.created_at else None
                )
            }
            for user in users
        ]
    })

# =========================================================
# ENABLE / DISABLE USER
# =========================================================

@users_bp.route(
    "/api/users/<int:user_id>/toggle-status",
    methods=["PATCH"]
)
def toggle_user_status(user_id):

    user = User.query.get(user_id)

    if not user:
        return jsonify({
            "success": False,
            "error": "User account not found."
        }), 404

    user.is_active = not user.is_active

    db.session.commit()

    return jsonify({
        "success": True,
        "message": (
            "User account enabled."
            if user.is_active
            else "User account disabled."
        ),
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role,
            "is_active": user.is_active
        }
    })

# =========================================================
# DELETE USER
# =========================================================

@users_bp.route(
    "/api/users/<int:user_id>",
    methods=["DELETE"]
)
def delete_user(user_id):

    user = User.query.get(user_id)

    if not user:
        return jsonify({
            "success": False,
            "error": "User account not found."
        }), 404

    db.session.delete(user)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "User account deleted successfully."
    })
