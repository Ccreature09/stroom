
The `Employee Licenses` table functions as a bridge table between [[Employees]] and [[MHE Types]]

## Table Schema

| Field Name    | Type / Constraint                                        | Description                                        |
| ------------- | -------------------------------------------------------- | -------------------------------------------------- |
| `employee_id` | `INT FOREIGN KEY REFERENCES employees ON DELETE CASCADE` |                                                    |
| `mhe_type_id` | `INT FOREIGN KEY REFERENCES mhe_types ON DELETE CASCADE` |                                                    |
| `issued_date` | `DATE`                                                   |                                                    |
| `expiry_date` | `DATE`                                                   |                                                    |
| `PRIMARY KEY` | `(employee_id, mhe_type_id`)                             | Composite Primary Key - Prevents duplicate entries |
