# Table: items

The `items` table serves as the central product master registry (Stock Keeping Units) for the Warehouse Management System. It stores all static dimensional, logistical, and safety attributes of an item required for inventory tracking, putaway logic, and shipping calculations.

## 1. Schema Definition

| Column Name | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `item_id` | INT / UUID | PRIMARY KEY, AUTO_INCREMENT | Unique internal identifier for the product. |
| `organization_id` | INT | NOT NULL, `REFERENCES organizations(organization_id) ON DELETE CASCADE` | Scopes this item master to a specific tenant. Fixes a gap where `sku` was previously globally unique, which would have blocked two tenants from ever using the same SKU value. |
| `sku` | VARCHAR(50) | NOT NULL, `UNIQUE (organization_id, sku)`, INDEX | Stock Keeping Unit (e.g., `VW-803-231-A`), unique per tenant rather than globally. |
| `barcode` | VARCHAR(128) | UNIQUE, INDEX | Universal Product Code (UPC), EAN, or internal GS1 barcode — genuinely global by design (these codes are issued by external standards bodies), so this stays a plain global `UNIQUE`. |
| `name` | VARCHAR(150) | NOT NULL | Short display name of the item. |
| `description` | TEXT | NULL | Detailed description of the product or technical specifications. |
| `category` | VARCHAR(50) | INDEX | Broad classification (e.g., Automotive, Electronics, Apparel). |
| `length_cm` | DECIMAL(10,2) | NOT NULL, DEFAULT 0.00 | Physical package length for cubing and storage logic. |
| `width_cm` | DECIMAL(10,2) | NOT NULL, DEFAULT 0.00 | Physical package width. |
| `height_cm` | DECIMAL(10,2) | NOT NULL, DEFAULT 0.00 | Physical package height. |
| `weight_kg` | DECIMAL(10,3) | NOT NULL, DEFAULT 0.000 | Gross weight including packaging (critical for MHE capacity). |
| `hazard_class` | VARCHAR(20) | DEFAULT 'None' | Safety rating for storage segregation (e.g., Flammable, Corrosive). |
| `is_batch_tracked` | BOOLEAN | NOT NULL, DEFAULT FALSE | If TRUE, every [[Inventory]] row for this item must carry a `batch_number`. |
| `is_lot_tracked` | BOOLEAN | NOT NULL, DEFAULT FALSE | If TRUE, every [[Inventory]] row for this item must carry a `lot_number`. |
| `has_expiry` | BOOLEAN | NOT NULL, DEFAULT FALSE | If TRUE, every [[Inventory]] row for this item must carry an `expiry_date`, and picking should default to FEFO for this item. |
| `shelf_life_days` | INT | NULL | Standard shelf life from receipt, used to auto-calculate `expiry_date` at putaway if the supplier doesn't provide one directly. Only meaningful when `has_expiry` is TRUE. |
| `min_stock_level` | INT | DEFAULT 0 | Safety stock threshold used to trigger reorder alerts. |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Record creation timestamp. |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP ON UPDATE | Last modified timestamp. |

---

## 🧠 Architectural Rules & Notes

* **Tenant scoping fix:** `items` previously had no `organization_id`, and `sku` was globally `UNIQUE` — meaning two different tenants could never both use SKU `"ABC-123"`, a real-world certainty in any shared platform. `sku` uniqueness is now scoped per tenant via `UNIQUE (organization_id, sku)`.
* **Composite FK target:** downstream item-referencing rows don't need their own `organization_id` propagated — `item_id` remains the single global PK referenced everywhere ([[Inventory]], [[Purchase Order Lines]], [[Sales Order Lines]], all Task tables), so no composite FK is required on those children for this particular fix.
