from flask import Blueprint, request, jsonify
from extensions import db
from models.hospital import Service

service_bp = Blueprint(
    "service",
    __name__,
    url_prefix="/api/services"
)

# ============================================================
# GET ALL SERVICES
# ============================================================

@service_bp.get("/")
def get_services():

    try:

        services = Service.query.order_by(
            Service.name
        ).all()

        return jsonify({
            "success": True,
            "services": [
                {
                    "id": service.id,
                    "name": service.name,
                    "fee": float(service.fee)
                }
                for service in services
            ]
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "message": "Unable to load services",
            "error": str(e)
        }), 500

# ============================================================
# CREATE SERVICE
# ============================================================

@service_bp.post("/")
def create_service():

    data = request.get_json(silent=True) or {}

    name = (data.get("name") or "").strip()
    fee = data.get("fee")

    if not name:

        return jsonify({
            "success": False,
            "message": "Service name is required"
        }), 400

    # --------------------------------------------------------
    # DUPLICATE NAME CHECK
    # Case-insensitive:
    # Malaria = malaria = MALARIA
    # --------------------------------------------------------

    existing = Service.query.filter(
        db.func.lower(Service.name) == name.lower()
    ).first()

    if existing:

        return jsonify({
            "success": False,
            "message": f"Service '{existing.name}' already exists."
        }), 409

    # --------------------------------------------------------
    # VALIDATE FEE
    # --------------------------------------------------------

    try:

        fee = float(fee)

    except (TypeError, ValueError):

        return jsonify({
            "success": False,
            "message": "Valid service fee is required"
        }), 400

    if fee < 0:

        return jsonify({
            "success": False,
            "message": "Service fee cannot be negative"
        }), 400

    # --------------------------------------------------------
    # CREATE
    # --------------------------------------------------------

    try:

        service = Service(
            name=name,
            fee=fee
        )

        db.session.add(service)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Service created successfully",
            "service": {
                "id": service.id,
                "name": service.name,
                "fee": float(service.fee)
            }
        }), 201

    except Exception as e:

        db.session.rollback()

        return jsonify({
            "success": False,
            "message": "Unable to create service",
            "error": str(e)
        }), 500

# ============================================================
# UPDATE SERVICE
# ============================================================

@service_bp.put("/<int:service_id>")
def update_service(service_id):

    try:

        service = Service.query.get(service_id)

        if not service:

            return jsonify({
                "success": False,
                "message": "Service not found"
            }), 404

        data = request.get_json(silent=True) or {}

        # ----------------------------------------------------
        # UPDATE NAME
        # ----------------------------------------------------

        if "name" in data:

            name = (data.get("name") or "").strip()

            if not name:

                return jsonify({
                    "success": False,
                    "message": "Service name cannot be empty"
                }), 400

            # Check duplicate, excluding this service
            existing = Service.query.filter(
                db.func.lower(Service.name) == name.lower(),
                Service.id != service.id
            ).first()

            if existing:

                return jsonify({
                    "success": False,
                    "message": f"Service '{existing.name}' already exists."
                }), 409

            service.name = name

        # ----------------------------------------------------
        # UPDATE FEE
        # ----------------------------------------------------

        if "fee" in data:

            try:

                fee = float(data.get("fee"))

            except (TypeError, ValueError):

                return jsonify({
                    "success": False,
                    "message": "Valid service fee is required"
                }), 400

            if fee < 0:

                return jsonify({
                    "success": False,
                    "message": "Service fee cannot be negative"
                }), 400

            service.fee = fee

        # ----------------------------------------------------
        # SAVE
        # ----------------------------------------------------

        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Service updated successfully",
            "service": {
                "id": service.id,
                "name": service.name,
                "fee": float(service.fee)
            }
        })

    except Exception as e:

        db.session.rollback()

        return jsonify({
            "success": False,
            "message": "Unable to update service",
            "error": str(e)
        }), 500

# ============================================================
# DELETE SERVICE
# ============================================================

@service_bp.delete("/<int:service_id>")
def delete_service(service_id):

    try:

        service = Service.query.get(service_id)

        if not service:

            return jsonify({
                "success": False,
                "message": "Service not found"
            }), 404

        db.session.delete(service)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Service deleted successfully"
        })

    except Exception as e:

        db.session.rollback()

        return jsonify({
            "success": False,
            "message": "Unable to delete service",
            "error": str(e)
        }), 500