
The `sales_order_lines` table stores the specific item breakdowns, ordered quantities, and fulfillment progress for each parent sales order.

## 1. Schema Definition

| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `so_line_id` | INT / UUID | PRIMARY KEY, AUTO_INCREMENT | Unique line item reference. |
| `so_id` | INT | NOT NULL, `REFERENCES sales_orders(so_id) ON DELETE CASCADE` | Parent reference linking back to `sales_orders.so_id`. Cascades — a line item cannot outlive its header. |
| `item_id` | INT | NOT NULL, `REFERENCES items(item_id) ON DELETE RESTRICT` | References the product master record (`items.item_id`). Restricted — an item with order history can't be deleted out from under it. |
| `quantity_requested`| INT | NOT NULL, `CHECK (quantity_requested > 0)` | Total amount ordered by the customer. |
| `batch_number`      | VARCHAR(50) | NULL | Set if the customer requested a specific batch, or once allocation has assigned one. |
| `lot_number`        | VARCHAR(50) | NULL | Set if the customer requested a specific lot, or once allocation has assigned one. |
| `expiry_date`       | DATE | NULL | The expiry date of the batch/lot actually allocated to this line, once assigned. |
| `quantity_allocated`| INT | DEFAULT 0, `CHECK (quantity_allocated >= 0)` | Quantity successfully locked in physical warehouse locations to reserve stock. |
| `quantity_shipped`  | INT | DEFAULT 0, `CHECK (quantity_shipped >= 0 AND quantity_shipped <= quantity_allocated)` | Real count of items loaded into the carrier transport vehicle. Can never exceed what was actually allocated. |

---

## 🧠 Architectural Rules & Notes

* **Two different reasons these are nullable:** Most orders leave `batch_number`/`lot_number` `NULL` at creation — the item is requested, not a specific batch — and the allocation engine fills them in once it decides which batch fulfills the line (matching what ends up on the corresponding [[Picking Tasks]] row, for FEFO). The exception is a customer who explicitly demands a specific batch/lot up front (common in pharma/food B2B); in that case these are set at order entry and constrain what allocation is allowed to pick.
* **Quantity `CHECK` constraints added:** Previously no positivity/consistency checks existed on this table. `quantity_shipped <= quantity_allocated` prevents a data-entry or integration bug from recording more shipped than was ever reserved — genuine over-shipment should never happen since picking is bounded by allocation.
* **Explicit delete behavior:** `so_id` cascades so orphaned line items can't exist after an SO is removed; `item_id` is restricted so historical order lines always resolve to a real item record.
