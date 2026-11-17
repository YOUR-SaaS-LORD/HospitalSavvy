from flask import Blueprint, request, jsonify
from extensions import db
from models.hospital import Ward, Bed

ward_bp = Blueprint(
    "ward",
    __name__,
    url_prefix="/api/wards"
)

# ============================================================
# GET ALL WARDS
# ============================================================

@ward_bp.get("/")
def get_wards():

    try:

        wards = Ward.query.order_by(
            Ward.name
        ).all()

        return jsonify({
            "success": True,
            "wards": [
                {
                    "id": ward.id,
                    "name": ward.name,
                    "capacity": ward.capacity
                }
                for ward in wards
            ]
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "message": "Unable to load wards",
            "error": str(e)
        }), 500

# ============================================================
# CREATE WARD
# ============================================================

@ward_bp.post("/")
def create_ward():

    data = request.get_json(silent=True) or {}

    name = (data.get("name") or "").strip()
    capacity = data.get("capacity")

    if not name:

        return jsonify({
            "success": False,
            "message": "Ward name is required"
        }), 400

    # --------------------------------------------------------
    # DUPLICATE NAME CHECK
    # --------------------------------------------------------

    existing = Ward.query.filter(
        db.func.lower(Ward.name) == name.lower()
    ).first()

    if existing:

        return jsonify({
            "success": False,
            "message":
                f"Ward '{existing.name}' already exists."
        }), 409

    # --------------------------------------------------------
    # VALIDATE CAPACITY
    # --------------------------------------------------------

    try:

        capacity = int(capacity)

    except (TypeError, ValueError):

        return jsonify({
            "success": False,
            "message":
                "Valid bed capacity is required"
        }), 400

    if capacity < 1:

        return jsonify({
            "success": False,
            "message":
                "Bed capacity must be at least 1"
        }), 400

    # --------------------------------------------------------
    # CREATE WARD + BEDS
    # --------------------------------------------------------

    try:

        ward = Ward(
            name=name,
            capacity=capacity
        )

        db.session.add(ward)

        # Flush first so the new ward gets its database ID.
        db.session.flush()

        # Create the actual database beds.
        for bed_number in range(1, capacity + 1):

            bed = Bed(
                bed_number=(
                    f"{name} - Bed "
                    f"{str(bed_number).zfill(2)}"
                ),
                ward_id=ward.id,
                status="AVAILABLE",
                patient_id=None
            )

            db.session.add(bed)

        db.session.commit()

        return jsonify({
            "success": True,
            "message":
                "Ward and beds created successfully",
            "ward": {
                "id": ward.id,
                "name": ward.name,
                "capacity": ward.capacity
            }
        }), 201

    except Exception as e:

        db.session.rollback()

        return jsonify({
            "success": False,
            "message":
                "Unable to create ward and beds",
            "error": str(e)
        }), 500

        
# ============================================================
# DELETE WARD
# ============================================================

@ward_bp.delete("/<int:ward_id>")
def delete_ward(ward_id):

    try:

        ward = Ward.query.get(ward_id)

        if not ward:

            return jsonify({
                "success": False,
                "message": "Ward not found"
            }), 404

        db.session.delete(ward)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Ward deleted successfully"
        })

    except Exception as e:

        db.session.rollback()

        error_text = str(e)

        # Ward has beds attached to it
        if "beds" in error_text.lower() or "foreignkey" in error_text.lower():

            return jsonify({
                "success": False,
                "message": (
                    f"Cannot delete '{ward.name}' because "
                    "it is being used by existing beds."
                )
            }), 409

        return jsonify({
            "success": False,
            "message": "Unable to delete ward",
            "error": error_text
        }), 500