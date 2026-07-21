## Level 1: Tenant Level
* [[Organizations]] - Parent table. Holds tenant/client business info.

---

## Level 2: Organization Assets (Child of Organizations)
Each organization has these tables:
1. [[Warehouses]] - Physical sites owned by the organization.
2. [[Warehouse Configs]] - Per-site operational rule toggles (staging requirements, putaway strategy, mixed-SKU rules).
3. [[Employees]] - Workers hired by the organization (Admins, Drivers, Pickers).

---

## Level 2.5: Bridges (Many-to-Many Junctions)
1. [[Employee Licenses]] - Which MHE license classes an employee holds.
2. [[Employee Departments]] - Which department(s) an employee belongs to.

---

## Level 3: Warehouse & Business Infrastructure (Child of Warehouses/Organizations)
1. [[Locations]] - The physical layout (e.g., Aisle-Bay-Shelf-Bin) within this specific warehouse.
2. [[Items]] - Product master registry (dimensions, weight, hazard class, SKU/barcode).
3. [[Inventory]] - The live-balance table: which item is in which location, in what quantity.
4. [[Pallets]] - Master registry of LPNs (License Plate Numbers) tracking physical unit loads.
5. [[Stock Movements]] - Immutable ledger tracking every time an item is received, moved, or shipped.
6. [[Departments]] - Operational divisions within a warehouse (Picking, Receiving, etc.).
7. [[Suppliers]] - Vendor master data for inbound goods.
8. [[Customers]] - Customer master data for outbound orders.
9. [[Carriers]] - Freight/shipping provider master data.
10. [[Purchase Orders]] / [[Purchase Order Lines]] - Inbound order headers and line items.
11. [[Sales Orders]] / [[Sales Order Lines]] - Outbound order headers and line items.
12. [[Shipments]] - Outbound dispatch headers (a shipment can consolidate multiple sales orders).

---

## Level 4: Operations (Task Engine)

### Core Engine
* [[Tasks]] - Unified state engine shared by every type of warehouse work.
* [[Task Eligible Departments]] - Which departments a pending task is routed to.

### Inbound Operations
* [[Unloading Tasks]] - Pulling pallets off an incoming trailer.
* [[Booking Tasks]] - Cargo reception and auditing.
* [[Putaway Tasks]] - Moving received pallets to permanent storage.

### Outbound Operations
* [[Picking Tasks]] - Retrieving inventory to fulfill shipments.
* [[Loading Tasks]] - Loading staged cargo onto an outbound trailer.

### Internal Operations
* [[Replenishment Tasks]] - Refilling active picking faces from bulk/reserve storage.
* [[Cycle Count Tasks]] - Auditing physical stock counts against system counts.

### Labor Operations
* [[Time Clock Entries]] - Employee clock-in/clock-out attendance ledger.

---

## Lookup Tables
* [[Inventory Status Types]] * [[MHE Types]] * [[Position Types]] * [[Task Status Types]] * [[Task Types]] * [[Zone Types]]

---

## 🔐 Multi-Tenant Integrity

This is a shared-database, shared-schema multi-tenant platform: every tenant's rows live in the same tables, separated only by `organization_id` (directly, or inherited via `warehouse_id`). A plain single-column foreign key only proves a referenced row *exists* — it does **not** prove that row belongs to the same tenant as the row referencing it. That gap was the single biggest risk found in this audit, and is fixed as follows:

1. **Anchor tables expose a composite unique key**, not just their surrogate PK:
   ```sql
   ALTER TABLE warehouses ADD CONSTRAINT uq_warehouses_org_wh UNIQUE (organization_id, warehouse_id);
   ALTER TABLE customers  ADD CONSTRAINT uq_customers_org_customer UNIQUE (organization_id, customer_id);
   ALTER TABLE suppliers  ADD CONSTRAINT uq_suppliers_org_supplier UNIQUE (organization_id, supplier_id);
   ALTER TABLE carriers   ADD CONSTRAINT uq_carriers_org_carrier UNIQUE (organization_id, carrier_id);
   ```
2. **Every child row that carries both an `organization_id` and a reference to one of those anchors uses a composite FK instead of a single-column FK**, e.g.:
   ```sql
   -- employees → warehouses
   ALTER TABLE employees
     ADD CONSTRAINT fk_employees_primary_wh
       FOREIGN KEY (organization_id, primary_warehouse_id)
       REFERENCES warehouses (organization_id, warehouse_id) ON DELETE SET NULL;

   -- sales_orders → warehouses / customers / carriers
   ALTER TABLE sales_orders
     ADD CONSTRAINT fk_so_warehouse FOREIGN KEY (organization_id, warehouse_id)  REFERENCES warehouses (organization_id, warehouse_id),
     ADD CONSTRAINT fk_so_customer  FOREIGN KEY (organization_id, customer_id)  REFERENCES customers  (organization_id, customer_id),
     ADD CONSTRAINT fk_so_carrier   FOREIGN KEY (organization_id, carrier_id)   REFERENCES carriers   (organization_id, carrier_id);

   -- purchase_orders → warehouses / suppliers
   ALTER TABLE purchase_orders
     ADD CONSTRAINT fk_po_warehouse FOREIGN KEY (organization_id, warehouse_id) REFERENCES warehouses (organization_id, warehouse_id),
     ADD CONSTRAINT fk_po_supplier  FOREIGN KEY (organization_id, supplier_id)  REFERENCES suppliers  (organization_id, supplier_id);

   -- shipments → warehouses / carriers
   ALTER TABLE shipments
     ADD CONSTRAINT fk_shipments_warehouse FOREIGN KEY (organization_id, warehouse_id) REFERENCES warehouses (organization_id, warehouse_id),
     ADD CONSTRAINT fk_shipments_carrier   FOREIGN KEY (organization_id, carrier_id)   REFERENCES carriers   (organization_id, carrier_id);
   ```
   For nullable columns (e.g. `carrier_id`), Postgres's default `MATCH SIMPLE` behavior skips the composite check whenever any column in the pair is `NULL`, so this doesn't force a carrier to be chosen early.
3. **Tables scoped by `warehouse_id` alone don't need this pattern** — `locations`, `zones`, `departments`, `inventory`, `pallets`, and every Task table inherit their tenant automatically because a `warehouse_id` can only ever belong to one `organization_id`. The risk only exists where a row stores **two or more** tenant-adjacent references side by side (an org + a warehouse, or an org + a customer/supplier/carrier) that could, in theory, disagree.
4. **`items`** was found with no `organization_id` at all and a globally-unique `sku` — fixed by adding `organization_id` and scoping `UNIQUE (organization_id, sku)`, since `item_id` is already the single global key referenced everywhere else (no composite FK propagation needed downstream).
5. **`tasks`** gained a denormalized `warehouse_id` for the same reason `sales_orders` gained `organization_id` — without it, "list tasks for warehouse X" required joining through whichever child table happened to carry a `location_id`.

See the "🧠 Architectural Rules & Notes" section on each affected table for the exact SQL fix applied there.