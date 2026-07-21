
The `Employee Departments` table functions as a bridge table between [[Employees]] and [[Departments]]. It defines which department(s) an employee actively belongs to — which is the piece [[Task Eligible Departments]] was missing a partner for. That table controls which departments can *see* a task; this table controls which employees are *in* a department in the first place.

## Table Schema

| Field Name | Type / Constraint | Description |
| :--- | :--- | :--- |
| `employee_id` | `INT REFERENCES employees(employee_id) ON DELETE CASCADE` | |
| `department_id` | `INT REFERENCES departments(department_id) ON DELETE CASCADE` | |
| `is_primary` | `BOOLEAN DEFAULT FALSE` | Marks an employee's main department when they belong to more than one |
| `assigned_at` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | When this employee was added to the department |
| `PRIMARY KEY` | `(employee_id, department_id)` | Composite Primary Key - Prevents duplicate mapping rows |

---

## 🧠 Architectural Rules & Notes

* **Why this exists:** Nothing previously defined which employees belong to which department, even though tasks were already being routed *to* departments.
* **Floating staff:** An employee can belong to more than one department (e.g., cross-trained on Receiving and Picking); `is_primary` lets reporting still attribute them to one "home" department.
