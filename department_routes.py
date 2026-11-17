from flask import Blueprint, request, jsonify
from extensions import db
from models.hospital import Department

department_bp = Blueprint(
    "department",
    __name__,
    url_prefix="/api/departments"
)

# ============================================================
# NORMALIZE DEPARTMENT NAME
# ============================================================

def normalize_department_name(name):
    """
    Normalize department names so that:

    Emergency
    emergency
    EMERGENCY
    Emergency
    Emergency

    are treated as the same name.
    """

    if not isinstance(name, str):
        return ""

    # Remove leading/trailing whitespace
    # and collapse multiple spaces into one.
    return " ".join(name.strip().split()).casefold()

# ============================================================
# GET ALL DEPARTMENTS
# ============================================================

@department_bp.get("/")
def get_departments():

    try:

        departments = Department.query.order_by(
            Department.name
        ).all()

        return jsonify({
            "success": True,
            "departments": [
                department.to_dict()
                for department in departments
            ]
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "message": "Unable to load departments",
            "error": str(e)
        }), 500

# ============================================================
# GET ONE DEPARTMENT
# ============================================================

@department_bp.get("/<int:department_id>")
def get_department(department_id):

    try:

        department = Department.query.get(
            department_id
        )

        if not department:

            return jsonify({
                "success": False,
                "message": "Department not found"
            }), 404

        return jsonify({
            "success": True,
            "department": department.to_dict()
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "message": "Unable to load department",
            "error": str(e)
        }), 500

# ============================================================
# CREATE DEPARTMENT
# ============================================================

@department_bp.post("/")
def create_department():

    data = request.get_json(silent=True) or {}

    raw_name = data.get("name")

    name = normalize_department_name(
        raw_name
    )

    if not name:

        return jsonify({
            "success": False,
            "message": "Department name is required"
        }), 400

    # --------------------------------------------------------
    # CASE-INSENSITIVE DUPLICATE CHECK
    # --------------------------------------------------------

    departments = Department.query.all()

    for department in departments:

        existing_name = normalize_department_name(
            department.name
        )

        if existing_name == name:

            return jsonify({
                "success": False,
                "message": (
                    f"Department '{department.name}' "
                    "already exists."
                )
            }), 409

    try:

        department = Department(
            name=name
        )

        db.session.add(department)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Department created successfully",
            "department": department.to_dict()
        }), 201

    except Exception as e:

        db.session.rollback()

        return jsonify({
            "success": False,
            "message": "Unable to create department",
            "error": str(e)
        }), 500

# ============================================================
# UPDATE DEPARTMENT
# ============================================================

@department_bp.put("/<int:department_id>")
def update_department(department_id):

    try:

        department = Department.query.get(
            department_id
        )

        if not department:

            return jsonify({
                "success": False,
                "message": "Department not found"
            }), 404

        data = request.get_json(silent=True) or {}

        if "name" in data:

            name = normalize_department_name(
                data.get("name")
            )

            if not name:

                return jsonify({
                    "success": False,
                    "message": (
                        "Department name "
                        "cannot be empty"
                    )
                }), 400

            # ------------------------------------------------
            # DUPLICATE CHECK
            # Exclude the current department.
            # ------------------------------------------------

            departments = Department.query.filter(
                Department.id != department.id
            ).all()

            for existing_department in departments:

                existing_name = (
                    normalize_department_name(
                        existing_department.name
                    )
                )

                if existing_name == name:

                    return jsonify({
                        "success": False,
                        "message": (
                            f"Department "
                            f"'{existing_department.name}' "
                            "already exists."
                        )
                    }), 409

            department.name = name

        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Department updated successfully",
            "department": department.to_dict()
        })

    except Exception as e:

        db.session.rollback()

        return jsonify({
            "success": False,
            "message": "Unable to update department",
            "error": str(e)
        }), 500

# ============================================================
# DELETE DEPARTMENT
# ============================================================

@department_bp.delete("/<int:department_id>")
def delete_department(department_id):

    try:

        department = Department.query.get(
            department_id
        )

        if not department:

            return jsonify({
                "success": False,
                "message": "Department not found"
            }), 404

        department_name = department.name

        db.session.delete(department)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": (
                f"Department '{department_name}' "
                "deleted successfully"
            )
        })

    except Exception as e:

        db.session.rollback()

        error_text = str(e)

        if "staff_department_id_fkey" in error_text:

            return jsonify({
                "success": False,
                "message": (
                    f"Cannot delete '{department_name}' "
                    "because it is currently "
                    "assigned to staff."
                )
            }), 409

        return jsonify({
            "success": False,
            "message": "Unable to delete department",
            "error": error_text
        }), 500