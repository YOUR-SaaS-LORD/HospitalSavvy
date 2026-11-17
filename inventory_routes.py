from datetime import date
from flask import Blueprint, request, jsonify

from extensions import db
from models.inventory import InventoryItem, InventoryBatch

inventory_bp = Blueprint(
    "inventory",
    __name__,
    url_prefix="/api/inventory"
)

# =========================================================
# GET ALL INVENTORY
# =========================================================

@inventory_bp.route("/", methods=["GET"])
def get_inventory():

    try:

        items = (
            InventoryItem.query
            .order_by(
                InventoryItem.category.asc(),
                InventoryItem.item_name.asc()
            )
            .all()
        )

        return jsonify({
            "success": True,
            "items": [
                {**item.to_dict(), "batches": [batch.to_dict() for batch in sorted(item.batches, key=lambda b: b.batch_number)]}
                for item in items
            ]
        }), 200

    except Exception as e:

        db.session.rollback()

        print(
            "INVENTORY LOAD ERROR:",
            str(e)
        )

        return jsonify({
            "success": False,
            "message": "Failed to load inventory.",
            "error": str(e)
        }), 500

# =========================================================
# ADD INVENTORY ITEM / ADD STOCK
#
# IMPORTANT STOCK RULE:
#
# TABLETS:
#     quantity       = FULL BOXES
#     strips_per_box = STRIPS IN ONE BOX
#     loose_strips   = STRIPS REMAINING FROM OPEN BOX
#
# Example:
#
#     quantity = 10
#     strips_per_box = 10
#
#     Means:
#     10 full boxes
#     100 total strips
#
# NOT:
#     quantity = 100
# =========================================================

