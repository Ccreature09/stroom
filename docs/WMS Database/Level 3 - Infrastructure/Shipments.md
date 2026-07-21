The `shipments` table is the master outbound dispatch header referenced by [[Loading Tasks]]. Where a [[Sales Orders|Sales Order]] represents *what the customer asked for*, a `shipment` represents *the physical trailer-load leaving the building* — one shipment can consolidate multiple sales orders, and a large sales order could in theory span more than one shipment.

## Table Schema

| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `shipment_id` | `UUID` | `PRIMARY KEY`, `DEFAULT gen_random_uuid()` | Unique identifier for this outbound dispatch |
| `organization_id` | `INT` | `NOT NULL`, `REFERENCES organizations(organization_id) ON DELETE RESTRICT` | The owning tenant. Anchors the composite tenant-integrity FKs below, matching the pattern used on [[Sales Orders]]/[[Purchase Orders]]. |
| `warehouse_id` | `INT` | `NOT NULL`, `REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT`, composite `(organization_id, warehouse_id) REFERENCES warehouses(organization_id, warehouse_id)` | The originating facility. Composite FK guarantees the warehouse belongs to the same tenant as `organization_id`. |
| `carrier_id` | `INT` | `NULL`, `REFERENCES carriers(carrier_id) ON DELETE SET NULL`, composite `(organization_id, carrier_id) REFERENCES carriers(organization_id, carrier_id)` | The freight provider handling this dispatch. Composite FK guarantees the carrier belongs to the same tenant; skipped automatically when `carrier_id IS NULL` (Postgres `MATCH SIMPLE` default). |
| `trailer_number` | `VARCHAR(30)` | NULL | Physical trailer or fleet number |
| `status` | `VARCHAR(20)` | `DEFAULT 'STAGING'` | Lifecycle: `STAGING`, `LOADING`, `DISPATCHED`, `CANCELLED` |
| `dispatched_at` | `TIMESTAMP` | NULL | When the trailer actually left the dock |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | |

---

## Shipment Sales Orders (Many-to-Many Bridge)

A shipment can carry multiple sales orders, and large orders can split across shipments — so don't add `shipment_id` directly onto [[Sales Orders]]. Use a bridge table instead:

| Field Name | Type / Constraint | Description |
| :--- | :--- | :--- |
| `shipment_id` | `UUID REFERENCES shipments(shipment_id) ON DELETE CASCADE` | |
| `so_id` | `INT REFERENCES sales_orders(so_id) ON DELETE CASCADE` | |
| `PRIMARY KEY` | `(shipment_id, so_id)` | Composite Primary Key |

---

## 🧠 Architectural Rules & Notes

* **Fixes a dangling reference:** [[Loading Tasks]].`shipment_id` already assumed this table existed — this fills that gap.
* **UUID to match `tasks`:** Using `UUID` here (rather than `SERIAL`) keeps the type consistent with [[Tasks]] and its child tables, since `Loading Tasks` is a 1:1 child of `tasks` and references `shipment_id` directly.
* **Tenant integrity fix:** This table previously had no `organization_id` and a plain (non-composite) FK on `carrier_id`, unlike [[Sales Orders]] and [[Purchase Orders]] — meaning nothing stopped a shipment from being assigned a carrier belonging to a *different* tenant. Adding `organization_id` and upgrading both `warehouse_id` and `carrier_id` to composite FKs closes that gap. See *"Multi-Tenant Integrity"* in [[Database structure]].