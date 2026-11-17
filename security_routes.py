from flask import Blueprint, jsonify, request, session, send_file, after_this_request, current_app
from extensions import db
from models.audit_log import AuditLog
from models.user import User
from datetime import datetime, date, time, timedelta
from sqlalchemy import or_
from sqlalchemy.engine import make_url
import csv
import io
import os
import shutil
import subprocess
import tempfile

security_bp = Blueprint("security", __name__, url_prefix="/api/security")


def get_current_user():
    """Resolve the authenticated HMS account from the Flask session."""
    user_id = session.get("user_id")
    if not user_id:
        return None

    try:
        user = db.session.get(User, user_id)
    except Exception:
        db.session.rollback()
        return None

    if not user:
        return None
    if hasattr(user, "is_active") and not user.is_active:
        return None

    return {
        "id": getattr(user, "id", user_id),
        "username": getattr(user, "username", None) or session.get("username"),
        "role": getattr(user, "role", None) or session.get("role"),
        "staff_id": getattr(user, "staff_id", None),
    }


def _normalise_role(value):
    role = " ".join(str(value or "").strip().lower().replace("_", " ").replace("-", " ").split())
    aliases = {
        "admin": "system admin",
        "administrator": "system admin",
        "system administrator": "system admin",
        "hospital administrator": "hospital manager",
    }
    return aliases.get(role, role)


def require_admin():
    user = get_current_user()
    if not user:
        return None, (jsonify({"success": False, "message": "Authentication required."}), 401)

    role = _normalise_role(user.get("role"))
    if role != "system admin":
        return None, (jsonify({"success": False, "message": "Administrator access required."}), 403)
    return user, None


def create_audit_log(action, module, description, user=None):
    """Add one audit event to the current SQLAlchemy transaction; caller commits."""
    if user is None:
        user = get_current_user()

    action_text = str(action or "SYSTEM_EVENT").strip()[:100] or "SYSTEM_EVENT"
    description_text = str(description or action_text).strip()[:10000] or action_text
    log = AuditLog(
        user_id=str(user.get("id"))[:100] if user and user.get("id") is not None else None,
        username=str(user.get("username") or "")[:150] or None if user else None,
        role=str(user.get("role") or "")[:100] or None if user else None,
        action=action_text,
        module=str(module or "System").strip()[:100] or None,
        description=description_text,
        ip_address=(request.headers.get("X-Forwarded-For", request.remote_addr) or "").split(",")[0].strip()[:45] or None,
    )
    db.session.add(log)
    return log


def _log_dict(log):
    return log.to_dict() if hasattr(log, "to_dict") else {
        "id": log.id,
        "user_id": log.user_id,
        "username": log.username,
        "role": log.role,
        "action": log.action,
        "module": log.module,
        "description": log.description,
        "ip_address": log.ip_address,
        "created_at": log.created_at.isoformat() if log.created_at else None,
    }


def filtered_audit_query():
    query = AuditLog.query
    from_date = request.args.get("from_date", "").strip()
    to_date = request.args.get("to_date", "").strip()
    patient_id = request.args.get("patient_id", "").strip()
    username = request.args.get("username", "").strip()
    module = request.args.get("module", "").strip()
    action = request.args.get("action", "").strip()

    if from_date:
        try:
            start = datetime.combine(date.fromisoformat(from_date), time.min)
        except ValueError:
            raise ValueError("Invalid from_date. Use YYYY-MM-DD.")
        query = query.filter(AuditLog.created_at >= start)

    if to_date:
        try:
            end_exclusive = datetime.combine(date.fromisoformat(to_date) + timedelta(days=1), time.min)
        except ValueError:
            raise ValueError("Invalid to_date. Use YYYY-MM-DD.")
        query = query.filter(AuditLog.created_at < end_exclusive)

    if patient_id:
        # This model has no patient_id column, so patient filtering searches the description.
        query = query.filter(AuditLog.description.ilike(f"%{patient_id}%"))
    if username:
        query = query.filter(AuditLog.username.ilike(f"%{username}%"))
    if module:
        query = query.filter(AuditLog.module.ilike(f"%{module}%"))
    if action:
        query = query.filter(AuditLog.action.ilike(f"%{action}%"))

    return query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())


@security_bp.route("/audit-logs", methods=["GET"])
def get_audit_logs():
    user, error = require_admin()
    if error:
        return error
    try:
        limit = request.args.get("limit", "1000")
        try:
            limit = max(1, min(int(limit), 5000))
        except (TypeError, ValueError):
            limit = 1000
        logs = filtered_audit_query().limit(limit).all()
        return jsonify({"success": True, "count": len(logs), "logs": [_log_dict(log) for log in logs]}), 200
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Failed to load HMS audit logs")
        return jsonify({"success": False, "message": "Failed to load audit logs."}), 500


