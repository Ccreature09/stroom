
The `carriers` table is a master lookup of freight/shipping providers, replacing the free-text carrier fields scattered across [[Sales Orders]] and [[Unloading Tasks]].

## Table Schema

| Field Name | Type / Constraint | Description |
| :--- | :--- | :--- |
| `carrier_id` | `SERIAL PRIMARY KEY` | Unique identifier for this carrier |
| `organization_id` | `INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE` | Scopes this carrier to a specific tenant — matches the scoping already used on [[Customers]] and [[Suppliers]] |
| `name` | `VARCHAR(100) NOT NULL` | e.g., 'DHL', 'PostNL', 'FedEx', 'Mainfreight'. `UNIQUE (organization_id, name)` — unique per tenant, not globally |
| `scac_code` | `VARCHAR(10) NULL` | Standard Carrier Alpha Code, used on shipping/customs documents |
| `tracking_url_template` | `VARCHAR(255) NULL` | URL pattern with a placeholder for building tracking links, e.g. `https://track.dhl.com/{tracking_number}` |
| `is_active` | `BOOLEAN DEFAULT TRUE` | Allows retiring a carrier without breaking historical records |
| `updated_at` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | Last time this carrier record was changed |

---

## 🧠 Architectural Rules & Notes

* **Replaces free text:** [[Sales Orders]].`carrier_code` becomes `carrier_id INT REFERENCES carriers(carrier_id)`, and [[Unloading Tasks]].`carrier_name` becomes `carrier_id INT REFERENCES carriers(carrier_id)`.
* **Tenant scoping fix:** This table previously had no `organization_id`, inconsistent with [[Customers]] and [[Suppliers]] which are both tenant-scoped. Every tenant now manages its own carrier list; a global "industry" carrier list can still be seeded per-tenant via a setup script if desired.
* **Composite FK target:** `UNIQUE (organization_id, carrier_id)` should be added alongside the primary key so [[Sales Orders]] can enforce, via composite FK, that a referenced carrier belongs to the same tenant as the order:
  ```sql
  ALTER TABLE carriers ADD CONSTRAINT uq_carriers_org_carrier UNIQUE (organization_id, carrier_id);
  ```
