import { pgTable,pgSchema, unique, serial, varchar, boolean, timestamp, foreignKey, integer, uuid, date, index, text, numeric, check, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const authSchema = pgSchema('auth');

export const users = authSchema.table('users', {
  id: uuid('id').primaryKey().notNull(),
});


export const organizations = pgTable("organizations", {
	organizationId: serial("organization_id").primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	unique("organizations_name_key").on(table.name),
]);

export const warehouses = pgTable("warehouses", {
	warehouseId: serial("warehouse_id").primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	configId: integer("config_id"),
	name: varchar({ length: 100 }),
	street: varchar({ length: 100 }),
	city: varchar({ length: 50 }),
	postalCode: varchar("postal_code", { length: 20 }),
	country: varchar({ length: 50 }),
	timezone: varchar({ length: 50 }),
	isActive: boolean("is_active").default(true),
}, (table) => [
	foreignKey({
			columns: [table.configId],
			foreignColumns: [warehouseConfigs.configId],
			name: "warehouses_config_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.organizationId],
			name: "warehouses_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_warehouses_org_wh").on(table.warehouseId, table.organizationId),
	unique("warehouses_config_id_key").on(table.configId),
]);

export const employees = pgTable("employees", {
	employeeId: serial("employee_id").primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	authUserId: uuid("auth_user_id"),
	workEmail: varchar("work_email", { length: 150 }).notNull(),
	firstName: varchar("first_name", { length: 50 }),
	middleName: varchar("middle_name", { length: 50 }),
	lastName: varchar("last_name", { length: 50 }),
	profilePictureUrl: varchar("profile_picture_url", { length: 255 }),
	positionId: integer("position_id"),
	primaryWarehouseId: integer("primary_warehouse_id"),
	currentWarehouseId: integer("current_warehouse_id"),
	isActive: boolean("is_active").default(true),
	hireDate: date("hire_date"),
	terminationDate: date("termination_date"),
	lastLoginAt: timestamp("last_login_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	foreignKey({
			columns: [table.authUserId],
			foreignColumns: [users.id],
			name: "employees_auth_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.currentWarehouseId],
			foreignColumns: [warehouses.warehouseId],
			name: "employees_current_warehouse_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.organizationId],
			name: "employees_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.positionId],
			foreignColumns: [positionTypes.positionId],
			name: "employees_position_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.primaryWarehouseId],
			foreignColumns: [warehouses.warehouseId],
			name: "employees_primary_warehouse_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.organizationId, table.currentWarehouseId],
			foreignColumns: [warehouses.warehouseId, warehouses.organizationId],
			name: "fk_employees_current_wh"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.organizationId, table.primaryWarehouseId],
			foreignColumns: [warehouses.warehouseId, warehouses.organizationId],
			name: "fk_employees_primary_wh"
		}).onDelete("set null"),
	unique("employees_auth_user_id_key").on(table.authUserId),
	unique("employees_work_email_key").on(table.workEmail),
]);

export const items = pgTable("items", {
	itemId: serial("item_id").primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	sku: varchar({ length: 50 }).notNull(),
	barcode: varchar({ length: 128 }),
	name: varchar({ length: 150 }).notNull(),
	description: text(),
	category: varchar({ length: 50 }),
	lengthCm: numeric("length_cm", { precision: 10, scale:  2 }).default('0.00').notNull(),
	widthCm: numeric("width_cm", { precision: 10, scale:  2 }).default('0.00').notNull(),
	heightCm: numeric("height_cm", { precision: 10, scale:  2 }).default('0.00').notNull(),
	weightKg: numeric("weight_kg", { precision: 10, scale:  3 }).default('0.000').notNull(),
	hazardClass: varchar("hazard_class", { length: 20 }).default('None'),
	isBatchTracked: boolean("is_batch_tracked").default(false).notNull(),
	isLotTracked: boolean("is_lot_tracked").default(false).notNull(),
	hasExpiry: boolean("has_expiry").default(false).notNull(),
	shelfLifeDays: integer("shelf_life_days"),
	minStockLevel: integer("min_stock_level").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_items_category").using("btree", table.category.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.organizationId],
			name: "items_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_items_org_sku").on(table.organizationId, table.sku),
	unique("items_barcode_key").on(table.barcode),
]);

