
The `suppliers` table is the master registry of external vendors who ship goods into the warehouse via [[Purchase Orders]]. It replaces the free-text `supplier_name` field with a proper normalized entity.

## Table Schema

| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `supplier_id` | `SERIAL` | `PRIMARY KEY` | Unique internal identifier for the vendor |
| `organization_id` | `INT` | `REFERENCES organizations(organization_id) ON DELETE CASCADE`, NOT NULL | Scopes this supplier to a specific tenant |
| `name` | `VARCHAR(150)` | NOT NULL | Legal or trade name of the supplier |
| `contact_name` | `VARCHAR(100)` | NULL | Primary contact person |
| `contact_email` | `VARCHAR(150)` | NULL | |
| `contact_phone` | `VARCHAR(30)` | NULL | |
| `address` | `TEXT` | NULL | Full mailing/shipping origin address |
| `lead_time_days` | `INT` | NULL | Average expected days between PO approval and arrival, used for staffing/planning |
| `is_active` | `BOOLEAN` | `DEFAULT TRUE` | Allows archiving without breaking historical PO records |
| `updated_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | Last time this supplier record was changed |

---

## 🧠 Architectural Rules & Notes

* **Replaces free text:** [[Purchase Orders]].`supplier_name` becomes `supplier_id INT REFERENCES suppliers(supplier_id)`.
* **Composite FK target:** `UNIQUE (organization_id, supplier_id)` lets [[Purchase Orders]] enforce, via composite FK, that the referenced supplier belongs to the same tenant as the order:
  ```sql
  ALTER TABLE suppliers ADD CONSTRAINT uq_suppliers_org_supplier UNIQUE (organization_id, supplier_id);
  ```
