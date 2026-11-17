"""Database model for Guidance & Counseling records."""
from datetime import date, datetime
from extensions import db

class CounselingRecord(db.Model):
    __tablename__ = "hms_counseling_records"
    id = db.Column(db.Integer, primary_key=True)
    client_reference = db.Column(db.String(100), nullable=False, index=True)
    client_name = db.Column(db.String(200), nullable=False)
    record_type = db.Column(db.String(80), nullable=False, default="Intake", index=True)
    record_date = db.Column(db.Date, nullable=False, default=date.today, index=True)
    follow_up_date = db.Column(db.Date, index=True)
    referral_destination = db.Column(db.String(200))
    notes = db.Column(db.Text, nullable=False, default="")
    outcome = db.Column(db.Text, nullable=False, default="")
    created_by = db.Column(db.String(120))
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    def to_dict(self):
        return {"id":self.id,"client_reference":self.client_reference,"client_name":self.client_name,"record_type":self.record_type,"record_date":self.record_date.isoformat() if self.record_date else None,"follow_up_date":self.follow_up_date.isoformat() if self.follow_up_date else None,"referral_destination":self.referral_destination,"notes":self.notes,"outcome":self.outcome,"created_by":self.created_by,"created_at":self.created_at.isoformat() if self.created_at else None,"updated_at":self.updated_at.isoformat() if self.updated_at else None}
