
The `warehouse_configs` table stores the operational rule-set toggles for a given [[Warehouses|Warehouse]], separated out so global site behavior can be tuned without touching the physical address record.

## Table Schema

| Field Name                       | Type / Constraint                     | Description                                                                                      |               |
| :------------------------------- | :------------------------------------ | :----------------------------------------------------------------------------------------------- | ------------- |
| `config_id`                      | `SERIAL PRIMARY KEY`                  | Unique identifier for this configuration profile                                                 |               |
| `require_staging_before_putaway` | `BOOLEAN DEFAULT TRUE`                | If TRUE, received pallets must land in a staging location before a putaway task can be generated |               |
| `allow_mixed_sku_per_location`   | `BOOLEAN DEFAULT FALSE`               | If FALSE, a location can only ever hold one SKU at a time                                        |               |
| `allow_mixed_lpn_per_location`   | `BOOLEAN DEFAULT TRUE`                | If FALSE, a location can only ever hold one LPN at a time                                        |               |
| `default_putaway_strategy`       | `VARCHAR(20) DEFAULT 'NEAREST_EMPTY'` | e.g., `NEAREST_EMPTY`, `FIXED_SLOT`, `ZONE_BALANCED`                                             |               |
| `cycle_count_frequency_days`     | `INT NULL`                            | How often locations in this warehouse should be auto-scheduled for a [[Cycle Count Tasks         | Cycle Count]] |
| `updated_at`                     | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` |                                                                                                  |               |
|                                  |                                       |                                                                                                  |               |

---

## 🧠 Architectural Rules & Notes

* **Fixes a dangling reference:** [[Warehouses]].`config_id` already pointed here as `Warehouse_Configs` — this table simply didn't exist yet.
* **1:1 now enforced:** `warehouses.config_id` carries a `UNIQUE` constraint, so two warehouses can no longer accidentally point at the same config row. If a tenant genuinely wants identical rules across sites, duplicate the config row per warehouse instead — this keeps a change intended for one site from silently affecting another.
