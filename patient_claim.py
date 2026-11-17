from datetime import datetime

from extensions import db


class PatientClaim(db.Model):
    """Short lease preventing two staff accounts from handling one patient."""

    # A patient may be handled independently in different department workspaces,
    # but only one staff account can hold that patient within a given workspace.
    __tablename__ = "patient_module_claims"

    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(
        db.Integer,
        db.ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    module = db.Column(db.String(50), nullable=False)
    claimed_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False, index=True)

    __table_args__ = (
        db.UniqueConstraint("module", "patient_id", name="uq_patient_module_claim"),
    )
