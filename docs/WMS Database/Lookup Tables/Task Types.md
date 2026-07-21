
The `task_types` table acts as a master lookup table. It defines the valid classes of physical or administrative work that can be executed on the warehouse floor, preventing hardcoded type strings in the core queue.

## Table Schema

| **Field Name**   | **Type / Constraint**         | **Description**                                                                                   |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| **task_type_id** | `SERIAL PRIMARY KEY`          | Unique identifier for this task type. Used as a foreign key in the main `tasks` table.            |
| **code**         | `VARCHAR(30) UNIQUE NOT NULL` | System code used by the backend and frontend application logic (e.g., `'BOOKING'`, `'PICKING'`).  |
| **description**  | `VARCHAR(100) NULL`           | Human-readable explanation of what this operational category involves for user-facing dashboards. |
