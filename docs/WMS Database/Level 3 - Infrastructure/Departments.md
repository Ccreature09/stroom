The departments table represents organizational and operational divisions within a specific warehouse. It acts as a routing bridge for assigning physical Tasks to groups of Employees. Departments can be system-default (e.g., Receiving, Picking) or dynamically created by supervisors for custom workflows. Unlike static lookup tables, this table allows supervisors to dynamically toggle active statuses and assign teams to specific operational hubs.

### Table Schema

| **Field Name**    | **Type / Constraint**                                       | **Description**                                                                                 |
| ----------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `department_id`   | `SERIAL PRIMARY KEY`                                        | Unique tracker ID for this specific department                                                  |
| `warehouse_id`    | `INT REFERENCES warehouses(warehouse_id) ON DELETE CASCADE` | The physical warehouse where this department operates                                           |
| `department_name` | `VARCHAR(100) NOT NULL`                                     | Descriptive name of the department (e.g., 'Picking', 'Receiving', 'Friday Night Rush'). `UNIQUE (warehouse_id, department_name)` — no duplicate department names within the same warehouse. |
| `is_custom`       | `BOOLEAN DEFAULT FALSE`                                     | Flag indicating if this is a supervisor-created department (`TRUE`) or system default (`FALSE`) |
| `is_active`       | `BOOLEAN DEFAULT TRUE`                                      | Allows archiving custom/temporary departments without deleting historical data                  |
| `updated_at`      | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`                       | Last time this department record was changed                                                    |

---

## Related Bridge Tables

- [[Employee Departments]] — which employees belong to this department
- [[Task Eligible Departments]] — which departments a given task is routed to
