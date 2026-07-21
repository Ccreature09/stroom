# Table Spec: tasks

The `tasks` table acts as a unified state engine tracking who is doing a task, its priority, its current progress, and what machinery is required. It contains only fields shared by every type of warehouse work.

## Table Schema

| Field Name             | Type        | Constraints                                                          | Description                                                                |
| :--------------------- | :---------- | :------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| `task_id`              | `UUID`      | `PRIMARY KEY`, `DEFAULT gen_random_uuid()`                           | Unique identifier for this abstract unit of work.                          |
| `warehouse_id`         | `INT`       | `NOT NULL`, `REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT` | Denormalized from the task's location/department chain so tasks can be filtered per-warehouse without joining through every child table. See notes below. |
| `task_type_id`         | `INT`       | `NOT NULL`, `REFERENCES task_types(task_type_id) ON DELETE RESTRICT` | FK pointing to lookup table (e.g., 1 for Booking, 2 for Picking).          |
| `status_id`            | `INT`       | `NOT NULL`, `REFERENCES task_statuses(status_id) ON DELETE RESTRICT` | FK pointing to lookup table (e.g., 1 for Pending, 2 for Active).           |
| `priority`             | `INT`       | `NOT NULL`, `DEFAULT 100`                                            | Urgency routing weight (lower numbers processed first).                    |
| `assigned_employee_id` | `INT`       | `NULLABLE`, `REFERENCES employees(employee_id) ON DELETE SET NULL`   | The worker executing this task (NULL if currently in the unassigned pool). |
| `mhe_type_required`    | `INT`       | `NULLABLE`, `REFERENCES mhe_types(mhe_type_id) ON DELETE RESTRICT`   | Machine license class required for execution (NULL if hand-work).          |
| `created_at`           | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP`                                          | Timestamp recording when the task was generated.                           |
| `started_at`           | `TIMESTAMP` | `NULLABLE`                                                           | Timestamp when the task status changed to 'ACTIVE'.                        |
| `completed_at`         | `TIMESTAMP` | `NULLABLE`                                                           | Timestamp when the task status changed to 'COMPLETED'.                     |

---

## 🧠 Architectural Rules & Notes

* **Why `warehouse_id` was added:** `tasks` previously had no direct link to a warehouse — filtering "show me all pending tasks for warehouse X" required joining out to whichever child table (Booking, Picking, Putaway, etc.) happened to hold a `location_id`, and [[Task Eligible Departments]] → [[Departments]] for tasks not yet claimed. That's both a performance cost (extra joins on every dashboard query) and a multi-tenant safety gap (nothing stopped a task from routing to a department in a different warehouse than the one implied by its actual work location). The application must set `warehouse_id` at task creation time from the task's location/department, and it should match the eventual `assigned_employee_id`'s `current_warehouse_id` — enforce that match with a trigger if strict physical-presence routing is required, since employees can move between warehouses (a hard FK would be too rigid here).
* **Composite FK opportunity:** If further tenant hardening is needed, add `organization_id` here too and use a composite FK against `warehouses(organization_id, warehouse_id)`, matching the pattern in [[Sales Orders]]/[[Purchase Orders]]. Left as optional since `warehouse_id` alone already closes the main gap.