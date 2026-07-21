
This child execution table tracks physical parameters when physically pulling transport pallets off an incoming trailer at the dock door.

## Table Schema

| Field Name         | Type          | Constraints                                                  | Description                                                                                        |
| :----------------- | :------------ | :----------------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| `task_id`          | `UUID`        | `PRIMARY KEY`, `REFERENCES tasks(task_id) ON DELETE CASCADE` | Both Primary Key and Foreign Key. Enforces strict 1:1 relationship with the parent task. [[Tasks]] |
| `dock_door_location_id` | `INT` | `NOT NULL`, `REFERENCES locations(location_id) ON DELETE RESTRICT` | The designated dock door where the trailer is parked — now a real [[Locations]] row instead of a free-text string. |
| `trailer_number`   | `VARCHAR(30)` | `NULLABLE`                                                   | The physical license plate or fleet number of the trailer.                                         |
| `expected_pallets` | `INT`         | `NOT NULL`, `CHECK (expected_pallets > 0)`                   | Total number of physical pallets expected to be unloaded.                                          |
| `carrier_id`       | `INT`         | `NULLABLE`, `REFERENCES carriers(carrier_id) ON DELETE SET NULL` | The freight carrier bringing this trailer. [[Carriers]]                                            |

---

## 🧠 Architectural Rules & Notes

* **`dock_door_id` replaced with `dock_door_location_id`:** Previously a raw `VARCHAR(10)` with no validation against a real dock door. Now points at a [[Locations]] row, consistent with the same fix applied to [[Booking Tasks]] and [[Loading Tasks]].