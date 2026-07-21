
Breaks down the specific items and exact quantities expected within a parent Purchase Order.

| Column Name         | Data Type     | Constraints                 | Description                                                   |
| :------------------ | :------------ | :-------------------------- | :------------------------------------------------------------ |
| `po_line_id`        | INT / UUID    | PRIMARY KEY, AUTO_INCREMENT | Unique identifier for the individual line item.               |
| `po_id`             | INT           | NOT NULL, `REFERENCES purchase_orders(po_id) ON DELETE CASCADE` | Parent reference linking back to `purchase_orders`. Cascades — a line item cannot outlive its header. |
| `item_id`           | INT           | NOT NULL, `REFERENCES items(item_id) ON DELETE RESTRICT` | References the product master record (`items.item_id`). Restricted — an item with order history can't be deleted out from under it. |
| `quantity_ordered`  | INT           | NOT NULL, `CHECK (quantity_ordered > 0)` | The total count of items purchased from the supplier.         |
| `quantity_received` | INT           | DEFAULT 0, `CHECK (quantity_received >= 0)` | Running tally of stock physically scanned into the warehouse. |
| `batch_number`      | VARCHAR(50)   | NULL                        | Batch identifier, once known/confirmed on receipt (rarely known at PO creation time). |
| `lot_number`        | VARCHAR(50)   | NULL                        | Lot identifier, once known/confirmed on receipt.               |
| `expiry_date`       | DATE          | NULL                        | Expiry/best-before date, once known/confirmed on receipt.     |
| `unit_cost`         | DECIMAL(10,2) | NULL, `CHECK (unit_cost >= 0)` | Purchase price per unit for basic inventory valuation.        |

---

## 🧠 Architectural Rules & Notes

* **Why nullable here specifically:** A PO is usually cut before the supplier has assigned or communicated a batch/lot, so these start `NULL` and typically get filled in once known — either amended on the PO line directly, or left here as `NULL` and captured instead on [[Booking Tasks]] at actual receipt (which now has its own `batch_number`/`lot_number`/`expiry_date`). Populate whichever suits your workflow — pre-advised (ASN-style) receiving benefits from filling it in here ahead of time; ad-hoc receiving will rely on `Booking Tasks` capturing it live.
* **Quantity/cost `CHECK` constraints added:** Previously this table had no positivity checks at all, unlike [[Inventory]] and the Task tables which all enforce `quantity > 0`/`>= 0`. `quantity_received` is deliberately not capped at `<= quantity_ordered` — over-receipt happens in practice (supplier ships extra) and should be a business-rule warning, not a hard database rejection.
* **Explicit delete behavior:** `po_id` cascades so orphaned line items can't exist after a PO is removed; `item_id` is restricted so historical order lines always resolve to a real item record.