@security_bp.route("/audit-logs", methods=["POST"])
def add_audit_log():
    """Persist a frontend event. Identity/role are taken from the server session, never the request body."""
    user = get_current_user()
    if not user:
        return jsonify({"success": False, "message": "Authentication required."}), 401

    data = request.get_json(silent=True) or {}
    action = str(data.get("action") or "").strip()[:100]
    module = str(data.get("module") or "HMS").strip()[:100]
    description = str(data.get("description") or "").strip()[:10000]
    if not action or not description:
        return jsonify({"success": False, "message": "Action and description are required."}), 400

    try:
        log = create_audit_log(action, module, description, user=user)
        db.session.commit()
        return jsonify({"success": True, "message": "Audit event saved.", "log": _log_dict(log)}), 201
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Failed to save HMS audit event")
        return jsonify({"success": False, "message": "Failed to save audit event."}), 500


@security_bp.route("/audit-logs/export", methods=["GET"])
def export_audit_logs():
    user, error = require_admin()
    if error:
        return error
    try:
        logs = filtered_audit_query().limit(50000).all()
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow(["Date and Time", "User ID", "Username", "Role", "Action", "Module", "Description", "IP Address"])
        for log in logs:
            row = _log_dict(log)
            writer.writerow([row.get("created_at", ""), row.get("user_id", ""), row.get("username", ""), row.get("role", ""), row.get("action", ""), row.get("module", ""), row.get("description", ""), row.get("ip_address", "")])
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return send_file(io.BytesIO(output.getvalue().encode("utf-8-sig")), mimetype="text/csv; charset=utf-8", as_attachment=True, download_name=f"HMS_Audit_Logs_{stamp}.csv")
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Failed to export HMS audit logs")
        return jsonify({"success": False, "message": "Failed to export audit logs."}), 500


def _find_pg_dump():
    executable = shutil.which("pg_dump")
    if executable:
        return executable
    candidates = [
        r"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe",
        r"C:\Program Files\PostgreSQL\17\bin\pg_dump.exe",
        r"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe",
    ]
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate
    return None


@security_bp.route("/backup", methods=["GET", "POST"])
def download_database_backup():
    user, error = require_admin()
    if error:
        return error

    backup_path = None
    try:
        database_url = current_app.config.get("SQLALCHEMY_DATABASE_URI") or os.getenv("DATABASE_URL") or os.getenv("SQLALCHEMY_DATABASE_URI")
        if not database_url:
            return jsonify({"success": False, "message": "DATABASE_URL is not configured."}), 500

        url = make_url(database_url)
        if url.get_backend_name() != "postgresql":
            return jsonify({"success": False, "message": "Database backup currently supports PostgreSQL only."}), 400

        pg_dump = _find_pg_dump()
        if not pg_dump:
            return jsonify({"success": False, "message": "pg_dump was not found. Add PostgreSQL's bin directory to PATH or install PostgreSQL command-line tools."}), 500
        if not url.database:
            return jsonify({"success": False, "message": "The PostgreSQL database name is missing from DATABASE_URL."}), 500

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        handle = tempfile.NamedTemporaryFile(prefix="hms_database_backup_", suffix=".dump", delete=False)
        backup_path = handle.name
        handle.close()

        env = os.environ.copy()
        if url.password is not None:
            env["PGPASSWORD"] = url.password
        query_options = dict(url.query or {})
        if query_options.get("sslmode"):
            env["PGSSLMODE"] = str(query_options["sslmode"])

        command = [pg_dump, "--format=custom", "--no-password", "--file", backup_path, "--dbname", url.database]
        if url.host:
            command.extend(["--host", url.host])
        if url.port:
            command.extend(["--port", str(url.port)])
        if url.username:
            command.extend(["--username", url.username])

        result = subprocess.run(command, capture_output=True, text=True, timeout=600, env=env, check=False)
        if result.returncode != 0:
            # Avoid returning connection strings/passwords to the browser.
            current_app.logger.error("pg_dump failed: %s", (result.stderr or "").strip()[:2000])
            raise RuntimeError("pg_dump failed. Check the Flask terminal for the PostgreSQL error.")
        if not os.path.isfile(backup_path) or os.path.getsize(backup_path) == 0:
            raise RuntimeError("pg_dump did not create a non-empty backup file.")

        create_audit_log("DATABASE_BACKUP", "Security", "PostgreSQL database backup generated and downloaded.", user=user)
        db.session.commit()

        path_to_delete = backup_path
        @after_this_request
        def _delete_temporary_backup(response):
            try:
                if os.path.exists(path_to_delete):
                    os.remove(path_to_delete)
            except OSError:
                current_app.logger.warning("Could not remove temporary HMS backup file: %s", path_to_delete)
            return response

        return send_file(backup_path, as_attachment=True, download_name=f"HMS_Database_Backup_{timestamp}.dump", mimetype="application/octet-stream", max_age=0)

    except subprocess.TimeoutExpired:
        db.session.rollback()
        current_app.logger.exception("HMS database backup timed out")
        if backup_path and os.path.exists(backup_path):
            try:
                os.remove(backup_path)
            except OSError:
                pass
        return jsonify({"success": False, "message": "Database backup timed out after 10 minutes."}), 504
    except Exception:
        db.session.rollback()
        current_app.logger.exception("HMS database backup failed")
        if backup_path and os.path.exists(backup_path):
            try:
                os.remove(backup_path)
            except OSError:
                pass
        return jsonify({"success": False, "message": "Database backup failed. Check the Flask terminal for details."}), 500
