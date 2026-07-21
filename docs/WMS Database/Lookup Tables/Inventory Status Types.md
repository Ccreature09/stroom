The `inventory_statuses` table is a master lookup table that defines the physical states inventory can be in. Admins can create custom statuses to support specific workflows, attaching operational rules via boolean flags. 
## Table Schema 

| Field Name         | Type / Constraint                               | Description                                                        |
| :----------------- | :---------------------------------------------- | :----------------------------------------------------------------- |
| `status_id`        | `SERIAL PRIMARY KEY`                            | Unique identifier for this status configuration                    |
| `organization_id`  | `INT REFERENCES organizations(organization_id) ON DELETE CASCADE` | Scopes the status to a specific tenant                             |
| `name`             | `VARCHAR(50) NOT NULL`                          | e.g., 'AVAILABLE', 'QA_HOLD', 'DAMAGED_REPACK'. `UNIQUE (organization_id, name)` — no duplicate status names within a tenant |
| `allow_allocation` | `BOOLEAN DEFAULT TRUE`                          | Can customer orders reserve stock with this status?                |
| `allow_movement`   | `BOOLEAN DEFAULT TRUE`                          | Can workers physically move/transfer this stock?                   |
| `is_sellable`      | `BOOLEAN DEFAULT TRUE`                          | Does this stock count towards the active online webshop inventory? |

---

## 🧠 Architectural Rules & Notes

* **`EXPIRED` seed row recommended:** Now that [[Inventory]] carries `expiry_date`, seed a status row named `EXPIRED` with `allow_allocation = FALSE`, `allow_movement = FALSE` (or `TRUE` if you want it movable to a quarantine zone), and `is_sellable = FALSE`. This is a data/workflow note, not a schema change — you'll also want a scheduled job that scans `inventory.expiry_date` daily and flips matching rows to this status automatically, rather than relying on staff to notice.