export const customers = pgTable("customers", {
	customerId: serial("customer_id").primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	name: varchar({ length: 150 }).notNull(),
	contactEmail: varchar("contact_email", { length: 150 }),
	contactPhone: varchar("contact_phone", { length: 30 }),
	defaultShippingAddress: text("default_shipping_address"),
	isActive: boolean("is_active").default(true),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.organizationId],
			name: "customers_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_customers_org_customer").on(table.customerId, table.organizationId),
]);

export const suppliers = pgTable("suppliers", {
	supplierId: serial("supplier_id").primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	name: varchar({ length: 150 }).notNull(),
	contactName: varchar("contact_name", { length: 100 }),
	contactEmail: varchar("contact_email", { length: 150 }),
	contactPhone: varchar("contact_phone", { length: 30 }),
	address: text(),
	leadTimeDays: integer("lead_time_days"),
	isActive: boolean("is_active").default(true),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.organizationId],
			name: "suppliers_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_suppliers_org_supplier").on(table.supplierId, table.organizationId),
]);

export const carriers = pgTable("carriers", {
	carrierId: serial("carrier_id").primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	scacCode: varchar("scac_code", { length: 10 }),
	trackingUrlTemplate: varchar("tracking_url_template", { length: 255 }),
	isActive: boolean("is_active").default(true),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.organizationId],
			name: "carriers_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_carriers_org_carrier").on(table.carrierId, table.organizationId),
	unique("uq_carriers_org_name").on(table.organizationId, table.name),
]);

export const purchaseOrders = pgTable("purchase_orders", {
	poId: serial("po_id").primaryKey().notNull(),
	poNumber: varchar("po_number", { length: 50 }).notNull(),
	organizationId: integer("organization_id").notNull(),
	warehouseId: integer("warehouse_id").notNull(),
	supplierId: integer("supplier_id").notNull(),
	status: varchar({ length: 20 }).default('Draft'),
	expectedDate: date("expected_date"),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_po_supplier").using("btree", table.supplierId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId, table.supplierId],
			foreignColumns: [suppliers.supplierId, suppliers.organizationId],
			name: "fk_po_supplier"
		}),
	foreignKey({
			columns: [table.organizationId, table.warehouseId],
			foreignColumns: [warehouses.warehouseId, warehouses.organizationId],
			name: "fk_po_warehouse"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.organizationId],
			name: "purchase_orders_organization_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.supplierId],
			foreignColumns: [suppliers.supplierId],
			name: "purchase_orders_supplier_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouses.warehouseId],
			name: "purchase_orders_warehouse_id_fkey"
		}).onDelete("restrict"),
	unique("purchase_orders_po_number_key").on(table.poNumber),
]);

export const salesOrders = pgTable("sales_orders", {
	soId: serial("so_id").primaryKey().notNull(),
	soNumber: varchar("so_number", { length: 50 }).notNull(),
	organizationId: integer("organization_id").notNull(),
	warehouseId: integer("warehouse_id").notNull(),
	customerId: integer("customer_id").notNull(),
	shippingAddress: text("shipping_address").notNull(),
	status: varchar({ length: 20 }).default('Pending'),
	carrierId: integer("carrier_id"),
	trackingNumber: varchar("tracking_number", { length: 100 }),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_so_customer").using("btree", table.customerId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId, table.carrierId],
			foreignColumns: [carriers.carrierId, carriers.organizationId],
			name: "fk_so_carrier"
		}),
	foreignKey({
			columns: [table.organizationId, table.customerId],
			foreignColumns: [customers.customerId, customers.organizationId],
			name: "fk_so_customer"
		}),
	foreignKey({
			columns: [table.organizationId, table.warehouseId],
			foreignColumns: [warehouses.warehouseId, warehouses.organizationId],
			name: "fk_so_warehouse"
		}),
	foreignKey({
			columns: [table.carrierId],
			foreignColumns: [carriers.carrierId],
			name: "sales_orders_carrier_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.customerId],
			name: "sales_orders_customer_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.organizationId],
			name: "sales_orders_organization_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouses.warehouseId],
			name: "sales_orders_warehouse_id_fkey"
		}).onDelete("restrict"),
	unique("sales_orders_so_number_key").on(table.soNumber),
]);

