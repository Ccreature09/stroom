
The `employees` table handles authentication, role assignments, and physical tracking of the workforce across the organization.

## Table Schema

| Field Name             | Type / Constraint                                                          | Description                                                                                                                           |
| :--------------------- | :------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `employee_id`          | `SERIAL PRIMARY KEY`                                                       | Unique internal identifier for the worker                                                                                             |
| `organization_id`      | `INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE` | Connects worker to their tenant company                                                                                               |
| `auth_user_id`         | `UUID UNIQUE NULL REFERENCES auth.users(id) ON DELETE SET NULL`            | Links the employee to a Supabase authentication account. `NULL` indicates the employee has no login account                           |
| `work_email`           | `VARCHAR(150) NOT NULL UNIQUE`                                             | Employee's work email address. Used for invitations, communication, reporting and business operations.                                |
| `first_name`           | `VARCHAR(50)`                                                              |                                                                                                                                       |
| `middle_name`          | `VARCHAR(50) NULL`                                                         | Optional                                                                                                                              |
| `last_name`            | `VARCHAR(50)`                                                              |                                                                                                                                       |
| `profile_picture_url`  | `VARCHAR(255) NULL`                                                        | Optional path to CDN storage                                                                                                          |
| `position_id`          | `INT FOREIGN KEY REFERENCES Position_Types ON DELETE SET NULL`             | Assigns user permissions (e.g., Admin, Driver)                                                                                        |
| `primary_warehouse_id` | `INT FOREIGN KEY REFERENCES Warehouses ON DELETE SET NULL`                 | The employee's designated home base                                                                                                   |
| `current_warehouse_id` | `INT FOREIGN KEY REFERENCES Warehouses ON DELETE SET NULL`                 | Where they are actively logged in on a terminal                                                                                       |
| `is_active`            | `BOOLEAN DEFAULT TRUE`                                                     | Set `FALSE` on termination instead of deleting — preserves FK history on [[Stock Movements]], [[Tasks]], [[Time Clock Entries]], etc. |
| `hire_date`            | `DATE NULL`                                                                | Date the worker started                                                                                                               |
| `termination_date`     | `DATE NULL`                                                                | Date the worker left, if applicable                                                                                                   |
| `last_login_at`        | `TIMESTAMP NULL`                                                           | Last successful login to the WMS. Updated after successful authentication.                                                            |
| `created_at`           | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`                                      | Record creation timestamp                                                                                                             |

---

##  Employee Licenses (Many-to-Many Bridge Table)
Because an employee can hold multiple operating licenses (e.g., EPT, Reach truck, Forklift), we do not store licenses on the main `employees` table. Instead, we use this bridge table:

- Table: [[Employee Licenses]]

---

## Employee Departments (Many-to-Many Bridge Table)
An employee can belong to one or more [[Departments]] (e.g., cross-trained on Receiving and Picking). This is tracked in a dedicated bridge table rather than a single column on `employees`:

- Table: [[Employee Departments]]

---

## Time Clock Entries (Attendance Ledger)
Clocking in/out is tracked as its own append-only ledger rather than a status flag on `employees`, so a full attendance history is preserved:

- Table: [[Time Clock Entries]]


---

## [[Position Types]]



## 🧠 Architectural Rules & Notes

* **Current vs. Primary Warehouse:** When an employee clocks in via their handheld terminal, the app should update `current_warehouse_id`. This restricts their item searches and stock movements to the physical building they are actually standing in.
* **On Delete Constraints:** If a physical warehouse is deleted from the system, both warehouse tracking fields will safely cascade to `NULL` (`ON DELETE SET NULL`) so the employee accounts are not deleted.
* **Deactivate, don't delete:** Use `is_active = FALSE` for terminated employees. Hard-deleting an employee row would either cascade-delete or null out their history on [[Stock Movements]], [[Tasks]], [[Time Clock Entries]], and [[Employee Licenses]] — losing audit trail for no benefit.
* **Tenant-safe warehouse assignment (composite FK):** A plain FK on `primary_warehouse_id`/`current_warehouse_id` only guarantees the warehouse *exists* — it doesn't stop an employee at Org A from being pointed at a warehouse owned by Org B. Since `warehouses` now carries `UNIQUE (organization_id, warehouse_id)`, replace the simple FKs with composite ones:
  ```sql
  ALTER TABLE employees
    ADD CONSTRAINT fk_employees_primary_wh
      FOREIGN KEY (organization_id, primary_warehouse_id)
      REFERENCES warehouses (organization_id, warehouse_id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_employees_current_wh
      FOREIGN KEY (organization_id, current_warehouse_id)
      REFERENCES warehouses (organization_id, warehouse_id) ON DELETE SET NULL;
  ```
  This makes cross-tenant assignment a constraint violation instead of a silent data bug. See *"Multi-Tenant Integrity"* in [[Database structure]].
