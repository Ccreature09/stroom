
The `zone_types` table is a master configuration lookup that defines the operational, safety, and physical behavior of warehouse areas. Instead of relying on rigid naming conventions, this architecture uses explicit strategy flags to govern worker scanning workflows (scannable vs. unscannable drop actions) and system routing logic.

## Table Schema

| Field Name | Data Type / Constraint | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `zone_id` | `SERIAL PRIMARY KEY` | **NOT NULL** | Unique internal identifier for this zone configuration. |
| `warehouse_id` | `INT REFERENCES warehouses(warehouse_id) ON DELETE CASCADE` | **NOT NULL** | Scopes this operational zone to a specific physical warehouse facility. |
| `name` | `VARCHAR(50)` | **NOT NULL** | User-defined label (e.g., `'BULK'`, `'MEZZANINE'`, `'INBOUND'`, `'DOCK_STAGE'`). `UNIQUE (warehouse_id, name)` to prevent duplicate names within the same facility. |
| `requires_barcode_scan` | `BOOLEAN DEFAULT TRUE` | **NOT NULL** | Enforces RF scanner verification. If `FALSE`, operators execute drops by simply tapping "OK" on their terminal without scanning a physical tag. |
| `storage_permanence` | `VARCHAR(20) DEFAULT 'PERMANENT'` | **NOT NULL** | State constraint: `('PERMANENT', 'TEMPORARY', 'FLUID_BUFFER')`. Determines structural storage class. |
| `is_pickable` | `BOOLEAN DEFAULT TRUE` | **NOT NULL** | If `FALSE`, the picking allocation engine ignores stock pooled in this zone. |
| `is_temperature_controlled`| `BOOLEAN DEFAULT FALSE` | **NOT NULL** | Toggles environmental audit logging and inventory routing restrictions. |
| `requires_hazmat_clearance` | `BOOLEAN DEFAULT FALSE` | **NOT NULL** | Restricts task assignment to operators possessing active hazardous material safety training profiles. |

## 🧠 Zone Configuration Strategies

By blending `requires_barcode_scan` and `storage_permanence`, you configure all physical warehouse behaviors seamlessly:

1. **Permanent Storage (Selective Racking, Shelves):**
   * Configured as `requires_barcode_scan = TRUE` and `storage_permanence = 'PERMANENT'`. Enforces exact slot scanning to guarantee high-density accuracy.
2. **Temporary Staging Lines (Put-Away / Delivery Lines):**
   * Configured as `storage_permanence = 'TEMPORARY'`. Depending on warehouse capabilities, `requires_barcode_scan` can be toggled `TRUE` (scannable floor tags) or `FALSE` (un-tagged lines where operators drop pallets and click confirm).
3. **Fluid Buffers (Inbound Drop, Outbound Staging, QA Areas):**
   * Configured as `requires_barcode_scan = FALSE` and `storage_permanence = 'FLUID_BUFFER'`. Drivers drop pallets anywhere inside the physical zone boundary, tapping "OK" to pool items globally into the area without granular slot validation.

## SQL Constraints

```sql
ALTER TABLE zones ADD CONSTRAINT chk_storage_permanence 
CHECK (storage_permanence IN ('PERMANENT', 'TEMPORARY', 'FLUID_BUFFER'));