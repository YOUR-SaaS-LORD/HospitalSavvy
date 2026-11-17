from flask import Flask, render_template, redirect, url_for, session, jsonify, request
from dotenv import load_dotenv
import os
from datetime import datetime

from extensions import db

# ============================================================
# LOAD ENV & INIT APP
# ============================================================
load_dotenv()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 102 * 1024 * 1024
app.config["DEBUG"] = os.getenv("FLASK_DEBUG", "false").strip().lower() in {"1", "true", "yes", "on"}

@app.errorhandler(413)
def request_too_large(_error):
    return jsonify(success=False, error="The upload exceeds the 100 MB Procurement file limit."), 413

# Session
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
secure_cookie_default = os.getenv("APP_ENV", "development").strip().lower() == "production"
app.config["SESSION_COOKIE_SECURE"] = os.getenv(
    "SESSION_COOKIE_SECURE", str(secure_cookie_default)
).strip().lower() in {"1", "true", "yes", "on"}

# Database
app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv("DATABASE_URL")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False


# Fail early
if not app.config["SQLALCHEMY_DATABASE_URI"]:
    raise RuntimeError("DATABASE_URL is missing. Check your .env file.")

if not app.config["SECRET_KEY"]:
    raise RuntimeError("SECRET_KEY is missing. Check your .env file.")

db.init_app(app)

# ============================================================
# MODELS - Import to register with SQLAlchemy before create_all()
# ============================================================
from models.patient import Patient
from models.patient_claim import PatientClaim
from models.user import User
from models.staff import Staff

from models.hospital import Department, Ward, Bed, Service
from models.inventory import InventoryItem
from models.audit_log import AuditLog

from models.reception import ReceptionVisit
from models.triage import TriageRecord
from models.clinical import ClinicalRecord, Referral
from models.emergency import EmergencyCase
from models.nursing import NursingCare, DoctorRoundNote

from models.lab import LabResult
from models.pharmacy import PharmacyDispense
from models.radiology import RadiologyResult
from models.theatre import SurgicalRecord

from models.billing import Billing
from models.medical_report import MedicalReport
# ============================================================
# PROCUREMENT, SECRETARIATE & GUIDANCE MODULES
# ============================================================


from models.secretariate import SecretariateDocumentTemplate, SecretariateDocument
from models.procurement import ProcurementDocumentTemplate, ProcurementDocument
from models.guidance_counseling import CounselingRecord
from models.department_communication import DepartmentMessage, DepartmentSharedDocument, AccountsDispensingDocument

# ============================================================
# MIDDLEWARE & ROUTES
# ============================================================
from audit_middleware import register_audit_hooks
from routes.department_communication_routes import communication_bp

# Auth & Core
from routes.auth_routes import auth_bp
from routes.user_routes import users_bp
from routes.patient_routes import patient_bp
from routes.patient_claim_routes import patient_claim_bp
from routes.admin_routes import admin_bp
from routes.staff_routes import staff_bp

# Hospital Structure
from routes.department_routes import department_bp
from routes.ward_routes import ward_bp
from routes.service_routes import service_bp
from routes.inventory_routes import inventory_bp
from routes.security_routes import security_bp

# Clinical Workflow
from routes.reception_routes import reception_bp
from routes.triage_routes import triage_bp
from routes.doctor_routes import doctor_bp
from routes.emergency_routes import emergency_bp
from routes.nursing_routes import nursing_bp

# Diagnostics & Support
from routes.lab_routes import lab_bp
from routes.pharmacy_routes import pharmacy_bp
from routes.radiology_routes import radiology_bp
from routes.surgery_routes import surgery_bp
from routes.opd_routes import opd_bp
from routes.billing_routes import billing_bp
from routes.medical_report_routes import medical_report_bp
from routes.dashboard_routes import dashboard_bp
from routes.administration_routes import administration_bp


from routes.secretariate_routes import secretariate_bp
from routes.procurement_routes import procurement_bp
from routes.guidance_counseling_routes import guidance_bp
from routes.office_helper_routes import (
    ALLOWED_EXTENSIONS,
    MAX_UPLOAD_BYTES,
    actor,
    canonical_role,
    json_body,
    json_error,
    parse_date,
    require_roles,
    require_department,
    upload_folder,
    authenticated_user,
)
   
