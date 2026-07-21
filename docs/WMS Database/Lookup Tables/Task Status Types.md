The `task_statuses` table acts as a master lookup table. It defines the standardized lifecycle states of any warehouse task. It coordinates task state changes in real-time as workers claim and execute assignments.

## Table Schema

|**Field Name**|**Type / Constraint**|**Description**|
|---|---|---|
|**status_id**|`SERIAL PRIMARY KEY`|Unique identifier for this lifecycle state. Used as a foreign key in the main `tasks` table.|
|**code**|`VARCHAR(20) UNIQUE NOT NULL`|System code representing the state machine status (e.g., `'PENDING'`, `'ACTIVE'`).|
|**description**|`VARCHAR(100) NULL`|Human-readable explanation of what this state represents in the workflow.|