export const shipments = pgTable("shipments", {
	shipmentId: uuid("shipment_id").defaultRandom().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	warehouseId: integer("warehouse_id").notNull(),
	carrierId: integer("carrier_id"),
	trailerNumber: varchar("trailer_number", { length: 30 }),
	status: varchar({ length: 20 }).default('STAGING'),
	dispatchedAt: timestamp("dispatched_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	foreignKey({
			columns: [table.organizationId, table.carrierId],
			foreignColumns: [carriers.carrierId, carriers.organizationId],
			name: "fk_shipments_carrier"
		}),
	foreignKey({
			columns: [table.organizationId, table.warehouseId],
			foreignColumns: [warehouses.warehouseId, warehouses.organizationId],
			name: "fk_shipments_warehouse"
		}),
	foreignKey({
			columns: [table.carrierId],
			foreignColumns: [carriers.carrierId],
			name: "shipments_carrier_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.organizationId],
			name: "shipments_organization_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouses.warehouseId],
			name: "shipments_warehouse_id_fkey"
		}).onDelete("restrict"),
]);

export const inventoryStatuses = pgTable("inventory_statuses", {
	statusId: serial("status_id").primaryKey().notNull(),
	organizationId: integer("organization_id"),
	name: varchar({ length: 50 }).notNull(),
	allowAllocation: boolean("allow_allocation").default(true),
	allowMovement: boolean("allow_movement").default(true),
	isSellable: boolean("is_sellable").default(true),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.organizationId],
			name: "inventory_statuses_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_inventory_statuses_org_name").on(table.organizationId, table.name),
]);

export const positionTypes = pgTable("position_types", {
	positionId: serial("position_id").primaryKey().notNull(),
	title: varchar({ length: 50 }).notNull(),
	isOfficeRole: boolean("is_office_role").default(false),
	canViewMetrics: boolean("can_view_metrics").default(false),
	canAssignTasks: boolean("can_assign_tasks").default(false),
	canBook: boolean("can_book").default(false),
	canUnload: boolean("can_unload").default(false),
	canLoad: boolean("can_load").default(false),
	canPick: boolean("can_pick").default(false),
	canPack: boolean("can_pack").default(false),
	canModifyInventory: boolean("can_modify_inventory").default(false),
	canOverrideUnexpectedDeliveries: boolean("can_override_unexpected_deliveries").default(false),
	canRegisterDamages: boolean("can_register_damages").default(false),
	canModifyLocations: boolean("can_modify_locations").default(false),
	canReplenish: boolean("can_replenish").default(false),
	canForceRecount: boolean("can_force_recount").default(false),
	canReleaseOrders: boolean("can_release_orders").default(false),
	canVoidShipments: boolean("can_void_shipments").default(false),
	canManageUsers: boolean("can_manage_users").default(false),
	canModifyConfigs: boolean("can_modify_configs").default(false),
}, (table) => [
	unique("position_types_title_key").on(table.title),
]);

export const mheTypes = pgTable("mhe_types", {
	mheTypeId: serial("mhe_type_id").primaryKey().notNull(),
	name: varchar({ length: 50 }).notNull(),
	requiresLicense: boolean("requires_license").default(true),
	maxWeightCapacityKg: integer("max_weight_capacity_kg"),
	maxReachHeightMm: integer("max_reach_height_mm"),
}, (table) => [
	unique("mhe_types_name_key").on(table.name),
]);

export const taskStatuses = pgTable("task_statuses", {
	statusId: serial("status_id").primaryKey().notNull(),
	code: varchar({ length: 20 }).notNull(),
	description: varchar({ length: 100 }),
}, (table) => [
	unique("task_statuses_code_key").on(table.code),
]);