@inventory_bp.route("/", methods=["POST"])
def add_inventory():

    try:

        data = request.get_json() or {}

        # =====================================================
        # BASIC DATA
        # =====================================================

        item_code = str(
            data.get("item_code", "")
        ).strip()

        item_name = str(
            data.get("item_name", "")
        ).strip()

        category = str(
            data.get("category", "")
        ).strip()

        drug_type = data.get("drug_type")

        if drug_type is not None:

            drug_type = str(
                drug_type
            ).strip()

        valuation_method = str(
            data.get(
                "valuation_method",
                ""
            )
        ).strip()

        supplier = str(
            data.get(
                "supplier",
                ""
            )
        ).strip()

        try:
            price_per_unit = float(data.get("price_per_unit", 0) or 0)
        except (TypeError, ValueError):
            return jsonify({"success": False, "message": "Drug price must be a valid number."}), 400
        if price_per_unit < 0:
            return jsonify({"success": False, "message": "Drug price cannot be negative."}), 400
        price_per_box_raw = data.get("price_per_box")
        try:
            price_per_box = float(price_per_box_raw) if price_per_box_raw not in (None, "") else None
        except (TypeError, ValueError):
            return jsonify({"success": False, "message": "Box cost must be a valid number."}), 400
        if price_per_box is not None and price_per_box < 0:
            return jsonify({"success": False, "message": "Box cost cannot be negative."}), 400

        expiry_raw = str(data.get("expiry_date") or "").strip()
        try:
            expiry_date = date.fromisoformat(expiry_raw) if expiry_raw else None
        except ValueError:
            return jsonify({"success": False, "message": "Expiry date must use YYYY-MM-DD format."}), 400

        # =====================================================
        # VALIDATE REQUIRED FIELDS
        # =====================================================

        if not item_code:

            return jsonify({
                "success": False,
                "message": "Item code is required."
            }), 400

        if not item_name:

            return jsonify({
                "success": False,
                "message": "Item name is required."
            }), 400

        if category not in [
            "Drug Stock",
            "Medical Supplies",
            "Equipment"
        ]:

            return jsonify({
                "success": False,
                "message": "Invalid inventory category."
            }), 400

        if not valuation_method:

            return jsonify({
                "success": False,
                "message": "Valuation method is required."
            }), 400

        # =====================================================
        # USER-ENTERED QUANTITY
        #
        # TABLETS:
        #     quantity = NUMBER OF BOXES
        #
        # OTHER ITEMS:
        #     quantity = ACTUAL STOCK UNITS
        # =====================================================

        try:

            entered_quantity = int(
                data.get(
                    "quantity",
                    0
                )
            )

        except (
            TypeError,
            ValueError
        ):

            return jsonify({
                "success": False,
                "message": "Quantity must be a valid number."
            }), 400

        if entered_quantity < 0:

            return jsonify({
                "success": False,
                "message": "Quantity cannot be negative."
            }), 400

        # =====================================================
        # REORDER LEVEL
        #
        # For tablets this is also treated as BOXES.
        # =====================================================

        try:

            reorder_level = int(
                data.get(
                    "reorder_level",
                    0
                )
            )

        except (
            TypeError,
            ValueError
        ):

            return jsonify({
                "success": False,
                "message":
                    "Reorder level must be a valid number."
            }), 400

        if reorder_level < 0:

            return jsonify({
                "success": False,
                "message":
                    "Reorder level cannot be negative."
            }), 400

        # =====================================================
        # TABLET VALIDATION
        # =====================================================

        strips_per_box = None

        is_tablet = (
            category == "Drug Stock"
            and drug_type
            and drug_type.lower() == "tablets"
        )

        if category == "Drug Stock":

            if not drug_type:

                return jsonify({
                    "success": False,
                    "message":
                        "Drug type is required for Drug Stock."
                }), 400

            if is_tablet:

                if price_per_box is None:
                    return jsonify({"success": False, "message": "Enter the cost for one complete box of tablets."}), 400

                try:

                    strips_per_box = int(
                        data.get(
                            "strips_per_box"
                        )
                    )

                except (
                    TypeError,
                    ValueError
                ):

                    return jsonify({
                        "success": False,
                        "message":
                            "Strips per box is required for tablets."
                    }), 400

                if strips_per_box <= 0:

                    return jsonify({
                        "success": False,
                        "message":
                            "Strips per box must be greater than zero."
                    }), 400

        # =====================================================
        # IMPORTANT:
        #
        # DO NOT CONVERT TABLET BOXES INTO STRIPS HERE.
        #
        # entered_quantity remains the number of boxes.
        #
        # Example:
        #
        # entered_quantity = 10
        # strips_per_box = 10
        #
        # DATABASE:
        #
        # quantity = 10
        # strips_per_box = 10
        # loose_strips = 0
        #
        # Total stock = 10 × 10 = 100 strips
        # =====================================================

        stock_quantity = entered_quantity

        # =====================================================
        # CHECK WHETHER ITEM ALREADY EXISTS
        # =====================================================

        existing_item = (
            InventoryItem.query
            .filter_by(
                item_code=item_code
            )
            .first()
        )

        # =====================================================
        # EXISTING ITEM
        # =====================================================

        if existing_item:

            # -------------------------------------------------
            # CATEGORY CONSISTENCY
            # -------------------------------------------------

            if (
                existing_item.category
                != category
            ):

                return jsonify({
                    "success": False,
                    "message":
                        "This item code already belongs to "
                        f"{existing_item.category}."
                }), 409

            # -------------------------------------------------
            # TABLET CONSISTENCY
            # -------------------------------------------------

            if is_tablet:

                if (
                    existing_item.drug_type
                    and existing_item.drug_type.lower()
                    != "tablets"
                ):

                    return jsonify({
                        "success": False,
                        "message":
                            "This item code already belongs "
                            "to a different drug type."
                    }), 409

                if (
                    existing_item.strips_per_box
                    and existing_item.strips_per_box
                    != strips_per_box
                ):

                    return jsonify({
                        "success": False,
                        "message":
                            "Strips per box does not match "
                            "the existing stock item."
                    }), 409

            # -------------------------------------------------
            # PRESERVE THE OLD STOCK AS ITS OWN BATCH, THEN ADD
            # THE NEW RECEIPT AS A SEPARATE BATCH.
            # -------------------------------------------------
            if not existing_item.batches and int(existing_item.quantity or 0) > 0:
                db.session.add(InventoryBatch(
                    item=existing_item, batch_number=1,
                    quantity_received=int(existing_item.quantity or 0),
                    quantity_remaining=int(existing_item.quantity or 0),
                    expiry_date=existing_item.expiry_date
                ))

            next_batch_number = max([b.batch_number for b in existing_item.batches] or [0]) + 1
            db.session.add(InventoryBatch(
                item=existing_item, batch_number=next_batch_number,
                quantity_received=stock_quantity, quantity_remaining=stock_quantity,
                expiry_date=expiry_date
            ))

            # -------------------------------------------------
            # ADD TO THE SINGLE CONSOLIDATED ITEM STOCK TOTAL.
            # -------------------------------------------------
            existing_item.quantity += stock_quantity

            # -------------------------------------------------
            # UPDATE ITEM INFORMATION
            # -------------------------------------------------

            existing_item.item_name = item_name

            existing_item.drug_type = drug_type

            existing_item.valuation_method = (
                valuation_method
            )

            existing_item.strips_per_box = (
                strips_per_box
            )

            existing_item.price_per_unit = price_per_unit
            existing_item.price_per_box = price_per_box if is_tablet else None

            existing_item.reorder_level = (
                reorder_level
            )

            if supplier:

                existing_item.supplier = supplier

            # Keep the item's legacy expiry field aligned to the earliest
            # batch expiry; individual expiry dates live on each batch.
            all_batch_expiries = [b.expiry_date for b in existing_item.batches if b.expiry_date]
            if expiry_date is not None:
                all_batch_expiries.append(expiry_date)
            existing_item.expiry_date = min(all_batch_expiries) if all_batch_expiries else None

            db.session.commit()

            return jsonify({

                "success": True,

                "message":
                    "Existing stock updated successfully.",

                "item":
                    existing_item.to_dict(),

                "action":
                    "stock_added"

            }), 200

        # =====================================================
        # CREATE NEW ITEM
        # =====================================================

        new_item = InventoryItem(

            item_code=item_code,

            item_name=item_name,

            category=category,

            drug_type=drug_type,

            valuation_method=valuation_method,

            strips_per_box=strips_per_box,

            price_per_unit=price_per_unit,

            price_per_box=price_per_box if is_tablet else None,

            quantity=stock_quantity,

            loose_strips=0,

            reorder_level=reorder_level,

            supplier=supplier,
            expiry_date=expiry_date

        )

        db.session.add(new_item)
        db.session.flush()
        db.session.add(InventoryBatch(
            item=new_item, batch_number=1,
            quantity_received=stock_quantity, quantity_remaining=stock_quantity,
            expiry_date=expiry_date
        ))

        db.session.commit()

        return jsonify({

            "success": True,

            "message":
                "New inventory item added successfully.",

            "item":
                new_item.to_dict(),

            "action":
                "new_item"

        }), 201

    except Exception as e:

        db.session.rollback()

        print(
            "INVENTORY SAVE ERROR:",
            str(e)
        )

        return jsonify({

            "success": False,

            "message":
                "Failed to save inventory item.",

            "error":
                str(e)

        }), 500
