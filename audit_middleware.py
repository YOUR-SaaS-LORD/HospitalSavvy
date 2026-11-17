"""Application-wide audit hook for HMS API mutations.

Install with register_audit_hooks(app) after importing models and registering blueprints.
It logs API POST/PUT/PATCH/DELETE requests (including rejected attempts) without recording
request bodies, passwords, tokens, or clinical form contents.
"""
from flask import request, session, g
from extensions import db


SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
EXCLUDED_PATHS = {
    "/api/security/audit-logs",
    "/api/security/audit-logs/export",
    "/api/security/backup",
}


def register_audit_hooks(app):
    @app.before_request
    def _remember_audit_actor():
        g.hms_audit_actor_before = {
            "id": session.get("user_id"),
            "username": session.get("username"),
            "role": session.get("role"),
        }

    @app.after_request
    def _write_hms_audit_event(response):
        path = request.path or ""
        if not path.startswith("/api/") or path in EXCLUDED_PATHS:
            return response

        # Record every API mutation, and failed authentication/authorization requests.
        should_log = request.method not in SAFE_METHODS or response.status_code in (401, 403)
        if not should_log:
            return response

        current_actor = {
            "id": session.get("user_id"),
            "username": session.get("username"),
            "role": session.get("role"),
        }
        previous_actor = getattr(g, "hms_audit_actor_before", {}) or {}
        actor = current_actor if current_actor.get("id") else previous_actor
        endpoint = request.endpoint or path
        module = endpoint.split(".", 1)[0].replace("_", " ").title() if endpoint else "API"
        action = f"API_{request.method}_{response.status_code}"
        description = f"API request {request.method} {path} completed with HTTP {response.status_code}. Endpoint: {endpoint}."

        try:
            from models.audit_log import AuditLog
            log = AuditLog(
                user_id=str(actor.get("id"))[:100] if actor.get("id") is not None else None,
                username=str(actor.get("username") or "")[:150] or None,
                role=str(actor.get("role") or "")[:100] or None,
                action=action[:100],
                module=module[:100],
                description=description[:10000],
                ip_address=(request.headers.get("X-Forwarded-For", request.remote_addr) or "").split(",")[0].strip()[:45] or None,
            )
            db.session.add(log)
            db.session.commit()
        except Exception:
            db.session.rollback()
            app.logger.exception("Unable to write automatic HMS audit event for %s %s", request.method, path)

        return response