# ============================================================
# REGISTER BLUEPRINTS
# ============================================================
# Core
app.register_blueprint(communication_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(users_bp)
app.register_blueprint(patient_bp)
app.register_blueprint(patient_claim_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(staff_bp)


# Structure & Security
app.register_blueprint(department_bp)
app.register_blueprint(ward_bp)
app.register_blueprint(service_bp)
app.register_blueprint(inventory_bp)
app.register_blueprint(security_bp)

# Workflow
app.register_blueprint(reception_bp)
app.register_blueprint(triage_bp)
app.register_blueprint(doctor_bp)
app.register_blueprint(emergency_bp)
app.register_blueprint(nursing_bp)

# Diagnostics
app.register_blueprint(lab_bp)
app.register_blueprint(pharmacy_bp)
app.register_blueprint(radiology_bp)
app.register_blueprint(surgery_bp)

# Operations
app.register_blueprint(opd_bp)
app.register_blueprint(billing_bp)
app.register_blueprint(medical_report_bp)
app.register_blueprint(dashboard_bp)
app.register_blueprint(administration_bp)


app.register_blueprint(secretariate_bp)
app.register_blueprint(procurement_bp)
app.register_blueprint(guidance_bp)


# ============================================================
# AUDIT HOOKS - Register after blueprints
# ============================================================
register_audit_hooks(app)

# Every private API is protected here, including endpoints that do not have
# their own decorator. This keeps direct URL/API requests subject to the same
# account and module checks as navigation in the browser.
ADMIN_ROLES = {"system_admin"}
HOSPITAL_ADMIN_ROLES = ADMIN_ROLES | {"hospital_manager"}
CLINICAL_ROLES = {
    "doctor", "nurse", "receptionist", "opd", "labtech", "pharmacist", "radiologist",
    "surgeon", "accountant", "guidance_counselor", "counselor",
}
PATIENT_READ_ROLES = CLINICAL_ROLES | HOSPITAL_ADMIN_ROLES | {"secretary"}
ALL_STAFF_ROLES = PATIENT_READ_ROLES | {"secretary", "procurement_officer"}

def api_role_allowed(path, method, role):
    """Central role policy for all API blueprints, including unguarded routes."""
    method = method.upper()
    if path == "/api/auth/me":
        return True
    if path.startswith("/api/office/secretariate"):
        return role in {"system_admin", "hospital_manager", "secretary"}
    if path.startswith("/api/office/procurement"):
        return role in {"procurement_officer", "system_admin"}
    if path.startswith("/api/office/guidance"):
        return role in {"guidance_counselor", "counselor", "system_admin"}
    if path.startswith("/api/department-communication"):
        return role in {"system_admin", "hospital_manager", "accountant", "accounts", "accounts_officer", "procurement_officer"}
    if path == "/api/admin/initial-admin":
        return role in ADMIN_ROLES  # authenticated callers receive the route's already-exists result
    # Patient Files and role-scoped current-visit printing are available to
    # clinical staff, Finance, Guidance & Counseling, and hospital admins.
    if path in {"/api/admin/hospital/patients"} or path.startswith("/api/admin/hospital/patient-journey/"):
        return role in PATIENT_READ_ROLES
    if path.startswith("/api/admin/hospital/"):
        return role in HOSPITAL_ADMIN_ROLES
    if path.startswith("/api/admin/facilitation-funds"):
        # Existing confirmed records remain available to Accounts; new requests
        # are no longer created from Hospital Administration.
        if method == "GET":
            return role in HOSPITAL_ADMIN_ROLES | {"accountant"}
        if method == "POST":
            return role in {"system_admin"}
        return role in HOSPITAL_ADMIN_ROLES | {"accountant"}
    if path.startswith("/api/admin/") or path.startswith("/api/users") or path.startswith("/api/staff") or path.startswith("/api/security"):
        return role in ADMIN_ROLES
    if path.startswith(("/api/departments", "/api/wards", "/api/services")):
        return role in ALL_STAFF_ROLES if method in {"GET", "HEAD"} else role in HOSPITAL_ADMIN_ROLES
    if path.startswith("/api/inventory"):
        return role in (ALL_STAFF_ROLES | {"hospital_manager"}) if method in {"GET", "HEAD"} else role in HOSPITAL_ADMIN_ROLES | {"pharmacist"}
    if path.startswith("/api/patients"):
        if method in {"GET", "HEAD"}:
            return role in PATIENT_READ_ROLES
        return role in {"receptionist", "opd", "system_admin", "hospital_manager"}
    if path.startswith("/api/patient-claims"):
        return role in PATIENT_READ_ROLES
    if path.startswith(("/api/reception", "/api/opd")):
        return role in {"receptionist", "opd", "accountant", "nurse", "doctor"}
    if path.startswith("/api/triage"):
        return role in {"nurse", "receptionist", "opd", "doctor"}
    if path.startswith("/api/doctor/nursing-rounds/"):
        return role in {"doctor", "nurse"}
    if path.startswith(("/api/doctor", "/api/clinical")):
        return role in {"doctor", "nurse", "receptionist", "opd"}
    if path.startswith(("/api/emergencies",)):
        return role in {"doctor", "nurse", "receptionist", "opd"}
    if path.startswith("/api/nursing"):
        return role in {"nurse", "doctor"}
    if path.startswith("/api/laboratory"):
        return role in {"labtech", "doctor", "nurse"}
    if path.startswith("/api/pharmacy"):
        return role in {"pharmacist", "doctor", "nurse"}
    if path.startswith("/api/radiology"):
        return role in {"radiologist", "doctor", "nurse"}
    if path.startswith(("/api/surgery", "/api/theatre")):
        return role in {"surgeon", "doctor", "nurse"}
    if path.startswith("/api/billing"):
        return role in {"accountant", "receptionist", "opd"}
    if path.startswith("/api/medical-reports"):
        return role in {"doctor", "hospital_manager", "system_admin"}
    if path.startswith("/api/reports"):
        return role in {"accountant", "doctor", "nurse", "hospital_manager", "system_admin"}
    return False

@app.before_request
def enforce_private_route_authorization():
    path = request.path
    if path == "/api/auth/login" or path == "/api/auth/setup-status":
        return None
    if path == "/api/admin/initial-admin" and request.method == "POST":
        # Hospital Manager is a separate account; only System Admin closes setup.
        admin_roles = {"system_admin"}
        if not any(canonical_role(user.role) in admin_roles for user in User.query.all()):
            return None
    # /opd remains a legacy alias, but it no longer opens a separate portal.
    is_private_page = path in ("/hms", "/opd")
    is_private_api = path.startswith("/api/") and path != "/api/auth/logout"
    is_dashboard_api = path.startswith("/dashboard")
    if not (is_private_page or is_private_api or is_dashboard_api):
        return None

    user, role = authenticated_user()
    if not user:
        if is_private_page:
            return redirect(url_for("login_page"))
        return jsonify(success=False, authenticated=False, error="Authentication required."), 401
    if is_private_api and not api_role_allowed(path, request.method, role):
        return jsonify(success=False, error="You are not authorized to access this resource."), 403
    if is_dashboard_api and role not in {"system_admin", "hospital_manager"}:
        return jsonify(success=False, error="You are not authorized to access this resource."), 403
    return None


@app.after_request
def hide_patients_claimed_by_other_staff(response):
    """Remove actively selected patients from every staff-facing queue response."""
    if (request.method != "GET" and request.path != "/api/reception/matches") or not response.is_json or not session.get("user_id"):
        return response

    queue_shapes = {
        "/api/doctor/queue": ("doctor", "patients", "id"),
        "/api/doctor/nursing-rounds/patients": ("doctor", "patients", "id"),
        "/api/triage/queue": ("triage", "patients", "id"),
        "/api/nursing/referrals": ("nurse", None, "patient_id"),
        "/api/nursing/inpatient": ("nurse", None, "patient_id"),
        "/api/laboratory/requests": ("lab", None, "patient_id"),
        "/api/laboratory/patients-for-release": ("lab", "patients", "id"),
        "/api/radiology/queue": ("radiology", "requests", "patient_id"),
        "/api/pharmacy/queue": ("pharmacy", "patients", "patient_id"),
        "/api/surgery/referrals": ("theatre", None, "patient_id"),
        "/api/opd/patients": ("opd", "patients", "id"),
        "/api/emergencies/": ("emergency", "emergencies", "patient_id"),
        "/api/patients/": ("role-workspace", None, "id"),
        "/api/office/guidance/patients": ("guidance-counseling", "patients", "id"),
        "/api/admin/patients": ("administration", "patients", "id"),
        "/api/admin/hospital/patients": ("role-workspace", "patients", "id"),
        "/api/reception/matches": ("reception", "matches", "id"),
    }
    shape = queue_shapes.get(request.path)
    if not shape:
        return response

    from models.patient_claim import PatientClaim

    module, key, patient_key = shape
    if module == "role-workspace":
        role_modules = {
            "doctor": "doctor", "nurse": "nurse", "labtech": "lab",
            "radiologist": "radiology", "pharmacist": "pharmacy",
            "surgeon": "theatre", "receptionist": "reception", "opd": "opd",
            "accountant": "accounts", "guidance_counselor": "guidance-counseling",
            "counselor": "guidance-counseling", "admin": "administration",
            "system_admin": "administration", "hospital_manager": "administration",
        }
        module = role_modules.get(canonical_role(session.get("role")))
        if not module:
            return response
    claimed_ids = {
        str(patient_id)
        for (patient_id,) in db.session.query(PatientClaim.patient_id).filter(
            PatientClaim.expires_at > datetime.utcnow(),
            PatientClaim.module == module,
            PatientClaim.user_id != session.get("user_id"),
        ).all()
    }
    if not claimed_ids:
        return response

    payload = response.get_json(silent=True)
    rows = payload if key is None and isinstance(payload, list) else payload.get(key, []) if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        return response
    filtered = [row for row in rows if str(row.get(patient_key, "")) not in claimed_ids]
    if len(filtered) == len(rows):
        return response
    if key is None:
        payload = filtered
    else:
        payload[key] = filtered
    response.set_data(app.json.dumps(payload))
    response.mimetype = "application/json"
    return response

# ============================================================
# PAGES
# ============================================================


def _ensure_inventory_expiry_column():
    """Add the nullable expiry column to existing installs without touching stock rows."""
    from sqlalchemy import inspect, text
    try:
        inspector = inspect(db.engine)
        if not inspector.has_table("inventory_items"):
            return
        columns = {c["name"] for c in inspector.get_columns("inventory_items")}
        if "expiry_date" not in columns:
            dialect = db.engine.dialect.name
            column_type = "DATE"
            with db.engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE inventory_items ADD COLUMN expiry_date {column_type}"))
        if "price_per_unit" not in columns:
            with db.engine.begin() as conn:
                conn.execute(text("ALTER TABLE inventory_items ADD COLUMN price_per_unit FLOAT NOT NULL DEFAULT 0"))
    except Exception:
        app.logger.exception("Could not ensure inventory expiry_date column; run the database migration before using expiry filters.")

@app.route("/")
def index():
    return render_template("login.html")

@app.route("/login")
def login_page():
    return render_template("login.html")

# ------------------------------------------------------------
# OPD / Reception shares the standard HMS workspace.
# Legacy URLs redirect into the normal login/workspace flow.
# ------------------------------------------------------------
@app.route("/opd/login")
def opd_login_page():
    return redirect(url_for("login_page"))

@app.route("/opd")
def opd_page():
    if not session.get("user_id"):
        return redirect(url_for("login_page"))
    return redirect(url_for("hms"))

@app.route("/hms")
def hms():
    if not session.get("user_id"):
        return redirect(url_for("login_page"))
    return render_template("hms.html", page_mode="hms")

@app.route("/health")
def health():
    return {
        "status": "ok",
        "application": "Hospital Management System"
    }

# ============================================================
# INIT DB
# ============================================================
def _ensure_patient_national_id_column():
    """Small forward migration for existing databases; National ID remains optional."""
    from sqlalchemy import inspect, text
    inspector = inspect(db.engine)
    if "patients" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("patients")}
    if "national_id" not in columns:
        db.session.execute(text("ALTER TABLE patients ADD COLUMN national_id VARCHAR(50)"))
        db.session.commit()
    # A non-unique lookup index is safe for existing records; app-level duplicate check
    # prevents reusing an already recorded National ID during new registration.
    db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_patients_national_id ON patients (national_id)"))
    db.session.commit()


def _ensure_department_communication_schema():
    """Bring earlier forwarding tables forward without losing their records."""
    from sqlalchemy import inspect, text
    try:
        inspector = inspect(db.engine)
        if inspector.has_table("department_messages"):
            columns = {column["name"] for column in inspector.get_columns("department_messages")}
            if "message" not in columns:
                # The default makes this safe even where historical rows exist.
                with db.engine.begin() as connection:
                    connection.execute(text("ALTER TABLE department_messages ADD COLUMN message TEXT NOT NULL DEFAULT ''"))
            # Preserve prior internal-message content in the unified
            # forwarding conversation history.
            if {"message", "body"}.issubset(columns | {"message"}):
                with db.engine.begin() as connection:
                    connection.execute(text("UPDATE department_messages SET message = body WHERE message = '' AND body IS NOT NULL"))
            if "forward_id" not in columns:
                with db.engine.begin() as connection:
                    connection.execute(text("ALTER TABLE department_messages ADD COLUMN forward_id VARCHAR(36)"))
        if inspector.has_table("department_shared_documents"):
            columns = {column["name"] for column in inspector.get_columns("department_shared_documents")}
            if "forward_id" not in columns:
                with db.engine.begin() as connection:
                    connection.execute(text("ALTER TABLE department_shared_documents ADD COLUMN forward_id VARCHAR(36)"))
    except Exception:
        app.logger.exception("Could not update the department communication schema.")


def _ensure_inventory_cost_columns():
    """Add current tablet box pricing to databases created by older versions."""
    from sqlalchemy import inspect, text
    try:
        inspector = inspect(db.engine)
        if not inspector.has_table("inventory_items"):
            return
        columns = {column["name"] for column in inspector.get_columns("inventory_items")}
        if "price_per_box" not in columns:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE inventory_items ADD COLUMN price_per_box FLOAT"))
    except Exception:
        app.logger.exception("Could not update inventory cost columns.")

with app.app_context():
    db.create_all()
    _ensure_inventory_expiry_column()
    _ensure_patient_national_id_column()
    _ensure_department_communication_schema()
    _ensure_inventory_cost_columns()

# ============================================================
# RUN
# ============================================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=app.config["DEBUG"])
