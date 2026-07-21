
This child execution table governs stock count requests, directing employees to go to a location and physically verify shelf counts for auditing.

## Table Schema

| Field Name          | Type   | Constraints                                                        | Description                                                                                    |
| :------------------ | :----- | :----------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `task_id`           | `UUID` | `PRIMARY KEY`, `REFERENCES tasks(task_id) ON DELETE CASCADE`       | Both Primary Key and Foreign Key. Enforces strict 1:1 relationship with parent task. [[Tasks]] |
| `location_id`       | `INT`  | `NOT NULL`, `REFERENCES locations(location_id) ON DELETE RESTRICT` | The specific shelf or bin to count.                                                            |
| `item_id`           | `INT`  | `NOT NULL`, `REFERENCES items(item_id) ON DELETE RESTRICT`         | The item the system expects to find. [[Items]]                                                 |
| `batch_number`      | `VARCHAR(50)` | `NULL`                                                      | If set, this count targets one specific batch rather than the whole item at this location.     |
| `lot_number`        | `VARCHAR(50)` | `NULL`                                                      | If set, this count targets one specific lot rather than the whole item at this location.       |
| `expected_quantity` | `INT`  | `NOT NULL`                                                         | The quantity the system thinks is there (blind count: hidden from operator UI).                |
| `counted_quantity`  | `INT`  | `NULLABLE`, `CHECK (counted_quantity >= 0)`                        | The physical number of items the employee actually scanned/counted.                            |

---

## 🧠 Architectural Rules & Notes

* **Granularity decision, made explicit:** `batch_number`/`lot_number` are nullable so this table supports both modes — leave them `NULL` to count "everything of this item at this location" (`expected_quantity` = sum across all batches present), or set them to audit one specific batch in isolation. Pick one convention per count *type* rather than mixing per-row, so reporting stays consistent.