export const taskTypes = pgTable("task_types", {
	taskTypeId: serial("task_type_id").primaryKey().notNull(),
	code: varchar({ length: 30 }).notNull(),
	description: varchar({ length: 100 }),
}, (table) => [
	unique("task_types_code_key").on(table.code),
]);

export const warehouseConfigs = pgTable("warehouse_configs", {
	configId: serial("config_id").primaryKey().notNull(),
	requireStagingBeforePutaway: boolean("require_staging_before_putaway").default(true),
	allowMixedSkuPerLocation: boolean("allow_mixed_sku_per_location").default(false),
	allowMixedLpnPerLocation: boolean("allow_mixed_lpn_per_location").default(true),
	defaultPutawayStrategy: varchar("default_putaway_strategy", { length: 20 }).default('NEAREST_EMPTY'),
	cycleCountFrequencyDays: integer("cycle_count_frequency_days"),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
});

export const departments = pgTable("departments", {
	departmentId: serial("department_id").primaryKey().notNull(),
	warehouseId: integer("warehouse_id"),
	departmentName: varchar("department_name", { length: 100 }).notNull(),
	isCustom: boolean("is_custom").default(false),
	isActive: boolean("is_active").default(true),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouses.warehouseId],
			name: "departments_warehouse_id_fkey"
		}).onDelete("cascade"),
	unique("uq_departments_wh_name").on(table.warehouseId, table.departmentName),
]);

export const inventory = pgTable("inventory", {
	inventoryId: serial("inventory_id").primaryKey().notNull(),
	locationId: integer("location_id"),
	itemId: integer("item_id"),
	quantity: integer(),
	batchNumber: varchar("batch_number", { length: 50 }),
	lotNumber: varchar("lot_number", { length: 50 }),
	expiryDate: date("expiry_date"),
	statusId: integer("status_id"),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_inventory_item").using("btree", table.itemId.asc().nullsLast().op("int4_ops")),
	index("idx_inventory_location").using("btree", table.locationId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [items.itemId],
			name: "inventory_item_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.locationId],
			foreignColumns: [locations.locationId],
			name: "inventory_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.statusId],
			foreignColumns: [inventoryStatuses.statusId],
			name: "inventory_status_id_fkey"
		}).onDelete("restrict"),
	unique("uq_inventory_location_item_batch_lot").on(table.locationId, table.itemId, table.batchNumber, table.lotNumber),
	check("inventory_quantity_check", sql`quantity >= 0`),
]);

export const pallets = pgTable("pallets", {
	lpnId: varchar("lpn_id", { length: 50 }).primaryKey().notNull(),
	warehouseId: integer("warehouse_id"),
	currentLocationId: integer("current_location_id"),
	status: varchar({ length: 20 }).default('ACTIVE'),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	foreignKey({
			columns: [table.currentLocationId],
			foreignColumns: [locations.locationId],
			name: "pallets_current_location_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouses.warehouseId],
			name: "pallets_warehouse_id_fkey"
		}).onDelete("cascade"),
]);

export const purchaseOrderLines = pgTable("purchase_order_lines", {
	poLineId: serial("po_line_id").primaryKey().notNull(),
	poId: integer("po_id").notNull(),
	itemId: integer("item_id").notNull(),
	quantityOrdered: integer("quantity_ordered").notNull(),
	quantityReceived: integer("quantity_received").default(0),
	batchNumber: varchar("batch_number", { length: 50 }),
	lotNumber: varchar("lot_number", { length: 50 }),
	expiryDate: date("expiry_date"),
	unitCost: numeric("unit_cost", { precision: 10, scale:  2 }),
}, (table) => [
	index("idx_pol_item").using("btree", table.itemId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [items.itemId],
			name: "purchase_order_lines_item_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.poId],
			foreignColumns: [purchaseOrders.poId],
			name: "purchase_order_lines_po_id_fkey"
		}).onDelete("cascade"),
	check("purchase_order_lines_quantity_ordered_check", sql`quantity_ordered > 0`),
	check("purchase_order_lines_quantity_received_check", sql`quantity_received >= 0`),
	check("purchase_order_lines_unit_cost_check", sql`unit_cost >= (0)::numeric`),
]);

