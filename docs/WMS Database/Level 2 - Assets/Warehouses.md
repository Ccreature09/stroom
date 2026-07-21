
The `warehouses` table represents the physical fulfillment hubs owned by an [[Organizations|Organization]] (Tenant).

## Table Schema

| Field Name        | Type / Constraint                              | Description                                                   |
| :---------------- | :--------------------------------------------- | :------------------------------------------------------------ |
| `warehouse_id`    | `SERIAL PRIMARY KEY`                           | Unique identifier for this warehouse                          |
| `organization_id` | `INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE`     | The tenant company that owns this facility                    |
| `config_id`       | `INT UNIQUE REFERENCES warehouse_configs(config_id) ON DELETE SET NULL` | Points to the operational rules profile for this site. `UNIQUE` enforces the intended 1:1 relationship. [[Warehouse Configs]] |
| `name`            | `VARCHAR(100)`                                 | e.g., "Venlo Logistics Hub Hub-A"                             |
| `street`          | `VARCHAR(100)`                                 | Physical street address                                       |
| `city`            | `VARCHAR(50)`                                  |                                                               |
| `postal_code`     | `VARCHAR(20)`                                  | Crucial for shipping & transport document APIs                |
| `country`         | `VARCHAR(50)`                                  |                                                               |
| `timezone`        | `VARCHAR(50)`                                  | e.g., "Europe/Amsterdam" (ensures correct audit timestamps)   |
| `is_active`       | `BOOLEAN DEFAULT TRUE`                         | Allows archiving a facility without breaking transaction logs |

---

## 🧠 Architectural Rules & Notes

* **Cascading Deletes:** If an `Organization` is deleted, all associated `Warehouses` cascade delete (`ON DELETE CASCADE`, now explicit in the schema above rather than just prose).
* **Config Separation:** By pointing to a separate `Warehouse_Configs` table, we can easily toggle global parameters (like *Is staging required before putaway?* or *Do we allow mixed SKUs on a single location?*) without cluttering this physical address table.
* **1:1 enforced:** `config_id` is now `UNIQUE`, so two warehouses can no longer silently share (and unintentionally cross-mutate) the same config profile. If sharing is genuinely desired for a tenant, that must now be an explicit decision made by duplicating the config row, not an accidental side effect.
* **Composite FK target for tenant integrity:**
  ```sql
  ALTER TABLE warehouses ADD CONSTRAINT uq_warehouses_org_wh UNIQUE (organization_id, warehouse_id);
  ```
  This lets any child table that stores both an `organization_id` and a `warehouse_id` (e.g. [[Employees]], [[Sales Orders]], [[Purchase Orders]]) declare a **composite foreign key** back to this pair, e.g.:
  ```sql
  FOREIGN KEY (organization_id, primary_warehouse_id) REFERENCES warehouses(organization_id, warehouse_id)
  ```
  This makes it a hard database constraint — not just an app-layer assumption — that a warehouse referenced by a tenant-scoped row actually belongs to that same tenant. See *"Multi-Tenant Integrity"* in [[Database structure]].