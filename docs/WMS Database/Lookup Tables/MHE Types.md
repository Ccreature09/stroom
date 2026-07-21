
The `mhe_types` table acts as a master lookup table. It defines the rules, licensing requirements, and physical operational limits for classes of machinery.

## Table Schema

| Field Name | Type / Constraint | Description |
| :--- | :--- | :--- |
| `mhe_type_id` | `SERIAL PRIMARY KEY` | Unique identifier for this category of machinery |
| `name` | `VARCHAR(50) UNIQUE NOT NULL` | e.g., 'EPT', 'Reachtruck', 'Forklift' |
| `requires_license` | `BOOLEAN DEFAULT TRUE` | If TRUE, users must have a matching entry in `employee_licenses` to use it |
| `max_weight_capacity_kg` | `INT NULL` | Maximum load limit (critical for safety routing during putaway) |
| `max_reach_height_mm` | `INT NULL` | Max reach height in millimeters (tells the system if it can access upper rack levels) |
