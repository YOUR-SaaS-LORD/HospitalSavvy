from flask import Blueprint, request, jsonify
from extensions import db
from models.emergency import EmergencyCase

emergency_bp = Blueprint(
    "emergency",
    __name__,
    url_prefix="/api/emergencies"
)

@emergency_bp.get("/")
def get_emergencies():
    try:
        emergencies = EmergencyCase.query.order_by(
            Emergency.id.desc()
        ).all()

        return jsonify({
            "success": True,
            "emergencies": [
                emergency.to_dict()
                for emergency in emergencies
            ]
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@emergency_bp.get("/<int:emergency_id>")
def get_emergency(emergency_id):
    emergency = EmergencyCase.query.get(emergency_id)

    if not emergency:
        return jsonify({
            "success": False,
            "message": "Emergency record not found"
        }), 404

    return jsonify({
        "success": True,
        "emergency": emergency.to_dict()
    })

@emergency_bp.post("/")
def create_emergency():
    try:
        data = request.get_json(silent=True) or {}

        emergency = Emergency(
            patient_id=data.get("patient_id"),
            emergency_type=data.get("emergency_type"),
            description=data.get("description"),
            priority=data.get("priority", "high"),
            status=data.get("status", "active")
        )

        db.session.add(emergency)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Emergency recorded successfully",
            "emergency": emergency.to_dict()
        }), 201

    except Exception as e:
        db.session.rollback()

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@emergency_bp.put("/<int:emergency_id>")
def update_emergency(emergency_id):
    try:
        emergency = EmergencyCase.query.get(emergency_id)

        if not emergency:
            return jsonify({
                "success": False,
                "message": "Emergency record not found"
            }), 404

        data = request.get_json(silent=True) or {}

        if "patient_id" in data:
            emergency.patient_id = data["patient_id"]

        if "emergency_type" in data:
            emergency.emergency_type = data["emergency_type"]

        if "description" in data:
            emergency.description = data["description"]

        if "priority" in data:
            emergency.priority = data["priority"]

        if "status" in data:
            emergency.status = data["status"]

        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Emergency updated successfully",
            "emergency": emergency.to_dict()
        })

    except Exception as e:
        db.session.rollback()

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@emergency_bp.delete("/<int:emergency_id>")
def delete_emergency(emergency_id):
    try:
        emergency = EmergencyCase.query.get(emergency_id)

        if not emergency:
            return jsonify({
                "success": False,
                "message": "Emergency record not found"
            }), 404

        db.session.delete(emergency)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Emergency deleted successfully"
        })

    except Exception as e:
        db.session.rollback()

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500