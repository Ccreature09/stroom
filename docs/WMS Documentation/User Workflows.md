# 🔄 User Functional Workflows

End-to-end walkthroughs of how the tables in [[Database structure]] work together for each major warehouse process.

## 1. Inbound Receiving (Unload → Book → Putaway)

1. A [[Purchase Orders|Purchase Order]] is raised against a [[Suppliers|Supplier]], with expected quantities on [[Purchase Order Lines]].
2. A trailer arrives. An **Unloading Task** is created ([[Unloading Tasks]]), referencing a `dock_door_location_id` and the [[Carriers|Carrier]] that delivered it.
3. Pallets come off the trailer and get a physical [[Pallets|LPN]] tag if they don't already have one.
4. A **Booking Task** ([[Booking Tasks]]) records what actually arrived against the expected [[Items|Item]] — capturing real `batch_number`/`lot_number`/`expiry_date` at the point of receipt.
5. A **Putaway Task** ([[Putaway Tasks]]) moves the LPN from staging to its permanent rack `location_id`, guided by `default_putaway_strategy` on [[Warehouse Configs]].
6. Every physical move along the way writes an immutable row to [[Stock Movements]], and the resulting balance lands in [[Inventory]].

## 2. Outbound Fulfillment (Allocate → Pick → Load → Ship)

1. A [[Customers|Customer]] places a [[Sales Orders|Sales Order]], broken into [[Sales Order Lines]].
2. The allocation engine reserves stock against [[Inventory]] (respecting `allow_allocation` on [[Inventory Status Types]] and FEFO via `expiry_date`), filling in `quantity_allocated` and the specific `batch_number`/`lot_number` on each line.
3. A **Picking Task** ([[Picking Tasks]]) is generated per allocated line, directing a worker to a `pick_location_id` and an `lpn_id` to consolidate into.
4. Once picked and packed, the order is attached to a [[Shipments|Shipment]] (a shipment can consolidate multiple sales orders).
5. A **Loading Task** ([[Loading Tasks]]) moves the LPN from staging onto the trailer at a `dock_door_location_id`, in `sequence_number` order.
6. The shipment is marked `DISPATCHED`, `tracking_number` is set on the sales order, and `quantity_shipped` is finalized on each order line.

## 3. Internal Stock Operations

* **Replenishment** ([[Replenishment Tasks]]): triggered when an active pick face drops below `min_stock_level` on [[Items]]; moves stock from bulk/reserve storage to the pick face, FEFO-first.
* **Cycle Counting** ([[Cycle Count Tasks]]): scheduled per `cycle_count_frequency_days` on [[Warehouse Configs]], or manually triggered by a supervisor with `can_force_recount`. Compares `expected_quantity` (blind, hidden from the operator) against `counted_quantity`, then reconciles [[Inventory]] and logs the adjustment to [[Stock Movements]].

## 4. Task Routing & Execution

* Every unit of work is a row in [[Tasks]] — the unified state engine — with a `task_type_id`, `status_id`, `priority`, `warehouse_id`, and optional `mhe_type_required`.
* While a task is `PENDING` and unassigned, [[Task Eligible Departments]] determines which [[Departments]] can see and claim it.
* Once claimed, `assigned_employee_id` is set; the worker must belong to an eligible department ([[Employee Departments]]) and, if `mhe_type_required` is set, hold a matching entry in [[Employee Licenses]].
* `started_at`/`completed_at` timestamps drive labor productivity reporting, cross-referenced against [[Time Clock Entries]] to compute idle vs. productive time per shift.

## 5. Workforce & Access

* An [[Employees|Employee]] is hired under an [[Organizations|Organization]], assigned a [[Position Types|Position]] that determines their permissions (`can_pick`, `can_load`, `can_manage_users`, etc.), and optionally cross-trained across multiple [[Departments]] via [[Employee Departments]].
* Clocking in at a terminal updates `current_warehouse_id` on [[Employees]] (restricting their searches/movements to that building) and opens a new row in [[Time Clock Entries]].