export const salesOrderLines = pgTable("sales_order_lines", {
	soLineId: serial("so_line_id").primaryKey().notNull(),
	soId: integer("so_id").notNull(),
	itemId: integer("item_id").notNull(),
	quantityRequested: integer("quantity_requested").notNull(),
	batchNumber: varchar("batch_number", { length: 50 }),
	lotNumber: varchar("lot_number", { length: 50 }),
	expiryDate: date("expiry_date"),
	quantityAllocated: integer("quantity_allocated").default(0),
	quantityShipped: integer("quantity_shipped").default(0),
}, (table) => [
	index("idx_sol_item").using("btree", table.itemId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [items.itemId],
			name: "sales_order_lines_item_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.soId],
			foreignColumns: [salesOrders.soId],
			name: "sales_order_lines_so_id_fkey"
		}).onDelete("cascade"),
	check("sales_order_lines_check", sql`(quantity_shipped >= 0) AND (quantity_shipped <= quantity_allocated)`),
	check("sales_order_lines_quantity_allocated_check", sql`quantity_allocated >= 0`),
	check("sales_order_lines_quantity_requested_check", sql`quantity_requested > 0`),
]);

export const stockMovements = pgTable("stock_movements", {
	movementId: serial("movement_id").primaryKey().notNull(),
	employeeId: integer("employee_id"),
	itemId: integer("item_id"),
	batchNumber: varchar("batch_number", { length: 50 }),
	lotNumber: varchar("lot_number", { length: 50 }),
	expiryDate: date("expiry_date"),
	quantity: integer().notNull(),
	sourceLocationId: integer("source_location_id"),
	destinationLocationId: integer("destination_location_id"),
	movementType: varchar("movement_type", { length: 30 }).notNull(),
	reasonCode: varchar("reason_code", { length: 50 }),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_stock_movements_created").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("idx_stock_movements_item").using("btree", table.itemId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.destinationLocationId],
			foreignColumns: [locations.locationId],
			name: "stock_movements_destination_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.employeeId],
			name: "stock_movements_employee_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [items.itemId],
			name: "stock_movements_item_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.sourceLocationId],
			foreignColumns: [locations.locationId],
			name: "stock_movements_source_location_id_fkey"
		}).onDelete("restrict"),
	check("stock_movements_quantity_check", sql`quantity > 0`),
]);

export const tasks = pgTable("tasks", {
	taskId: uuid("task_id").defaultRandom().primaryKey().notNull(),
	warehouseId: integer("warehouse_id").notNull(),
	taskTypeId: integer("task_type_id").notNull(),
	statusId: integer("status_id").notNull(),
	priority: integer().default(100).notNull(),
	assignedEmployeeId: integer("assigned_employee_id"),
	mheTypeRequired: integer("mhe_type_required"),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
}, (table) => [
	index("idx_tasks_assigned_employee").using("btree", table.assignedEmployeeId.asc().nullsLast().op("int4_ops")),
	index("idx_tasks_warehouse_status").using("btree", table.warehouseId.asc().nullsLast().op("int4_ops"), table.statusId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.assignedEmployeeId],
			foreignColumns: [employees.employeeId],
			name: "tasks_assigned_employee_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.mheTypeRequired],
			foreignColumns: [mheTypes.mheTypeId],
			name: "tasks_mhe_type_required_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.statusId],
			foreignColumns: [taskStatuses.statusId],
			name: "tasks_status_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.taskTypeId],
			foreignColumns: [taskTypes.taskTypeId],
			name: "tasks_task_type_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouses.warehouseId],
			name: "tasks_warehouse_id_fkey"
		}).onDelete("restrict"),
]);

