
The `pallets` table is the master registry for every LPN (License Plate Number) in the building — a single scannable identifier for a physical unit load (pallet, tote, or carton) as it moves through receiving, putaway, picking, and loading. Every `lpn` field currently scattered across [[Putaway Tasks]], [[Picking Tasks]], and [[Loading Tasks]] should point here instead of being an unvalidated string.

## Table Schema

| Field Name | Type / Constraint | Description |
| :--- | :--- | :--- |
| `lpn_id` | `VARCHAR(50) PRIMARY KEY` | The License Plate Number itself — human-scannable, so it's the natural key rather than a surrogate int |
| `warehouse_id` | `INT REFERENCES warehouses(warehouse_id) ON DELETE CASCADE` | Which facility currently owns this LPN |
| `current_location_id` | `INT NULL REFERENCES locations(location_id) ON DELETE SET NULL` | Where this LPN physically sits right now |
| `status` | `VARCHAR(20) DEFAULT 'ACTIVE'` | `ACTIVE`, `EMPTY`, `RETIRED` |
| `created_at` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | When this LPN was first generated (typically at receiving) |
| `updated_at` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | Last time this LPN's status/location changed (audit consistency with other master tables) |

---

## 🧠 Architectural Rules & Notes

* **Contents live in `inventory`, not here:** This table tracks the container itself, not what's on it. If you want per-LPN contents rather than per-location, add a nullable `lpn_id` FK on [[Inventory]] alongside `location_id`.
* **Replaces bare strings:** [[Putaway Tasks]], [[Picking Tasks]], and [[Loading Tasks]] all previously stored `lpn VARCHAR(50)` with no integrity check. Each now uses `lpn_id VARCHAR(50) REFERENCES pallets(lpn_id)`.
* **Reused across the pallet's life:** The same LPN typically gets reused across unload → putaway → pick → load, which is exactly why the task tables should reference one shared `pallets` row rather than each inventing their own string.
