from datetime import datetime

from extensions import db

class InventoryItem(db.Model):

    __tablename__ = "inventory_items"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    # =========================================================
    # ITEM IDENTIFICATION
    # =========================================================
    
    item_code = db.Column(
        db.String(100),
        unique=True,
        nullable=False,
        index=True
    )

    item_name = db.Column(
        db.String(255),
        nullable=False
    )

    # =========================================================
    # CLASSIFICATION
    # =========================================================

    category = db.Column(
        db.String(50),
        nullable=False
    )

    # Used only for Drug Stock
    drug_type = db.Column(
        db.String(50),
        nullable=True
    )

    # =========================================================
    # VALUATION
    # =========================================================

    valuation_method = db.Column(
        db.String(100),
        nullable=False
    )

    # Number of strips contained in one box.
    # Used for tablet stock.
    strips_per_box = db.Column(
        db.Integer,
        nullable=True
    )

    # Price charged per dispensing unit: strip for tablets, bottle for syrup, tube for cream.
    price_per_unit = db.Column(db.Float, nullable=False, default=0.0)
    # Tablets may be sold as strips or full boxes at different saved costs.
    # NULL indicates a legacy item that predates separate box pricing.
    price_per_box = db.Column(db.Float, nullable=True)

    # =========================================================
    # STOCK
    # =========================================================
    #
    # IMPORTANT:
    #
    # For TABLETS:
    #     quantity is stored as full boxes and loose_strips stores
    #     strips taken from opened boxes. reorder_level is in boxes.
    #
    # Example:
    #     User enters 10 boxes
    #     Strips per box = 10
    #
    #     Database quantity = 10 boxes, loose_strips = 0.
    #     Available stock = 100 strips.
    #
    # For other inventory:
    #     quantity remains the quantity entered.
    #
    # =========================================================

    quantity = db.Column(
        db.Integer,
        nullable=False,
        default=0
    )

    reorder_level = db.Column(
        db.Integer,
        nullable=False,
        default=0
    )
    
    loose_strips = db.Column(
    db.Integer,
    nullable=False,
    default=0
    )
    
    supplier = db.Column(
        db.String(255),
        nullable=True
    )

    expiry_date = db.Column(db.Date, nullable=True, index=True)

    # =========================================================
    # DATES
    # =========================================================

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False
    )

    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # =========================================================
    # SERIALIZATION
    # =========================================================

    def to_dict(self):

        return {
            "id": self.id,

            "item_code":
                self.item_code,

            "item_name":
                self.item_name,

            "category":
                self.category,

            "drug_type":
                self.drug_type,

            "valuation_method":
                self.valuation_method,

            "strips_per_box":
                self.strips_per_box,

            "price_per_unit":
                float(self.price_per_unit or 0),

            "price_per_box":
                float(self.price_per_box) if self.price_per_box is not None else None,

            "quantity":
                self.quantity,

            "loose_strips":
                self.loose_strips,

            "reorder_level":
                self.reorder_level,

            "supplier":
                self.supplier,

            "expiry_date":
                self.expiry_date.isoformat() if self.expiry_date else None,

            "created_at":
                self.created_at.isoformat()
                if self.created_at
                else None,

            "updated_at":
                self.updated_at.isoformat()
                if self.updated_at
                else None
        }



class InventoryBatch(db.Model):
    """A separately traceable receipt of stock for an inventory item."""
    __tablename__ = "inventory_batches"

    id = db.Column(db.Integer, primary_key=True)
    inventory_item_id = db.Column(db.Integer, db.ForeignKey("inventory_items.id"), nullable=False, index=True)
    batch_number = db.Column(db.Integer, nullable=False)
    quantity_received = db.Column(db.Integer, nullable=False, default=0)
    quantity_remaining = db.Column(db.Integer, nullable=False, default=0)
    expiry_date = db.Column(db.Date, nullable=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    item = db.relationship("InventoryItem", backref=db.backref("batches", lazy="select", cascade="all, delete-orphan"))

    def to_dict(self):
        return {
            "id": self.id,
            "batch_number": self.batch_number,
            "quantity_received": self.quantity_received,
            "quantity_remaining": self.quantity_remaining,
            "expiry_date": self.expiry_date.isoformat() if self.expiry_date else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