export const bookingTasks = pgTable("booking_tasks", {
	taskId: uuid("task_id").primaryKey().notNull(),
	dockDoorLocationId: integer("dock_door_location_id").notNull(),
	palletHeightCm: integer("pallet_height_cm").notNull(),
	itemId: integer("item_id").notNull(),
	productType: varchar("product_type", { length: 50 }).notNull(),
	productQuantity: integer("product_quantity").notNull(),
	batchNumber: varchar("batch_number", { length: 50 }),
	lotNumber: varchar("lot_number", { length: 50 }),
	expiryDate: date("expiry_date"),
}, (table) => [
	foreignKey({
			columns: [table.dockDoorLocationId],
			foreignColumns: [locations.locationId],
			name: "booking_tasks_dock_door_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [items.itemId],
			name: "booking_tasks_item_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [tasks.taskId],
			name: "booking_tasks_task_id_fkey"
		}).onDelete("cascade"),
	check("booking_tasks_product_quantity_check", sql`product_quantity > 0`),
]);

export const putawayTasks = pgTable("putaway_tasks", {
	taskId: uuid("task_id").primaryKey().notNull(),
	lpnId: varchar("lpn_id", { length: 50 }).notNull(),
	sourceLocationId: integer("source_location_id").notNull(),
	suggestedDestLocationId: integer("suggested_dest_location_id").notNull(),
	actualDestLocationId: integer("actual_dest_location_id"),
}, (table) => [
	foreignKey({
			columns: [table.actualDestLocationId],
			foreignColumns: [locations.locationId],
			name: "putaway_tasks_actual_dest_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.lpnId],
			foreignColumns: [pallets.lpnId],
			name: "putaway_tasks_lpn_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.sourceLocationId],
			foreignColumns: [locations.locationId],
			name: "putaway_tasks_source_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.suggestedDestLocationId],
			foreignColumns: [locations.locationId],
			name: "putaway_tasks_suggested_dest_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [tasks.taskId],
			name: "putaway_tasks_task_id_fkey"
		}).onDelete("cascade"),
]);

export const unloadingTasks = pgTable("unloading_tasks", {
	taskId: uuid("task_id").primaryKey().notNull(),
	dockDoorLocationId: integer("dock_door_location_id").notNull(),
	trailerNumber: varchar("trailer_number", { length: 30 }),
	expectedPallets: integer("expected_pallets").notNull(),
	carrierId: integer("carrier_id"),
}, (table) => [
	foreignKey({
			columns: [table.carrierId],
			foreignColumns: [carriers.carrierId],
			name: "unloading_tasks_carrier_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.dockDoorLocationId],
			foreignColumns: [locations.locationId],
			name: "unloading_tasks_dock_door_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [tasks.taskId],
			name: "unloading_tasks_task_id_fkey"
		}).onDelete("cascade"),
	check("unloading_tasks_expected_pallets_check", sql`expected_pallets > 0`),
]);

export const pickingTasks = pgTable("picking_tasks", {
	taskId: uuid("task_id").primaryKey().notNull(),
	pickLocationId: integer("pick_location_id").notNull(),
	itemId: integer("item_id").notNull(),
	batchNumber: varchar("batch_number", { length: 50 }),
	lotNumber: varchar("lot_number", { length: 50 }),
	pickQuantity: integer("pick_quantity").notNull(),
	lpnId: varchar("lpn_id", { length: 50 }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [items.itemId],
			name: "picking_tasks_item_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.lpnId],
			foreignColumns: [pallets.lpnId],
			name: "picking_tasks_lpn_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.pickLocationId],
			foreignColumns: [locations.locationId],
			name: "picking_tasks_pick_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [tasks.taskId],
			name: "picking_tasks_task_id_fkey"
		}).onDelete("cascade"),
	check("picking_tasks_pick_quantity_check", sql`pick_quantity > 0`),
]);

