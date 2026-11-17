from extensions import db
from datetime import datetime


class Staff(db.Model):
    __tablename__ = "staff"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    staff_number = db.Column(
        db.String(30),
        unique=True,
        nullable=False
    )

    full_name = db.Column(
        db.String(200),
        nullable=False
    )

    department_id = db.Column(
        db.Integer,
        db.ForeignKey("departments.id"),
        nullable=True,
        index=True
    )

    role = db.Column(
        db.String(100),
        nullable=False
    )

    status = db.Column(
        db.String(50),
        default="OFF DUTY",
        nullable=False
    )

    phone = db.Column(
        db.String(50),
        nullable=True
    )

    email = db.Column(
        db.String(150),
        nullable=True
    )

    # Authentication belongs to User.
    # Stores the department selected for the current on-duty session.
    # Administrators no longer assign a permanent staff department.
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        unique=True,
        nullable=True,
        index=True
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow
    )

    user = db.relationship(
        "User",
        back_populates="staff"
    )

    department = db.relationship(
        "Department",
        backref=db.backref("staff_members", lazy=True)
    )

    def to_dict(self):
        return {
            "id": self.id,
            "staff_id": self.staff_number,
            "full_name": self.full_name,
            "department_id": self.department_id,
            "department": (
                self.department.name
                if self.department
                else None
            ),
            "role": self.role,
            "status": self.status,
            "phone": self.phone,
            "email": self.email,
            "user_id": self.user_id,
            "username": (
                self.user.username
                if self.user
                else None
            ),
            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            )
        }
