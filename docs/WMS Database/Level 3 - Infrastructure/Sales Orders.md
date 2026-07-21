
The `sales_orders` table tracks high-level outbound fulfillment demands, acting as the master document header for customer or retail store requests.

## 1. Schema Definition

| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `so_id` | INT / UUID | PRIMARY KEY, AUTO_INCREMENT | Unique internal identifier for the Sales Order. |
| `so_number` | VARCHAR(50) | UNIQUE, NOT NULL, INDEX | Human-readable unique order identifier (e.g., `SO-2026-0001`). |
| `organization_id` | INT | NOT NULL, `REFERENCES organizations(organization_id) ON DELETE RESTRICT` | References the owning tenant. Added for consistency with [[Purchase Orders]] and to anchor the composite tenant-integrity FKs below. |
| `warehouse_id` | INT | NOT NULL, `REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT`, composite `(organization_id, warehouse_id) REFERENCES warehouses(organization_id, warehouse_id)` | The originating warehouse responsible for fulfilling this order. Composite FK guarantees the warehouse belongs to the same tenant. |
| `customer_id` | INT | NOT NULL, `REFERENCES customers(customer_id) ON DELETE RESTRICT`, composite `(organization_id, customer_id) REFERENCES customers(organization_id, customer_id)` | References the destination client, dealer, or customer. Composite FK guarantees the customer belongs to the same tenant. |
| `shipping_address`| TEXT | NOT NULL | Full delivery details for this specific order (defaults from `customers.default_shipping_address`, but can be overridden per order). |
| `status` | VARCHAR(20) | DEFAULT 'Pending' | Order Lifecycle: `Pending`, `Allocated`, `Picking`, `Packing`, `Shipped`, `Cancelled`. |
| `carrier_id` | INT | NULL, `REFERENCES carriers(carrier_id) ON DELETE SET NULL`, composite `(organization_id, carrier_id) REFERENCES carriers(organization_id, carrier_id)` | References the shipping provider. Composite FK is skipped automatically when `carrier_id IS NULL` (Postgres `MATCH SIMPLE` default). |
| `tracking_number` | VARCHAR(100) | NULL | Carrier package tracking index generated at the packing stage. |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Timestamp when the order entered the WMS pipeline. |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP ON UPDATE | Last activity modification timestamp. |

---

## 🧠 Architectural Rules & Notes

* **Added `organization_id`:** Previously this table only had `warehouse_id`, unlike [[Purchase Orders]] which explicitly stored `organization_id`. Adding it here closes both the stylistic inconsistency and — more importantly — gives this table a direct tenant anchor to build composite FKs from, rather than relying on an indirect `warehouse_id → organization_id` join for every tenant check.
* **Tenant integrity via composite FKs:** Because `warehouses`, `customers`, and `carriers` each expose `UNIQUE (organization_id, <id>)`, the composite FKs above turn "this order's warehouse/customer/carrier must belong to this order's tenant" into an enforced database constraint. See *"Multi-Tenant Integrity"* in [[Database structure]].
* **`ON DELETE RESTRICT` made explicit:** Historical sales orders must never dangle — deletes on warehouse/customer are blocked until the order is reassigned or archived.
