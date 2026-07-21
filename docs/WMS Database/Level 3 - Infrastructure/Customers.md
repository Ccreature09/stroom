
The `customers` table is the master registry of end customers or retail destinations that [[Sales Orders]] ship to. It replaces the free-text `customer_name` field with a proper normalized entity.

## Table Schema

| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `customer_id` | `SERIAL` | `PRIMARY KEY` | Unique internal identifier for the customer |
| `organization_id` | `INT` | `REFERENCES organizations(organization_id) ON DELETE CASCADE`, NOT NULL | Scopes this customer to a specific tenant |
| `name` | `VARCHAR(150)` | NOT NULL | Customer, dealer, or retail store name |
| `contact_email` | `VARCHAR(150)` | NULL | |
| `contact_phone` | `VARCHAR(30)` | NULL | |
| `default_shipping_address` | `TEXT` | NULL | Standing delivery address, used to prefill new orders |
| `is_active` | `BOOLEAN` | `DEFAULT TRUE` | Allows archiving without breaking historical SO records |
| `updated_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | Last time this customer record was changed |

---

## 🧠 Architectural Rules & Notes

* **Per-order override stays put:** [[Sales Orders]] keeps its own `shipping_address TEXT` field for one-off delivery addresses — it should just be pre-filled from `customers.default_shipping_address` at order creation rather than being the only place the address lives.
* **Replaces free text:** [[Sales Orders]].`customer_name` becomes `customer_id INT REFERENCES customers(customer_id)`.
* **Composite FK target:** `UNIQUE (organization_id, customer_id)` lets [[Sales Orders]] enforce, via composite FK, that the referenced customer belongs to the same tenant as the order (see *"Multi-Tenant Integrity"* in [[Database structure]]):
  ```sql
  ALTER TABLE customers ADD CONSTRAINT uq_customers_org_customer UNIQUE (organization_id, customer_id);
  ```
