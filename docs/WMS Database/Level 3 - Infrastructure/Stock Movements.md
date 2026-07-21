The `stock_movements` table is an **immutable transaction log**. While the `inventory` table tells you what is in the warehouse *right now*, the `stock_movements` table tells you *how it got there*. Every single click of a barcode scanner (receipts, putaways, picks, adjustments) writes a permanent row here. **Rows in this table are NEVER updated or deleted.** 

## Table Schema

| Field Name | Type / Constraint | Description |
| :--- | :--- | :--- | 
| `movement_id` | `SERIAL PRIMARY KEY` | Unique log tracking sequence ID |
| `employee_id` | `INT REFERENCES employees(employee_id) ON DELETE RESTRICT` | The warehouse operator who physically made the move | 
| `item_id` | `INT REFERENCES items(item_id) ON DELETE RESTRICT` | FK pointing to the [[Items]] master record for the item that was moved — replaces the previous raw `sku` string |
| `batch_number` | `VARCHAR(50) NULL` | Batch identifier carried over from [[Inventory]], if this item is batch-tracked |
| `lot_number` | `VARCHAR(50) NULL` | Lot identifier carried over from [[Inventory]], if this item is lot-tracked |
| `expiry_date` | `DATE NULL` | Expiry date carried over from [[Inventory]] at the moment of the move, if applicable |
| `quantity` | `INT NOT NULL CHECK (quantity > 0)` | Number of items moved (always positive; direction is determined by zones) |
| `source_location_id` | `INT REFERENCES locations(location_id) ON DELETE RESTRICT` | Physical starting point (e.g., 'RECEIVING' zone) |
| `destination_location_id` | `INT REFERENCES locations(location_id) ON DELETE RESTRICT` | Physical destination point (e.g., 'BULK-01-02-3-1') | 
| `movement_type` | `VARCHAR(30) NOT NULL` | Activity type: 'RECEIVE', 'PUTAWAY', 'PICK', 'ADJUSTMENT', 'REPLENISH' |
| `reason_code` | `VARCHAR(50) NULL` | Audit details (e.g., 'DAMAGED_ON_RECEIPT', 'CYCLE_COUNT_DISCREPANCY') |
| `created_at` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | The precise second the physical move was confirmed |

---

## 🧠 Architectural Rules & Notes

* **`ON DELETE RESTRICT` made explicit on every FK:** This table is an immutable, append-only ledger — it must be structurally impossible for a deleted employee, item, or location to silently blank out or cascade-delete historical movement rows. Previously these FKs had no stated delete behavior; `RESTRICT` is now explicit on all four, matching the intent already stated in this table's own description ("rows are NEVER updated or deleted").
* **`quantity > 0` check added:** Matches the positivity checks already present on [[Inventory]] and the Task tables.
