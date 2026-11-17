"""SQLAlchemy models for the Secretariate module."""

from datetime import date, datetime

from extensions import db

class SecretariateDocumentTemplate(db.Model):
    __tablename__ = "secretariate_document_templates"

    id = db.Column(db.Integer, primary_key=True)

    title = db.Column(
        db.String(200),
        nullable=False
    )

    template_type = db.Column(
        db.String(80),
        nullable=False,
        default="Letter"
    )

    content = db.Column(
        db.Text,
        nullable=False,
        default=""
    )

    # PostgreSQL secretariate_documents.created_by is an integer user ID.
    created_by = db.Column(
        db.Integer
    )

    created_at = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.utcnow,
        index=True
    )

    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )

    def to_dict(self):
        return {
            "id": self.id,
            "department": "secretariate",
            "title": self.title,
            "template_type": self.template_type,
            "content": self.content,
            "created_by": self.created_by,
            "created_at": (
                self.created_at.isoformat()
                if self.created_at else None
            ),
            "updated_at": (
                self.updated_at.isoformat()
                if self.updated_at else None
            )
        }

class SecretariateDocument(db.Model):
    __tablename__ = "secretariate_documents"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    title = db.Column(
        db.String(240),
        nullable=False
    )

    document_type = db.Column(
        db.String(100),
        nullable=False,
        default="Document"
    )

    # Required by the existing PostgreSQL schema; human-readable document type.
    document_type_display = db.Column(
        db.String(120),
        nullable=False,
        default="Document"
    )

    # IMPORTANT:
    # The existing PostgreSQL column is JSON, not TEXT.
    # Store Python dictionaries/lists here, not serialized JSON strings.
    content = db.Column(
        db.JSON,
        nullable=False,
        default=dict
    )

    original_filename = db.Column(
        db.String(255)
    )

    stored_filename = db.Column(
        db.String(255),
        unique=True
    )

    mime_type = db.Column(
        db.String(160)
    )

    document_date = db.Column(
        db.Date,
        nullable=False,
        default=date.today,
        index=True
    )

    created_by = db.Column(
        db.Integer,
        nullable=True
    )

    created_at = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.utcnow,
        index=True
    )

    def to_dict(self):
        return {
            "id": self.id,
            "department": "secretariate",
            "title": self.title,
            "document_type": self.document_type,
            "document_type_display": self.document_type_display,
            "content": self.content,
            "original_filename": self.original_filename,
            "mime_type": self.mime_type,
            "document_date": (
                self.document_date.isoformat()
                if self.document_date else None
            ),
            "created_by": self.created_by,
            "created_at": (
                self.created_at.isoformat()
                if self.created_at else None
            ),
            "file_url": (
                f"/api/office/secretariate/documents/{self.id}/file"
                if self.stored_filename else None
            )
        }