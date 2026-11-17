from flask import Blueprint, request, jsonify
from datetime import datetime

from extensions import db
from models.medical_report import MedicalReport

medical_report_bp = Blueprint(
    "medical_report",
    __name__,
    url_prefix="/api/medical-reports"
)

# ============================================================
# GET ALL MEDICAL REPORTS
# ============================================================
@medical_report_bp.route("/", methods=["GET"])
def get_medical_reports():
    try:
        reports = MedicalReport.query.order_by(
            MedicalReport.report_date.desc()
        ).all()

        return jsonify([
            report.to_dict()
            for report in reports
        ]), 200

    except Exception as e:
        return jsonify({
            "error": str(e)
        }), 500

# ============================================================
# GET SINGLE MEDICAL REPORT
# ============================================================
@medical_report_bp.route("/<int:report_id>", methods=["GET"])
def get_medical_report(report_id):
    try:
        report = MedicalReport.query.get(report_id)

        if not report:
            return jsonify({
                "error": "Medical report not found"
            }), 404

        return jsonify(report.to_dict()), 200

    except Exception as e:
        return jsonify({
            "error": str(e)
        }), 500

# ============================================================
# GET REPORTS FOR A PATIENT
# ============================================================
@medical_report_bp.route("/patient/<int:patient_id>", methods=["GET"])
def get_patient_medical_reports(patient_id):
    try:
        reports = MedicalReport.query.filter_by(
            patient_id=patient_id
        ).order_by(
            MedicalReport.report_date.desc()
        ).all()

        return jsonify([
            report.to_dict()
            for report in reports
        ]), 200

    except Exception as e:
        return jsonify({
            "error": str(e)
        }), 500

# ============================================================
# CREATE MEDICAL REPORT
# ============================================================
@medical_report_bp.route("/", methods=["POST"])
def create_medical_report():
    try:
        data = request.get_json() or {}

        required_fields = [
            "patient_id",
            "report_type",
            "title"
        ]

        for field in required_fields:
            if not data.get(field):
                return jsonify({
                    "error": f"{field} is required"
                }), 400

        report_date = None

        if data.get("report_date"):
            try:
                report_date = datetime.fromisoformat(
                    data["report_date"].replace("Z", "+00:00")
                )
            except ValueError:
                return jsonify({
                    "error": "Invalid report_date format"
                }), 400

        report = MedicalReport(
            patient_id=data["patient_id"],
            report_type=data["report_type"],
            title=data["title"],
            report_date=report_date or datetime.utcnow(),
            doctor_name=data.get("doctor_name"),
            department=data.get("department"),
            diagnosis=data.get("diagnosis"),
            findings=data.get("findings"),
            recommendations=data.get("recommendations"),
            report_content=data.get("report_content"),
            status=data.get("status", "Completed"),
            created_by=data.get("created_by")
        )

        db.session.add(report)
        db.session.commit()

        return jsonify({
            "message": "Medical report created successfully",
            "report": report.to_dict()
        }), 201

    except Exception as e:
        db.session.rollback()

        return jsonify({
            "error": str(e)
        }), 500

# ============================================================
# UPDATE MEDICAL REPORT
# ============================================================
@medical_report_bp.route("/<int:report_id>", methods=["PUT"])
def update_medical_report(report_id):
    try:
        report = MedicalReport.query.get(report_id)

        if not report:
            return jsonify({
                "error": "Medical report not found"
            }), 404

        data = request.get_json() or {}

        if "patient_id" in data:
            report.patient_id = data["patient_id"]

        if "report_type" in data:
            report.report_type = data["report_type"]

        if "title" in data:
            report.title = data["title"]

        if "report_date" in data:
            if data["report_date"]:
                try:
                    report.report_date = datetime.fromisoformat(
                        data["report_date"].replace("Z", "+00:00")
                    )
                except ValueError:
                    return jsonify({
                        "error": "Invalid report_date format"
                    }), 400
            else:
                report.report_date = None

        if "doctor_name" in data:
            report.doctor_name = data["doctor_name"]

        if "department" in data:
            report.department = data["department"]

        if "diagnosis" in data:
            report.diagnosis = data["diagnosis"]

        if "findings" in data:
            report.findings = data["findings"]

        if "recommendations" in data:
            report.recommendations = data["recommendations"]

        if "report_content" in data:
            report.report_content = data["report_content"]

        if "status" in data:
            report.status = data["status"]

        if "created_by" in data:
            report.created_by = data["created_by"]

        db.session.commit()

        return jsonify({
            "message": "Medical report updated successfully",
            "report": report.to_dict()
        }), 200

    except Exception as e:
        db.session.rollback()

        return jsonify({
            "error": str(e)
        }), 500

# ============================================================
# DELETE MEDICAL REPORT
# ============================================================
@medical_report_bp.route("/<int:report_id>", methods=["DELETE"])
def delete_medical_report(report_id):
    try:
        report = MedicalReport.query.get(report_id)

        if not report:
            return jsonify({
                "error": "Medical report not found"
            }), 404

        db.session.delete(report)
        db.session.commit()

        return jsonify({
            "message": "Medical report deleted successfully"
        }), 200

    except Exception as e:
        db.session.rollback()

        return jsonify({
            "error": str(e)
        }), 500