
This child execution table tracks the final operational step—loading staged outbound containers, boxes, or pallets onto a trailer for active shipment.

## Table Schema

| Field Name        | Type          | Constraints                                                  | Description                                                                                   |
| :---------------- | :------------ | :----------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| `task_id`         | `UUID`        | `PRIMARY KEY`, `REFERENCES tasks(task_id) ON DELETE CASCADE` | Both Primary Key and Foreign Key. Enforces strict 1:1 relationship with parent task.[[Tasks]] |
| `dock_door_location_id` | `INT` | `NOT NULL`, `REFERENCES locations(location_id) ON DELETE RESTRICT` | The shipping dock door where the transport trailer is docked — now a real [[Locations]] row instead of a free-text string. |
| `lpn_id`          | `VARCHAR(50)` | `NOT NULL`, `REFERENCES pallets(lpn_id) ON DELETE RESTRICT`  | The pallet or container being loaded. [[Pallets]]                                              |
| `shipment_id`     | `UUID`        | `NOT NULL`, `REFERENCES shipments(shipment_id) ON DELETE RESTRICT` | The master outbound shipment order associated with this cargo. [[Shipments]]             |
| `sequence_number` | `INT`         | `NOT NULL`, `DEFAULT 1`                                      | Loading order (e.g., if pallets must be loaded in reverse-drop sequence).                     |

---

## 🧠 Architectural Rules & Notes

* **`dock_door_id` replaced with `dock_door_location_id`:** Previously a raw `VARCHAR(10)` with no validation against a real dock door. Now points at a [[Locations]] row, consistent with the same fix applied to [[Booking Tasks]] and [[Unloading Tasks]].