export const loadingTasks = pgTable("loading_tasks", {
	taskId: uuid("task_id").primaryKey().notNull(),
	dockDoorLocationId: integer("dock_door_location_id").notNull(),
	lpnId: varchar("lpn_id", { length: 50 }).notNull(),
	shipmentId: uuid("shipment_id").notNull(),
	sequenceNumber: integer("sequence_number").default(1).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.dockDoorLocationId],
			foreignColumns: [locations.locationId],
			name: "loading_tasks_dock_door_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.lpnId],
			foreignColumns: [pallets.lpnId],
			name: "loading_tasks_lpn_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.shipmentId],
			foreignColumns: [shipments.shipmentId],
			name: "loading_tasks_shipment_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [tasks.taskId],
			name: "loading_tasks_task_id_fkey"
		}).onDelete("cascade"),
]);

export const replenishmentTasks = pgTable("replenishment_tasks", {
	taskId: uuid("task_id").primaryKey().notNull(),
	itemId: integer("item_id").notNull(),
	batchNumber: varchar("batch_number", { length: 50 }),
	lotNumber: varchar("lot_number", { length: 50 }),
	sourceLocationId: integer("source_location_id").notNull(),
	destinationLocationId: integer("destination_location_id").notNull(),
	quantity: integer().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.destinationLocationId],
			foreignColumns: [locations.locationId],
			name: "replenishment_tasks_destination_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [items.itemId],
			name: "replenishment_tasks_item_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.sourceLocationId],
			foreignColumns: [locations.locationId],
			name: "replenishment_tasks_source_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [tasks.taskId],
			name: "replenishment_tasks_task_id_fkey"
		}).onDelete("cascade"),
	check("replenishment_tasks_quantity_check", sql`quantity > 0`),
]);

export const cycleCountTasks = pgTable("cycle_count_tasks", {
	taskId: uuid("task_id").primaryKey().notNull(),
	locationId: integer("location_id").notNull(),
	itemId: integer("item_id").notNull(),
	batchNumber: varchar("batch_number", { length: 50 }),
	lotNumber: varchar("lot_number", { length: 50 }),
	expectedQuantity: integer("expected_quantity").notNull(),
	countedQuantity: integer("counted_quantity"),
}, (table) => [
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [items.itemId],
			name: "cycle_count_tasks_item_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.locationId],
			foreignColumns: [locations.locationId],
			name: "cycle_count_tasks_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [tasks.taskId],
			name: "cycle_count_tasks_task_id_fkey"
		}).onDelete("cascade"),
	check("cycle_count_tasks_counted_quantity_check", sql`counted_quantity >= 0`),
]);

export const timeClockEntries = pgTable("time_clock_entries", {
	timeClockId: serial("time_clock_id").primaryKey().notNull(),
	employeeId: integer("employee_id"),
	warehouseId: integer("warehouse_id"),
	clockInAt: timestamp("clock_in_at", { mode: 'string' }).notNull(),
	clockOutAt: timestamp("clock_out_at", { mode: 'string' }),
	breakMinutes: integer("break_minutes").default(0),
	source: varchar({ length: 20 }).default('TERMINAL'),
	editedByEmployeeId: integer("edited_by_employee_id"),
}, (table) => [
	index("idx_time_clock_employee").using("btree", table.employeeId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.editedByEmployeeId],
			foreignColumns: [employees.employeeId],
			name: "time_clock_entries_edited_by_employee_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.employeeId],
			name: "time_clock_entries_employee_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouses.warehouseId],
			name: "time_clock_entries_warehouse_id_fkey"
		}).onDelete("restrict"),
]);

export const zoneTypes = pgTable("zone_types", {
	zoneId: serial("zone_id").primaryKey().notNull(),
	warehouseId: integer("warehouse_id"),
	name: varchar({ length: 50 }).notNull(),
	isPickable: boolean("is_pickable").default(true),
	isTemperatureControlled: boolean("is_temperature_controlled").default(false),
	requiresHazmatClearance: boolean("requires_hazmat_clearance").default(false),
	requiresBarcodeScan: boolean("requires_barcode_scan").default(true).notNull(),
	storagePermanence: varchar("storage_permanence", { length: 20 }).default('PERMANENT').notNull(),
}, (table) => [
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouses.warehouseId],
			name: "zones_warehouse_id_fkey"
		}).onDelete("cascade"),
	unique("uq_zones_wh_name").on(table.warehouseId, table.name),
	check("chk_storage_permanence", sql`(storage_permanence)::text = ANY ((ARRAY['PERMANENT'::character varying, 'TEMPORARY'::character varying, 'FLUID_BUFFER'::character varying])::text[])`),
]);

