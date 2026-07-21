
This child execution table manages high-priority internal warehouse moves where bulk or reserve inventory is broken down to refill active picking shelves/bins running low.

## Table Schema

| Field Name                | Type   | Constraints                                                        | Description                                                                                    |
| :------------------------ | :----- | :----------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `task_id`                 | `UUID` | `PRIMARY KEY`, `REFERENCES tasks(task_id) ON DELETE CASCADE`       | Both Primary Key and Foreign Key. Enforces strict 1:1 relationship with parent task. [[Tasks]] |
| `item_id`                 | `INT`  | `NOT NULL`, `REFERENCES items(item_id) ON DELETE RESTRICT`         | The specific item being replenished. [[Items]]                                                 |
| `batch_number`            | `VARCHAR(50)` | `NULL`                                                      | Which specific batch to pull from bulk storage, if this item is batch-tracked — required for FEFO. |
| `lot_number`               | `VARCHAR(50)` | `NULL`                                                      | Which specific lot to pull from bulk storage, if this item is lot-tracked.                      |
| `source_location_id`      | `INT`  | `NOT NULL`, `REFERENCES locations(location_id) ON DELETE RESTRICT` | High-level reserve/bulk storage location where stock is pulled from.                           |
| `destination_location_id` | `INT`  | `NOT NULL`, `REFERENCES locations(location_id) ON DELETE RESTRICT` | The active picking face location being refilled.                                               |
| `quantity`                | `INT`  | `NOT NULL`, `CHECK (quantity > 0)`                                 | Number of individual items to move.                                                            |

---

## 🧠 Architectural Rules & Notes

* **FEFO applies here too:** Replenishment should pull the soonest-expiring batch from bulk storage first, not just any batch — otherwise older stock gets stranded in reserve while newer stock cycles through the pick face.