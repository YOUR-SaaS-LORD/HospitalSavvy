"""SQLAlchemy models for the Procurement module."""
from datetime import date, datetime, timezone
from extensions import db

class ProcurementDocumentTemplate(db.Model):
    __tablename__ = "procurement_document_templates"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    template_type = db.Column(db.String(80), nullable=False, default="Business Document")
    content = db.Column(db.Text, nullable=False, default="")
    created_by = db.Column(db.String(120))
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    def to_dict(self):
        return {"id":self.id,"department":"procurement","title":self.title,"template_type":self.template_type,"content":self.content,"created_by":self.created_by,"created_at":self.created_at.isoformat() if self.created_at else None,"updated_at":self.updated_at.isoformat() if self.updated_at else None}

class ProcurementDocument(db.Model):
    __tablename__ = "procurement_documents"
    id = db.Column(db.Integer, primary_key=True)
    document_type = db.Column(db.String(80), nullable=False, default="SCANNED_DOCUMENT")
    document_type_display = db.Column(db.String(140), nullable=False, default="Scanned Document")
    document_number = db.Column(db.String(120))
    document_date = db.Column(db.Date, nullable=False, default=date.today, index=True)
    title = db.Column(db.String(250), nullable=False)
    party_name = db.Column(db.String(250))
    department = db.Column(db.String(160))
    status = db.Column(db.String(60))
    payload = db.Column(db.JSON, nullable=False, default=dict)
    is_scanned_document = db.Column(db.Boolean, nullable=False, default=False)
    scan_file_name = db.Column(db.String(255))
    scan_mime_type = db.Column(db.String(120))
    scan_data = db.Column(db.LargeBinary)
    scan_size = db.Column(db.Integer)
    created_by = db.Column(db.Integer)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)

    def to_dict(self):
        payload = self.payload if isinstance(self.payload, dict) else {}
        return {
            **payload,
            "id": self.id,
            "department": self.department or payload.get("department"),
            "title": self.title,
            "document_type": self.document_type,
            "document_type_display": self.document_type_display,
            "document_number": self.document_number or payload.get("document_number"),
            "document_date": self.document_date.isoformat() if self.document_date else None,
            "party_name": self.party_name or payload.get("party_name"),
            "status": self.status or payload.get("status"),
            "payload": payload,
            # Compatibility aliases used by the forwarding picker and older UI code.
            "content": payload,
            "original_filename": self.scan_file_name,
            "mime_type": self.scan_mime_type,
            "is_scanned_document": self.is_scanned_document,
            "scan_file_name": self.scan_file_name,
            "scan_mime_type": self.scan_mime_type,
            "scan_size": self.scan_size,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "file_url": f"/api/office/procurement/documents/{self.id}/file" if self.scan_data else None,
        }
