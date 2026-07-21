
This schema manages inbound logistics tracking. It separates the high-level vendor/order details (Header) from the individual items and quantities expected to arrive at the warehouse [[Purchase Order Lines]]

## 1. Purchase Orders

Stores global information regarding an expected shipment from an external supplier.

| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `po_id` | INT / UUID | PRIMARY KEY, AUTO_INCREMENT | Unique internal identifier for the PO. |
| `po_number` | VARCHAR(50) | UNIQUE, NOT NULL, INDEX | Human-readable document number (e.g., `PO-2026-001`). |
| `organization_id` | INT | NOT NULL, `REFERENCES organizations(organization_id) ON DELETE RESTRICT` | References the internal organization owner. |
| `warehouse_id` | INT | NOT NULL, `REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT`, composite `(organization_id, warehouse_id) REFERENCES warehouses(organization_id, warehouse_id)` | Target warehouse destination where goods will arrive. Composite FK guarantees the warehouse belongs to the same tenant as `organization_id`. |
| `supplier_id` | INT | NOT NULL, INDEX, `REFERENCES suppliers(supplier_id) ON DELETE RESTRICT`, composite `(organization_id, supplier_id) REFERENCES suppliers(organization_id, supplier_id)` | References the vendor supplying the goods. Composite FK guarantees the supplier belongs to the same tenant. |
| `status` | VARCHAR(20) | DEFAULT 'Draft' | Order stage: `Draft`, `Approved`, `Shipped`, `Partially Received`, `Completed`, `Cancelled`. |
| `expected_date` | DATE | NULL | Estimated delivery window for warehouse staffing prep. |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Date the order was requested. |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP ON UPDATE | Last activity modification timestamp. |

---

## 🧠 Architectural Rules & Notes

* **`ON DELETE RESTRICT` made explicit:** Historical purchase orders must never silently disappear or dangle if an org/warehouse/supplier row changes — deletes are blocked until the PO is reassigned or archived. This was previously unspecified (defaulting to `NO ACTION`, functionally similar but now documented deliberately).
* **Tenant integrity via composite FKs:** Since `warehouses` and `suppliers` each expose `UNIQUE (organization_id, <id>)`, the composite FKs above make it a hard constraint — not just an app assumption — that a PO's warehouse and supplier actually belong to the PO's own `organization_id`. See *"Multi-Tenant Integrity"* in [[Database structure]].
