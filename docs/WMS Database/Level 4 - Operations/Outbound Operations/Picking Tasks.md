
This child execution table contains physical variables relevant ONLY to retrieving inventory from the racks to fulfill outbound shipments.

## Table Schema

| Field Name         | Type          | Constraints                                                        | Description                                                                                       |
| :----------------- | :------------ | :----------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ |
| `task_id`          | `UUID`        | `PRIMARY KEY`, `REFERENCES tasks(task_id) ON DELETE CASCADE`       | Both Primary Key and Foreign Key. Enforces strict 1:1 relationship with the parent task.[[Tasks]] |
| `pick_location_id` | `INT`         | `NOT NULL`, `REFERENCES locations(location_id) ON DELETE RESTRICT` | The exact storage rack coordinate where the stock is located.                                     |
| `item_id`          | `INT`         | `NOT NULL`, `REFERENCES items(item_id) ON DELETE RESTRICT`         | The item being picked. [[Items]]                                                                   |
| `batch_number`     | `VARCHAR(50)` | `NULL`                                                             | Which specific batch to pick from, if this item is batch-tracked — required for FEFO allocation.   |
| `lot_number`       | `VARCHAR(50)` | `NULL`                                                             | Which specific lot to pick from, if this item is lot-tracked.                                      |
| `pick_quantity`    | `INT`         | `NOT NULL`, `CHECK (pick_quantity > 0)`                            | Quantity of items to extract from the storage location.                                           |
| `lpn_id`           | `VARCHAR(50)` | `NOT NULL`, `REFERENCES pallets(lpn_id) ON DELETE RESTRICT`        | The target box, bin, or shipping container. [[Pallets]]                                            |

---

## 🧠 Architectural Rules & Notes

* **`item_id` was previously missing:** This table had `pick_location_id` and `pick_quantity` but nothing actually saying *which item* — a real gap on its own, unrelated to batch tracking, that's fixed here.
* **Batch/lot ambiguity:** Once [[Inventory]] can hold multiple batches of the same item in the same location, `pick_location_id` alone doesn't tell the picker which one to take. `batch_number`/`lot_number` here should be set by the allocation engine at task-creation time (typically picking the soonest-expiring batch first — FEFO).