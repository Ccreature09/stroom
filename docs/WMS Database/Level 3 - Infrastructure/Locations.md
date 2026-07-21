# Database Schema: `locations` Table (Spatial Adaptation)

The `locations` table defines every physical coordinate in the warehouse where stock can be placed. This table unifies structural rack slots, open staging lines, and concrete dock doors as standard queryable rows. It stores raw physical dimensions to drive the PixiJS top-down canvas rendering loop alongside standard WMS metadata.

## Table Schema

| Field Name           | Data Type / Constraint                                      | Nullable     | Description                                                                                                                                                      |
| :------------------- | :---------------------------------------------------------- | :----------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `location_id`        | `SERIAL PRIMARY KEY`                                        | **NOT NULL** | Unique global identifier for this specific storage slot or door[cite: 1].                                                                                        |
| `warehouse_id`       | `INT REFERENCES warehouses(warehouse_id) ON DELETE CASCADE` | **NOT NULL** | Which facility this physical location belongs to[cite: 1].                                                                                                       |
| `zone_id`            | `INT REFERENCES zones(zone_id) ON DELETE RESTRICT`          | **NOT NULL** | Foreign key inheriting operational scanning behaviors, permanence, and clearances from the parent zone configuration.                                            |
| `location_code`      | `VARCHAR(50) UNIQUE NOT NULL`                               | **NOT NULL** | Barcode text scanned by operators (e.g., `'WH1-BULK-04-12-3'`, `'DOCK-01'`)[cite: 1].                                                                            |
| `aisle`              | `INT`                                                       | *NULL*       | Alleyway corridor number (Standard racking only)[cite: 1].                                                                                                       |
| `bay`                | `INT`                                                       | *NULL*       | Vertical rack section (Standard racking only)[cite: 1].                                                                                                          |
| `level`              | `INT`                                                       | *NULL*       | Height level from floor (Standard racking only)[cite: 1].                                                                                                        |
| `floor level`        | `INT DEFAULT 1`                                             | NOT NULL     | The physical floor or mezzanine tier (e.g., `1` = Ground Floor, `2` = Mezzanine Tier 1, `3` = Mezzanine Tier 2).                                                 |
| `position`           | `INT`                                                       | *NULL*       | Specific slot within the shelf level (Standard racking only)[cite: 1].                                                                                           |
| `height_mm`          | `INT`                                                       | *NULL*       | The exact physical clearance height in millimeters[cite: 1]. Left `NULL` for open vertical space zones (floor drop, docks) to bypass height validation[cite: 1]. |
| `max_weight_kg`      | `INT`                                                       | *NULL*       | Structural weight limit of this specific rack shelf[cite: 1]. Left `NULL` for solid concrete floors to bypass load validation[cite: 1].                          |
| `is_blocked`         | `BOOLEAN DEFAULT FALSE`                                     | **NOT NULL** | Flag to manually stop system allocation and trigger red visual alerts (e.g., damaged rack upright)[cite: 1].                                                     |
| `physical_x`         | `INT`                                                       | **NOT NULL** | Global X-coordinate layout anchor relative to warehouse origin (in millimeters).                                                                                 |
| `physical_y`         | `INT`                                                       | **NOT NULL** | Global Y-coordinate layout anchor relative to warehouse origin (in millimeters).                                                                                 |
| `physical_width_mm`  | `INT`                                                       | **NOT NULL** | The exact width footprint boundary along the layout X-axis (in millimeters).                                                                                     |
| `physical_length_mm` | `INT`                                                       | **NOT NULL** | The exact length/depth footprint boundary along the layout Y-axis (in millimeters).                                                                              |
| `rotation_degrees`   | `INT DEFAULT 0`                                             | **NOT NULL** | Visual orientation angle (0 to 359) to render skewed or turned racking corridors cleanly.                                                                        |
| `updated_at`         | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`                       | **NOT NULL** | System audit metadata tracking the last modification timestamp[cite: 1].                                                                                         |

## 🧠 Core Architectural Rules

### 1. Unified Entity Mapping
Dock doors, staging areas, and receiving lanes are real rows in this table instead of text fields in task records[cite: 1]. For functional areas like `'DOCK-01'`, structural racking fields (`aisle`, `bay`, `level`) remain `NULL`[cite: 1]. The node inherits behavioral configurations (like skipping barcode scans) instantly by looking up its associated `zone_id`.

### 2. PixiJS Client-Side Rendering Math
To maximize frame rates and avoid visual overlay clashing in a top-down 2D canvas, `physical_x` and `physical_y` represent the ground-level footprint of the space or vertical racking bay. The conversion to screen vectors is computed on the frontend tier:

$$\text{canvas\_x} = \text{physical\_x} \times \text{scale\_factor}$$
$$\text{canvas\_y} = \text{physical\_y} \times \text{scale\_factor}$$

## Performance Indexes

```sql
-- Restrict rotation configurations to valid circle bounds
ALTER TABLE locations ADD CONSTRAINT chk_rotation_range 
CHECK (rotation_degrees >= 0 AND rotation_degrees < 360);

-- Composite spatial index to ensure instantaneous bounding-box rendering during view pan/zoom
CREATE INDEX idx_locations_canvas_render 
ON locations (warehouse_id, physical_x, physical_y) 
WHERE is_blocked = FALSE;

-- Speeds up validation lookups for directed putaway rules engine checks
CREATE INDEX idx_locations_zone_lookup
ON locations (warehouse_id, zone_id);