
This child execution table controls the movement of newly received pallets from temporary Inbound Receiving/Dock staging areas to their permanent rack storage coordinates.

## Table Schema

| Field Name                   | Type          | Constraints                                                        | Description                                                                                    |
| :--------------------------- | :------------ | :----------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `task_id`                    | `UUID`        | `PRIMARY KEY`, `REFERENCES tasks(task_id) ON DELETE CASCADE`       | Both Primary Key and Foreign Key. Enforces strict 1:1 relationship with parent task. [[Tasks]] |
| `lpn_id`                     | `VARCHAR(50)` | `NOT NULL`, `REFERENCES pallets(lpn_id) ON DELETE RESTRICT`        | The specific pallet/bin being moved. [[Pallets]]                                                |
| `source_location_id`         | `INT`         | `NOT NULL`, `REFERENCES locations(location_id) ON DELETE RESTRICT` | Where the pallet currently sits (usually Inbound Staging).                                     |
| `suggested_dest_location_id` | `INT`         | `NOT NULL`, `REFERENCES locations(location_id) ON DELETE RESTRICT` | The system-calculated optimal rack location for this item.                                     |
| `actual_dest_location_id`    | `INT`         | `NULLABLE`, `REFERENCES locations(location_id) ON DELETE RESTRICT` | The final location where the worker scanned and dropped the pallet (operator override).        |

---

## 🧠 Architectural Rules & Notes

* **No `item_id`/`batch_number` here — by design, not by omission:** This warehouse's convention is one item + one batch/lot per LPN, so the worker moving a pallet doesn't need those columns duplicated on the task — the system resolves "what's on this pallet" by looking up `lpn_id` against the [[Inventory]] row already created for it at receiving. If this ever changes to allow mixed-content pallets, this table would need its own `item_id`/`batch_number`/`lot_number` columns the same way [[Picking Tasks]] does.