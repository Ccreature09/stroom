
This child execution table contains physical variables relevant ONLY to cargo reception, product auditing, and trailer offloading expectations.

## Table Schema

| Field Name         | Type          | Constraints                                                  | Description                                                                                   |
| :----------------- | :------------ | :----------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| `task_id`          | `UUID`        | `PRIMARY KEY`, `REFERENCES tasks(task_id) ON DELETE CASCADE` | Both Primary Key and Foreign Key. Enforces strict 1:1 relationship with parent task.[[Tasks]] |
| `dock_door_location_id` | `INT` | `NOT NULL`, `REFERENCES locations(location_id) ON DELETE RESTRICT` | The physical dock entrance designated for cargo offloading — now a real [[Locations]] row instead of a free-text string. |
| `pallet_height_cm` | `INT`         | `NOT NULL`                                                   | The physical height of the arriving pallet for vertical clearance routing.                    |
| `item_id`          | `INT`         | `NOT NULL`, `REFERENCES items(item_id) ON DELETE RESTRICT`   | The item being received on this booking line. [[Items]]                                       |
| `product_type`     | `VARCHAR(50)` | `NOT NULL`                                                   | General category classification of incoming goods.                                            |
| `product_quantity` | `INT`         | `NOT NULL`, `CHECK (product_quantity > 0)`                   | Total number of physical boxes or items expected.                                             |
| `batch_number`     | `VARCHAR(50)` | `NULL`                                                       | Batch identifier as declared on the supplier's paperwork, if this item is batch-tracked.       |
| `lot_number`       | `VARCHAR(50)` | `NULL`                                                       | Lot identifier as declared on the supplier's paperwork, if this item is lot-tracked.            |
| `expiry_date`      | `DATE`        | `NULL`                                                       | Expiry/best-before date as declared on the supplier's paperwork, if this item has an expiry.    |

---

## 🧠 Architectural Rules & Notes

* **`item_id` was previously missing:** This table only had a free-text `product_type` category with no link to a real [[Items]] record, which meant batch/lot/expiry would have had nowhere solid to attach to. It's now a required field.
* **Point of origin for traceability:** Batch/lot/expiry should be captured *here*, at receiving, then carried forward through [[Putaway Tasks]] into the corresponding [[Inventory]] row — not re-typed later.
* **`dock_door_number` replaced with `dock_door_location_id`:** Previously a raw `VARCHAR(10)`, with no validation that the string corresponded to a real dock door. [[Locations]] already models dock doors as rows (e.g. `location_code = 'DOCK-01'`), so this now points there directly — consistent with how [[Pallets]], [[Carriers]], [[Customers]], and [[Suppliers]] all replaced free text with real FKs.