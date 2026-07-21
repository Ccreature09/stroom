
This junction table manages which departments are authorized to view and execute a given task while its status is still PENDING. It establishes a many-to-many relationship, allowing a single task to be broadcasted to multiple departments simultaneously without duplicating the task itself.

## Table Schema

| Field Name      | Type   | Constraints                                                      | Description                                                        |
| :-------------- | :----- | :--------------------------------------------------------------- | :----------------------------------------------------------------- |
| `task_id`       | `UUID` | `FOREIGN KEY`, `REFERENCES tasks(task_id)`, `ON DELETE CASCADE`  | The unique identifier of the task. [[Tasks]]                       |
| `department_id` | `INT` | `FOREIGN KEY`, `REFERENCES departments(department_id)`, `ON DELETE CASCADE` | The unique identifier of the department allowed to pull this task. [[Departments]] |

> [!NOTE]
> **Primary Key:** 
> A composite primary key must be defined on `(task_id, department_id)` to prevent duplicate mapping rows.

> [!TIP]
> **Data Integrity:**
> The `ON DELETE CASCADE` constraints guarantee that deleting a task or a department instantly cleans up this mapping table automatically, keeping the database free of orphaned references.