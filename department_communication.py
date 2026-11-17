from datetime import datetime
from extensions import db

class DepartmentMessage(db.Model):
    __tablename__ = 'department_messages'
    id = db.Column(db.Integer, primary_key=True)
    # These fields preserve compatibility with the original internal-message
    # table that already exists in deployed HospitalSavvy databases.
    sender_user_id = db.Column(db.Integer, nullable=False)
    sender_department = db.Column(db.String(40), nullable=False, index=True)
    recipient_department = db.Column(db.String(40), nullable=False, index=True)
    sender_name = db.Column(db.String(160), nullable=False)
    subject = db.Column(db.String(255), nullable=False, default='Forwarding message')
    body = db.Column(db.Text, nullable=False, default='')
    message = db.Column(db.Text, nullable=False)
    is_read = db.Column(db.Boolean, nullable=False, default=False)
    forward_id = db.Column(db.String(36), nullable=True, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    def to_dict(self):
        return {'id':self.id,'sender_department':self.sender_department,'recipient_department':self.recipient_department,'sender_name':self.sender_name,'title':self.subject,'message':self.message or self.body,'forward_id':self.forward_id,'created_at':self.created_at.isoformat()+'Z'}

class DepartmentSharedDocument(db.Model):
    __tablename__ = 'department_shared_documents'
    id = db.Column(db.Integer, primary_key=True)
    sender_department = db.Column(db.String(40), nullable=False, index=True)
    recipient_department = db.Column(db.String(40), nullable=False, index=True)
    title = db.Column(db.String(240), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    stored_filename = db.Column(db.String(255), nullable=False, unique=True)
    mime_type = db.Column(db.String(160))
    uploaded_by = db.Column(db.String(160), nullable=False)
    forward_id = db.Column(db.String(36), nullable=True, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    def to_dict(self):
        return {'id':self.id,'sender_department':self.sender_department,'recipient_department':self.recipient_department,'title':self.title,'original_filename':self.original_filename,'mime_type':self.mime_type,'uploaded_by':self.uploaded_by,'forward_id':self.forward_id,'created_at':self.created_at.isoformat()+'Z','download_url':f'/api/department-communication/documents/{self.id}/download','view_url':f'/api/department-communication/documents/{self.id}/view'}


class AccountsDispensingDocument(db.Model):
    """Accounts-created document that can be attached to a forwarding item."""
    __tablename__ = 'accounts_dispensing_documents'

    id = db.Column(db.Integer, primary_key=True)
    reference = db.Column(db.String(80), nullable=False, unique=True, index=True)
    recipient = db.Column(db.String(200), nullable=False)
    amount = db.Column(db.Float, nullable=False, default=0)
    purpose = db.Column(db.Text, nullable=False)
    payment_method = db.Column(db.String(100), nullable=True)
    approved_by = db.Column(db.String(200), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.String(160), nullable=False)
    stored_filename = db.Column(db.String(255), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    def to_dict(self):
        return {
            'id': self.id, 'reference': self.reference, 'recipient': self.recipient,
            'amount': self.amount, 'purpose': self.purpose,
            'payment_method': self.payment_method, 'approved_by': self.approved_by,
            'notes': self.notes, 'created_by': self.created_by,
            'created_at': self.created_at.isoformat() + 'Z',
            'title': f'Dispensing voucher {self.reference}',
            'original_filename': f'{self.reference}.pdf',
            'download_url': f'/api/department-communication/accounts-dispensing/{self.id}/download',
        }
