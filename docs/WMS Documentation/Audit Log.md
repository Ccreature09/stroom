# 📋 Schema Audit Log

A record of the full audit performed on this vault and every fix applied. Kept for traceability — if a constraint here seems surprising, check here first before assuming it's a mistake.

## 🔴 Critical fixes — Multi-tenant isolation

* **Composite tenant FKs added** so a row can no longer reference a warehouse/customer/supplier/carrier belonging to a *different* tenant than itself. See *"Multi-Tenant Integrity"* in [[Database structure]] for the full pattern. Applied to: [[Employees]] (`primary_warehouse_id`/`current_warehouse_id`), [[Sales Orders]] (`warehouse_id`/`customer_id`/`carrier_id`), [[Purchase Orders]] (`warehouse_id`/`supplier_id`).
* **[[Items]] was tenant-less with a globally-unique `sku`.** Added `organization_id`; `sku` uniqueness rescoped to `UNIQUE (organization_id, sku)`. `barcode` intentionally stays globally unique (real-world UPC/EAN/GS1 codes are global by definition).
* **[[Carriers]] was tenant-less** while [[Customers]] and [[Suppliers]] were already scoped. Added `organization_id`; `name` uniqueness rescoped to `UNIQUE (organization_id, name)`.
* **[[Sales Orders]] had no `organization_id`** at all (inconsistent with [[Purchase Orders]]). Added it, and used it to anchor the composite FKs above.
* **[[Shipments]] was tenant-less with a plain `carrier_id` FK** — the one gap the original audit pass missed. Added `organization_id`; `warehouse_id` and `carrier_id` upgraded to composite tenant-safe FKs, matching [[Sales Orders]].

## 🟠 High-priority fixes — Free text replaced with real FKs

* **Dock doors were raw strings.** `dock_door_number`/`dock_door_id` on [[Booking Tasks]], [[Unloading Tasks]], and [[Loading Tasks]] are now `dock_door_location_id INT REFERENCES locations(location_id)`, matching the pattern already used to fix Carriers/Customers/Suppliers/Pallets elsewhere in this vault.
* **[[Employees]] had no authentication fields** despite the doc claiming this table "handles authentication." Added `email` (unique per tenant), `password_hash`, plus `is_active`, `hire_date`, `termination_date` for proper lifecycle management (deactivate instead of delete).

## 🟡 Medium fixes — Constraints & consistency

* **Explicit `ON DELETE` behavior added** where it was previously unspecified: [[Stock Movements]] (all FKs → `RESTRICT`, protecting the immutable ledger), [[Purchase Orders]]/[[Sales Orders]] (`RESTRICT` on org/warehouse/supplier/customer), [[Purchase Order Lines]] (`CASCADE` on `po_id`, `RESTRICT` on `item_id`), [[Sales Order Lines]] (`CASCADE` on `so_id`, `RESTRICT` on `item_id`).
* **Missing uniqueness constraints added:** `UNIQUE (organization_id, name)` on [[Inventory Status Types]]; `UNIQUE (warehouse_id, name)` on [[Zone Types]]; `UNIQUE (warehouse_id, department_name)` on [[Departments]].
* **Missing quantity/cost `CHECK` constraints added:** `quantity_ordered > 0` and `quantity_received >= 0` on [[Purchase Order Lines]]; `quantity_requested > 0`, `quantity_allocated >= 0`, and `quantity_shipped >= 0 AND quantity_shipped <= quantity_allocated` on [[Sales Order Lines]]; `quantity > 0` on [[Stock Movements]].
* **[[Warehouses]].config_id is now `UNIQUE`**, enforcing the 1:1 relationship with [[Warehouse Configs]] that the docs already described as the common case, preventing accidental cross-warehouse config sharing.
* **[[Tasks]] gained a denormalized `warehouse_id`** so tasks can be filtered/queried per-warehouse directly, instead of joining through whichever child table happens to hold a `location_id`.

## ⚪ Low-priority / documentation fixes

* **[[Physical Entities]] and [[User Workflows]] were completely empty** despite being linked from the [[README|README hub]] as core references — both are now populated (entity glossary + end-to-end process walkthroughs).
* **`updated_at` audit columns added** for consistency to [[Organizations]], [[Carriers]], [[Customers]], [[Suppliers]], [[Locations]], and [[Pallets]] — previously present on some master tables but not others.