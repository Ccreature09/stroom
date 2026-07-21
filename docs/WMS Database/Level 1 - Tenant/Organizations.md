
The `organizations` table is the absolute parent table of the entire database hierarchy. It represents the client/tenant companies (e.g., Stryker, Arvato) using your Multi-Tenant WMS platform. 

## Table Schema

| Field Name | Type / Constraint | Description |
| :--- | :--- | :--- |
| `organization_id` | `SERIAL PRIMARY KEY` | Unique global identifier for this tenant |
| `name` | `VARCHAR(100) UNIQUE NOT NULL` | The legal or trade name of the client company |
| `is_active` | `BOOLEAN DEFAULT TRUE` | Controls whether this tenant has active system access |
| `created_at` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | Internal audit trail showing when they joined the platform |
| `updated_at` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | Last time this tenant record was changed (audit consistency with other master tables) |

---

## 🧠 Architectural Rules & Notes

* **Root of tenant isolation:** Every table that is meant to be tenant-scoped either carries `organization_id` directly, or inherits scope through `warehouses.organization_id`. See *"Multi-Tenant Integrity"* in [[Database structure]] for the composite-key pattern used to keep child rows from crossing tenant boundaries.
* **Composite FK target:** `UNIQUE (organization_id)` is implicit via the primary key; downstream tables (`warehouses`, `customers`, `suppliers`, `items`, `carriers`) each add `UNIQUE (organization_id, <own_id>)` so they can be safely referenced by composite foreign keys from their children.