
The `time_clock_entries` table is an append-style attendance ledger recording when an employee clocks in and out of a shift. Unlike `current_warehouse_id` on [[Employees]] (which tracks where someone is *right now*), this table is the permanent, auditable record of *when* they were on the clock at all.

## Table Schema

| Field Name | Type / Constraint | Description |
| :--- | :--- | :--- |
| `time_clock_id` | `SERIAL PRIMARY KEY` | Unique identifier for this attendance record |
| `employee_id` | `INT REFERENCES employees(employee_id) ON DELETE CASCADE` | The worker this record belongs to |
| `warehouse_id` | `INT REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT` | The physical site where the clock action occurred |
| `clock_in_at` | `TIMESTAMP NOT NULL` | Timestamp the employee started their shift |
| `clock_out_at` | `TIMESTAMP NULL` | Timestamp the employee ended their shift (`NULL` while still clocked in) |
| `break_minutes` | `INT DEFAULT 0` | Total unpaid break time taken during this shift, in minutes |
| `source` | `VARCHAR(20) DEFAULT 'TERMINAL'` | How the entry was captured: `TERMINAL`, `MANUAL_ADMIN`, `BADGE_SCAN` |
| `edited_by_employee_id` | `INT NULL REFERENCES employees(employee_id) ON DELETE SET NULL` | If a supervisor manually corrected this entry, who did it |

---

## 🧠 Architectural Rules & Notes

* **One open row per employee:** The application layer should enforce that an employee cannot have a second row with `clock_out_at IS NULL` while one already exists — that's the definition of "already clocked in."
* **Don't silently overwrite corrections:** If a supervisor edits a clock time, keep `edited_by_employee_id` set as a flag. If disputes/compliance matter to you, consider a separate `time_clock_entry_edits` audit table rather than mutating history in place.
* **Feeds labor reporting:** Cross-referencing this table against `started_at`/`completed_at` on [[Tasks]] is what lets you compute idle time vs. productive time per shift — that link is why this belongs in Operations rather than just being a flag on `Employees`.
