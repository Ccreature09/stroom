
The `warehouse_halls` table represents distinct physical buildings, halls, or operational modules within a larger facility (Warehouse). It provides macro-level spatial bounds (`width`, `length`, `height`) used by the spatial layout designer (PixiJS) to dynamically construct canvas viewports and enforce spatial constraints.

---

## Table Schema

| Field Name | Type / Constraint | Description |
| :--- | :--- | :--- |
| **`hall_id`** | `SERIAL PRIMARY KEY` | Unique identifier for this physical hall or module. |
| **`organization_id`** | `INT NOT NULL` | The tenant company that owns this facility module. Part of multi-tenant composite integrity. |
| **`warehouse_id`** | `INT NOT NULL` | Points to the parent warehouse facility this hall belongs to. |
| **`name`** | `VARCHAR(100) NOT NULL` | Human-readable identifier for the module (e.g., `"Hall A - Ambient"`, `"Cold Storage Unit 2"`). |
| **`physical_width_mm`** | `INT NOT NULL DEFAULT 80000` | Total physical width of the hall in millimeters (X-axis canvas bounds). |
| **`physical_length_mm`** | `INT NOT NULL DEFAULT 60000` | Total physical length of the hall in millimeters (Y-axis canvas bounds). |
| **`clear_height_mm`** | `INT DEFAULT 12000` | Maximum usable vertical clearance height in millimeters. |
| **`is_active`** | `BOOLEAN DEFAULT TRUE` | Flags whether this hall is active for location mapping and picking routes. |
| **`created_at`** | `TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP` | Audit timestamp when the hall was registered. |
| **`updated_at`** | `TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP` | Audit timestamp when hall spatial metrics were last updated. |