export const locations = pgTable("locations", {
	locationId: serial("location_id").primaryKey().notNull(),
	warehouseId: integer("warehouse_id"),
	zoneId: integer("zone_id"),
	locationCode: varchar("location_code", { length: 50 }).notNull(),
	aisle: integer(),
	bay: integer(),
	level: integer(),
	position: integer(),
	heightMm: integer("height_mm"),
	maxWeightKg: integer("max_weight_kg"),
	isBlocked: boolean("is_blocked").default(false),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	physicalX: integer("physical_x").default(0).notNull(),
	physicalY: integer("physical_y").default(0).notNull(),
	physicalWidthMm: integer("physical_width_mm").default(0).notNull(),
	physicalLengthMm: integer("physical_length_mm").default(0).notNull(),
	rotationDegrees: integer("rotation_degrees").default(0).notNull(),
	floorLevel: integer("floor_level").default(1).notNull(),
}, (table) => [
	index("idx_locations_canvas_render").using("btree", table.warehouseId.asc().nullsLast().op("int4_ops"), table.floorLevel.asc().nullsLast().op("int4_ops"), table.physicalX.asc().nullsLast().op("int4_ops"), table.physicalY.asc().nullsLast().op("int4_ops")).where(sql`(is_blocked = false)`),
	index("idx_locations_zone_lookup").using("btree", table.warehouseId.asc().nullsLast().op("int4_ops"), table.zoneId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouses.warehouseId],
			name: "locations_warehouse_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.zoneId],
			foreignColumns: [zoneTypes.zoneId],
			name: "locations_zone_id_fkey"
		}).onDelete("restrict"),
	unique("locations_location_code_key").on(table.locationCode),
	check("chk_rotation_range", sql`(rotation_degrees >= 0) AND (rotation_degrees < 360)`),
]);

export const shipmentSalesOrders = pgTable("shipment_sales_orders", {
	shipmentId: uuid("shipment_id").notNull(),
	soId: integer("so_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.shipmentId],
			foreignColumns: [shipments.shipmentId],
			name: "shipment_sales_orders_shipment_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.soId],
			foreignColumns: [salesOrders.soId],
			name: "shipment_sales_orders_so_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.shipmentId, table.soId], name: "shipment_sales_orders_pkey"}),
]);

export const taskEligibleDepartments = pgTable("task_eligible_departments", {
	taskId: uuid("task_id").notNull(),
	departmentId: integer("department_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.departmentId],
			foreignColumns: [departments.departmentId],
			name: "task_eligible_departments_department_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [tasks.taskId],
			name: "task_eligible_departments_task_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.taskId, table.departmentId], name: "task_eligible_departments_pkey"}),
]);

export const employeeDepartments = pgTable("employee_departments", {
	employeeId: integer("employee_id").notNull(),
	departmentId: integer("department_id").notNull(),
	isPrimary: boolean("is_primary").default(false),
	assignedAt: timestamp("assigned_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	foreignKey({
			columns: [table.departmentId],
			foreignColumns: [departments.departmentId],
			name: "employee_departments_department_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.employeeId],
			name: "employee_departments_employee_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.employeeId, table.departmentId], name: "employee_departments_pkey"}),
]);

export const employeeLicenses = pgTable("employee_licenses", {
	employeeId: integer("employee_id").notNull(),
	mheTypeId: integer("mhe_type_id").notNull(),
	issuedDate: date("issued_date"),
	expiryDate: date("expiry_date"),
}, (table) => [
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.employeeId],
			name: "employee_licenses_employee_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.mheTypeId],
			foreignColumns: [mheTypes.mheTypeId],
			name: "employee_licenses_mhe_type_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.employeeId, table.mheTypeId], name: "employee_licenses_pkey"}),
]);
