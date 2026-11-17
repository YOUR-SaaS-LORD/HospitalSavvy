"""Shared authentication, validation and upload helpers for office routes."""
import os
from datetime import date
from functools import wraps
from flask import current_app, jsonify, request, session

ALLOWED_EXTENSIONS={".pdf",".png",".jpg",".jpeg",".webp",".tif",".tiff",".doc",".docx",".xls",".xlsx",".odt",".ods",".txt",".rtf"}
MAX_UPLOAD_BYTES=20*1024*1024

def canonical_role(value):
    role=" ".join(str(value or "").strip().lower().replace("_"," ").replace("-"," ").split())
    aliases={"admin":"system_admin","administrator":"system_admin","admin user":"system_admin","system administrator":"system_admin","system admin":"system_admin","hospital administrator":"hospital_manager","hospital admin":"hospital_manager","secretariate":"secretary","secretariat":"secretary","secretary officer":"secretary","procurement":"procurement_officer","purchasing officer":"procurement_officer","guidance and counseling":"guidance_counselor","guidance counselor":"guidance_counselor","counsellor":"counselor"}
    return aliases.get(role,role.replace(" ","_"))
def session_user():
    try:
        from flask_login import current_user
        if getattr(current_user,"is_authenticated",False): return {"id":getattr(current_user,"id",None),"username":getattr(current_user,"username",None) or getattr(current_user,"email",None),"role":getattr(current_user,"role",None)}
    except Exception: pass
    user=session.get("user")
    if isinstance(user,dict): return {"id":user.get("id") or user.get("user_id"),"username":user.get("username") or user.get("email") or user.get("name"),"role":user.get("role") or user.get("user_role")}
    return {"id":session.get("user_id") or session.get("id"),"username":session.get("username") or session.get("email"),"role":session.get("role") or session.get("user_role")}

def authenticated_user():
    """Return the active database user and validated session role, if any."""
    identity = session_user()
    user_id = identity.get("id")
    if user_id is None:
        return None, None
    try:
        from extensions import db
        from models.user import User

        user = db.session.get(User, user_id)
    except Exception:
        current_app.logger.exception("Unable to validate the authenticated user")
        return None, None
    if not user or not user.is_active:
        session.clear()
        return None, None

    database_role = canonical_role(user.role)
    session_role = canonical_role(identity.get("role"))
    role_matches = session_role == database_role
    if not role_matches:
        session.clear()
        return None, None
    return user, session_role

def require_roles(roles):
    allowed={canonical_role(r) for r in roles}
    def decorate(fn):
        @wraps(fn)
        def wrapped(*args,**kwargs):
            db_user, role = authenticated_user()
            user=session_user()
            if not db_user or not role: return jsonify(success=False,error="Authentication required."),401
            if role not in allowed and role != "system_admin": return jsonify(success=False,error="You are not authorized to access this module."),403
            request.office_user=user; request.office_role=role
            return fn(*args,**kwargs)
        return wrapped
    return decorate
def actor():
    u=getattr(request,"office_user",{}) or {}; return str(u.get("username") or u.get("id") or "unknown")
def json_body():
    data=request.get_json(silent=True)
    if not isinstance(data,dict): raise ValueError("A JSON object is required.")
    return data
def json_error(message,status=400): return jsonify(success=False,error=message),status
def parse_date(value,optional=False):
    if not value: return None if optional else date.today()
    try: return date.fromisoformat(str(value))
    except (TypeError,ValueError): raise ValueError("Dates must use YYYY-MM-DD format.")
def upload_folder():
    folder=current_app.config.get("HMS_OFFICE_UPLOAD_FOLDER") or os.path.join(current_app.instance_path,"hms_office_uploads")
    os.makedirs(folder,exist_ok=True); return os.path.abspath(folder)
def require_department(role,department):
    role=canonical_role(role)
    if role in {"system_admin","hospital_manager"}: return True
    return (department=="secretariate" and role=="secretary") or (department=="procurement" and role=="procurement_officer")
