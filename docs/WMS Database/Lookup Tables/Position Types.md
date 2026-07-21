
The `position_types` table acts as a master lookup table. It defines the available position roles, system permissions, and operational constraints for all personnel across the organization.

## Table Schema

|**Field Name**|**Type / Constraint**|**Description**|
|---|---|---|
|`position_id`|`SERIAL PRIMARY KEY`|Unique identifier for this position class|
|`title`|`VARCHAR(50) UNIQUE NOT NULL`|Name of the role (e.g., 'Warehouse Operator', 'Supervisor')|
|`is_office_role`|`BOOLEAN DEFAULT FALSE`|True for desk-based staff; toggles system UI layout and device defaults|
|**`can_view_metrics`**|`BOOLEAN DEFAULT FALSE`|Access to operational dashboards, KPIs, and labor performance logs|
|**`can_assign_tasks`**|`BOOLEAN DEFAULT FALSE`|Permission to manually delegate or prioritize pick/pack tasks to workers|
|**`can_book`**|`BOOLEAN DEFAULT FALSE`|Permission to digitally receive goods into stock (Inbound Booking/GRN)|
|**`can_unload`**|`BOOLEAN DEFAULT FALSE`|Permission to register incoming trailers and unload trucks at the dock doors|
|**`can_load`**|`BOOLEAN DEFAULT FALSE`|Permission to confirm loaded pallets and close outward trailers for dispatch|
|**`can_pick`**|`BOOLEAN DEFAULT FALSE`|Permission to execute and scan pick tasks on the warehouse floor|
|**`can_pack`**|`BOOLEAN DEFAULT FALSE`|Permission to access packing station screens, verify items, and print labels|
|**`can_modify_inventory`**|`BOOLEAN DEFAULT FALSE`|Permission to manually adjust stock levels and write off missing/damaged items|
|**`can_override_unexpected_deliveries`**|`BOOLEAN DEFAULT FALSE`|Force-book items that do not have a matching Purchase Order (PO)|
|**`can_register_damages`**|`BOOLEAN DEFAULT FALSE`|Flag incoming goods as damaged and route them to quarantine zones|
|**`can_modify_locations`**|`BOOLEAN DEFAULT FALSE`|Define, block, or toggle physical rack coordinates in the system|
|**`can_replenish`**|`BOOLEAN DEFAULT FALSE`|Authorize bulk stock movements from reserve to active picking faces|
|**`can_force_recount`**|`BOOLEAN DEFAULT FALSE`|Trigger manual, unscheduled cycle count audits on physical locations|
|**`can_release_orders`**|`BOOLEAN DEFAULT FALSE`|Authorize batch releasing ("waving") of orders to the picking pool|
|**`can_void_shipments`**|`BOOLEAN DEFAULT FALSE`|Intercept and reverse packed/labeled shipments before transit dispatch|
|**`can_manage_users`**|`BOOLEAN DEFAULT FALSE`|Create, update, or disable warehouse personnel accounts|
|**`can_modify_configs`**|`BOOLEAN DEFAULT FALSE`|Edit global warehouse operational configuration settings|
