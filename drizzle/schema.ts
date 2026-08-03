import {
  pgTable,
  pgSchema,
  unique,
  serial,
  varchar,
  boolean,
  timestamp,
  foreignKey,
  integer,
  uuid,
  date,
  index,
  text,
  numeric,
  jsonb,
  bigint,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
export const authSchema = pgSchema("auth");

export const users = authSchema.table("users", {
  id: uuid("id").primaryKey().notNull(),
});

export const organizations = pgTable(
  "organizations",
  {
    organizationId: serial("organization_id").primaryKey().notNull(),
    name: varchar({ length: 100 }).notNull(),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
    updatedAt: timestamp("updated_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [unique("organizations_name_key").on(table.name)],
);

export const warehouses = pgTable(
  "warehouses",
  {
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
  },
  (table) => [
    foreignKey({
      columns: [table.configId],
      foreignColumns: [warehouseConfigs.configId],
      name: "warehouses_config_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.organizationId],
      name: "warehouses_organization_id_fkey",
    }).onDelete("cascade"),
    unique("uq_warehouses_org_wh").on(table.warehouseId, table.organizationId),
    unique("warehouses_config_id_key").on(table.configId),
  ],
);

export const employees = pgTable(
  "employees",
  {
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
    lastLoginAt: timestamp("last_login_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    foreignKey({
      columns: [table.authUserId],
      foreignColumns: [users.id],
      name: "employees_auth_user_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.currentWarehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "employees_current_warehouse_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.organizationId],
      name: "employees_organization_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.positionId],
      foreignColumns: [positionTypes.positionId],
      name: "employees_position_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.primaryWarehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "employees_primary_warehouse_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.organizationId, table.currentWarehouseId],
      foreignColumns: [warehouses.warehouseId, warehouses.organizationId],
      name: "fk_employees_current_wh",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.organizationId, table.primaryWarehouseId],
      foreignColumns: [warehouses.warehouseId, warehouses.organizationId],
      name: "fk_employees_primary_wh",
    }).onDelete("set null"),
    unique("employees_auth_user_id_key").on(table.authUserId),
    unique("employees_work_email_key").on(table.workEmail),
  ],
);

export const items = pgTable(
  "items",
  {
    itemId: serial("item_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    sku: varchar({ length: 50 }).notNull(),
    barcode: varchar({ length: 128 }),
    name: varchar({ length: 150 }).notNull(),
    description: text(),
    category: varchar({ length: 50 }),
    lengthCm: numeric("length_cm", { precision: 10, scale: 2 })
      .default("0.00")
      .notNull(),
    widthCm: numeric("width_cm", { precision: 10, scale: 2 })
      .default("0.00")
      .notNull(),
    heightCm: numeric("height_cm", { precision: 10, scale: 2 })
      .default("0.00")
      .notNull(),
    weightKg: numeric("weight_kg", { precision: 10, scale: 3 })
      .default("0.000")
      .notNull(),
    hazardClass: varchar("hazard_class", { length: 20 }).default("None"),
    isBatchTracked: boolean("is_batch_tracked").default(false).notNull(),
    isLotTracked: boolean("is_lot_tracked").default(false).notNull(),
    hasExpiry: boolean("has_expiry").default(false).notNull(),
    shelfLifeDays: integer("shelf_life_days"),
    minStockLevel: integer("min_stock_level").default(0),
    createdAt: timestamp("created_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
    updatedAt: timestamp("updated_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    index("idx_items_category").using(
      "btree",
      table.category.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.organizationId],
      name: "items_organization_id_fkey",
    }).onDelete("cascade"),
    unique("uq_items_org_sku").on(table.organizationId, table.sku),
    unique("items_barcode_key").on(table.barcode),
  ],
);

export const customers = pgTable(
  "customers",
  {
    customerId: serial("customer_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    name: varchar({ length: 150 }).notNull(),
    contactEmail: varchar("contact_email", { length: 150 }),
    contactPhone: varchar("contact_phone", { length: 30 }),
    defaultShippingAddress: text("default_shipping_address"),
    isActive: boolean("is_active").default(true),
    updatedAt: timestamp("updated_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.organizationId],
      name: "customers_organization_id_fkey",
    }).onDelete("cascade"),
    unique("uq_customers_org_customer").on(
      table.customerId,
      table.organizationId,
    ),
  ],
);

export const suppliers = pgTable(
  "suppliers",
  {
    supplierId: serial("supplier_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    name: varchar({ length: 150 }).notNull(),
    contactName: varchar("contact_name", { length: 100 }),
    contactEmail: varchar("contact_email", { length: 150 }),
    contactPhone: varchar("contact_phone", { length: 30 }),
    address: text(),
    leadTimeDays: integer("lead_time_days"),
    isActive: boolean("is_active").default(true),
    updatedAt: timestamp("updated_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.organizationId],
      name: "suppliers_organization_id_fkey",
    }).onDelete("cascade"),
    unique("uq_suppliers_org_supplier").on(
      table.supplierId,
      table.organizationId,
    ),
  ],
);

export const carriers = pgTable(
  "carriers",
  {
    carrierId: serial("carrier_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    name: varchar({ length: 100 }).notNull(),
    scacCode: varchar("scac_code", { length: 10 }),
    trackingUrlTemplate: varchar("tracking_url_template", { length: 255 }),
    isActive: boolean("is_active").default(true),
    updatedAt: timestamp("updated_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.organizationId],
      name: "carriers_organization_id_fkey",
    }).onDelete("cascade"),
    unique("uq_carriers_org_carrier").on(table.carrierId, table.organizationId),
    unique("uq_carriers_org_name").on(table.organizationId, table.name),
  ],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    poId: serial("po_id").primaryKey().notNull(),
    poNumber: varchar("po_number", { length: 50 }).notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    supplierId: integer("supplier_id").notNull(),
    status: varchar({ length: 20 }).default("Draft"),
    expectedDate: date("expected_date"),
    createdAt: timestamp("created_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
    updatedAt: timestamp("updated_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    index("idx_po_supplier").using(
      "btree",
      table.supplierId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.organizationId, table.supplierId],
      foreignColumns: [suppliers.supplierId, suppliers.organizationId],
      name: "fk_po_supplier",
    }),
    foreignKey({
      columns: [table.organizationId, table.warehouseId],
      foreignColumns: [warehouses.warehouseId, warehouses.organizationId],
      name: "fk_po_warehouse",
    }),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.organizationId],
      name: "purchase_orders_organization_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.supplierId],
      foreignColumns: [suppliers.supplierId],
      name: "purchase_orders_supplier_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "purchase_orders_warehouse_id_fkey",
    }).onDelete("restrict"),
    unique("purchase_orders_po_number_key").on(table.poNumber),
  ],
);

export const salesOrders = pgTable(
  "sales_orders",
  {
    soId: serial("so_id").primaryKey().notNull(),
    soNumber: varchar("so_number", { length: 50 }).notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    customerId: integer("customer_id").notNull(),
    shippingAddress: text("shipping_address").notNull(),
    status: varchar({ length: 20 }).default("Pending"),
    carrierId: integer("carrier_id"),
    trackingNumber: varchar("tracking_number", { length: 100 }),
    createdAt: timestamp("created_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
    updatedAt: timestamp("updated_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    index("idx_so_customer").using(
      "btree",
      table.customerId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.organizationId, table.carrierId],
      foreignColumns: [carriers.carrierId, carriers.organizationId],
      name: "fk_so_carrier",
    }),
    foreignKey({
      columns: [table.organizationId, table.customerId],
      foreignColumns: [customers.customerId, customers.organizationId],
      name: "fk_so_customer",
    }),
    foreignKey({
      columns: [table.organizationId, table.warehouseId],
      foreignColumns: [warehouses.warehouseId, warehouses.organizationId],
      name: "fk_so_warehouse",
    }),
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.carrierId],
      name: "sales_orders_carrier_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.customerId],
      name: "sales_orders_customer_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.organizationId],
      name: "sales_orders_organization_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "sales_orders_warehouse_id_fkey",
    }).onDelete("restrict"),
    unique("sales_orders_so_number_key").on(table.soNumber),
  ],
);

export const shipments = pgTable(
  "shipments",
  {
    shipmentId: uuid("shipment_id").defaultRandom().primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    carrierId: integer("carrier_id"),
    trailerNumber: varchar("trailer_number", { length: 30 }),
    status: varchar({ length: 20 }).default("STAGING"),
    dispatchedAt: timestamp("dispatched_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.carrierId],
      foreignColumns: [carriers.carrierId, carriers.organizationId],
      name: "fk_shipments_carrier",
    }),
    foreignKey({
      columns: [table.organizationId, table.warehouseId],
      foreignColumns: [warehouses.warehouseId, warehouses.organizationId],
      name: "fk_shipments_warehouse",
    }),
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.carrierId],
      name: "shipments_carrier_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.organizationId],
      name: "shipments_organization_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "shipments_warehouse_id_fkey",
    }).onDelete("restrict"),
  ],
);

export const inventoryStatuses = pgTable(
  "inventory_statuses",
  {
    statusId: serial("status_id").primaryKey().notNull(),
    organizationId: integer("organization_id"),
    name: varchar({ length: 50 }).notNull(),
    allowAllocation: boolean("allow_allocation").default(true),
    allowMovement: boolean("allow_movement").default(true),
    isSellable: boolean("is_sellable").default(true),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.organizationId],
      name: "inventory_statuses_organization_id_fkey",
    }).onDelete("cascade"),
    unique("uq_inventory_statuses_org_name").on(
      table.organizationId,
      table.name,
    ),
  ],
);

export const mheTypes = pgTable(
  "mhe_types",
  {
    mheTypeId: serial("mhe_type_id").primaryKey().notNull(),
    name: varchar({ length: 50 }).notNull(),
    requiresLicense: boolean("requires_license").default(true),
    maxWeightCapacityKg: integer("max_weight_capacity_kg"),
    maxReachHeightMm: integer("max_reach_height_mm"),

    // Capability profile. `class_bit` is this type's position in the vehicle
    // bitmask carried by every edge, which turns "can this vehicle use this
    // lane" into a single mask test rather than a join. Bit 0 is reserved for
    // pedestrians -- "on foot" is a vehicle class, and that is what makes
    // "walkway, no forklifts" and "VNA aisle, no pedestrians" one mechanism.
    classBit: integer("class_bit"),
    isPedestrian: boolean("is_pedestrian").default(false).notNull(),
    widthMm: integer("width_mm"),
    lengthMm: integer("length_mm"),
    heightMm: integer("height_mm"),
    turningRadiusMm: integer("turning_radius_mm"),
    // Right-angle stacking aisle width. Compared against each aisle edge at
    // compile time to catch "we bought reach trucks for a VNA aisle" before
    // it reaches the floor.
    minAisleWidthMm: integer("min_aisle_width_mm"),
    maxSpeedLadenMms: integer("max_speed_laden_mms"),
    maxSpeedUnladenMms: integer("max_speed_unladen_mms"),
  },
  (table) => [
    unique("mhe_types_name_key").on(table.name),
    unique("uq_mhe_types_class_bit").on(table.classBit),
    // Capped at 30, not 52: the mask is manipulated with JS bitwise operators,
    // which coerce to signed 32-bit. `1 << 31` is negative and `1 << 32` wraps
    // to 1, so a bit above 30 would silently alias another vehicle class
    // rather than fail. 31 equipment types is far beyond any real warehouse;
    // going higher would mean BigInt masks in the A* inner loop.
    check(
      "chk_mhe_class_bit_range",
      sql`class_bit IS NULL OR (class_bit >= 0 AND class_bit <= 30)`,
    ),
  ],
);

export const taskStatuses = pgTable(
  "task_statuses",
  {
    statusId: serial("status_id").primaryKey().notNull(),
    code: varchar({ length: 20 }).notNull(),
    description: varchar({ length: 100 }),
  },
  (table) => [unique("task_statuses_code_key").on(table.code)],
);

export const taskTypes = pgTable(
  "task_types",
  {
    taskTypeId: serial("task_type_id").primaryKey().notNull(),
    code: varchar({ length: 30 }).notNull(),
    description: varchar({ length: 100 }),
  },
  (table) => [unique("task_types_code_key").on(table.code)],
);

export const warehouseConfigs = pgTable("warehouse_configs", {
  configId: serial("config_id").primaryKey().notNull(),
  requireStagingBeforePutaway: boolean(
    "require_staging_before_putaway",
  ).default(true),
  allowMixedSkuPerLocation: boolean("allow_mixed_sku_per_location").default(
    false,
  ),
  allowMixedLpnPerLocation: boolean("allow_mixed_lpn_per_location").default(
    true,
  ),
  defaultPutawayStrategy: varchar("default_putaway_strategy", {
    length: 20,
  }).default("NEAREST_EMPTY"),
  cycleCountFrequencyDays: integer("cycle_count_frequency_days"),
  updatedAt: timestamp("updated_at", { mode: "string" }).default(
    sql`CURRENT_TIMESTAMP`,
  ),
});

export const departments = pgTable(
  "departments",
  {
    departmentId: serial("department_id").primaryKey().notNull(),
    warehouseId: integer("warehouse_id"),
    departmentName: varchar("department_name", { length: 100 }).notNull(),
    isCustom: boolean("is_custom").default(false),
    isActive: boolean("is_active").default(true),
    updatedAt: timestamp("updated_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "departments_warehouse_id_fkey",
    }).onDelete("cascade"),
    unique("uq_departments_wh_name").on(
      table.warehouseId,
      table.departmentName,
    ),
  ],
);

export const inventory = pgTable(
  "inventory",
  {
    inventoryId: serial("inventory_id").primaryKey().notNull(),
    locationId: integer("location_id"),
    itemId: integer("item_id"),
    quantity: integer(),
    batchNumber: varchar("batch_number", { length: 50 }),
    lotNumber: varchar("lot_number", { length: 50 }),
    expiryDate: date("expiry_date"),
    statusId: integer("status_id"),
    updatedAt: timestamp("updated_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    index("idx_inventory_item").using(
      "btree",
      table.itemId.asc().nullsLast().op("int4_ops"),
    ),
    index("idx_inventory_location").using(
      "btree",
      table.locationId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.itemId],
      foreignColumns: [items.itemId],
      name: "inventory_item_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.locationId],
      name: "inventory_location_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.statusId],
      foreignColumns: [inventoryStatuses.statusId],
      name: "inventory_status_id_fkey",
    }).onDelete("restrict"),
    unique("uq_inventory_location_item_batch_lot").on(
      table.locationId,
      table.itemId,
      table.batchNumber,
      table.lotNumber,
    ),
    check("inventory_quantity_check", sql`quantity >= 0`),
  ],
);

export const pallets = pgTable(
  "pallets",
  {
    lpnId: varchar("lpn_id", { length: 50 }).primaryKey().notNull(),
    warehouseId: integer("warehouse_id"),
    currentLocationId: integer("current_location_id"),
    status: varchar({ length: 20 }).default("ACTIVE"),
    createdAt: timestamp("created_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
    updatedAt: timestamp("updated_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    foreignKey({
      columns: [table.currentLocationId],
      foreignColumns: [locations.locationId],
      name: "pallets_current_location_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "pallets_warehouse_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    poLineId: serial("po_line_id").primaryKey().notNull(),
    poId: integer("po_id").notNull(),
    itemId: integer("item_id").notNull(),
    quantityOrdered: integer("quantity_ordered").notNull(),
    quantityReceived: integer("quantity_received").default(0),
    batchNumber: varchar("batch_number", { length: 50 }),
    lotNumber: varchar("lot_number", { length: 50 }),
    expiryDate: date("expiry_date"),
    unitCost: numeric("unit_cost", { precision: 10, scale: 2 }),
  },
  (table) => [
    index("idx_pol_item").using(
      "btree",
      table.itemId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.itemId],
      foreignColumns: [items.itemId],
      name: "purchase_order_lines_item_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.poId],
      foreignColumns: [purchaseOrders.poId],
      name: "purchase_order_lines_po_id_fkey",
    }).onDelete("cascade"),
    check(
      "purchase_order_lines_quantity_ordered_check",
      sql`quantity_ordered > 0`,
    ),
    check(
      "purchase_order_lines_quantity_received_check",
      sql`quantity_received >= 0`,
    ),
    check(
      "purchase_order_lines_unit_cost_check",
      sql`unit_cost >= (0)::numeric`,
    ),
  ],
);

export const salesOrderLines = pgTable(
  "sales_order_lines",
  {
    soLineId: serial("so_line_id").primaryKey().notNull(),
    soId: integer("so_id").notNull(),
    itemId: integer("item_id").notNull(),
    quantityRequested: integer("quantity_requested").notNull(),
    batchNumber: varchar("batch_number", { length: 50 }),
    lotNumber: varchar("lot_number", { length: 50 }),
    expiryDate: date("expiry_date"),
    quantityAllocated: integer("quantity_allocated").default(0),
    quantityShipped: integer("quantity_shipped").default(0),
  },
  (table) => [
    index("idx_sol_item").using(
      "btree",
      table.itemId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.itemId],
      foreignColumns: [items.itemId],
      name: "sales_order_lines_item_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.soId],
      foreignColumns: [salesOrders.soId],
      name: "sales_order_lines_so_id_fkey",
    }).onDelete("cascade"),
    check(
      "sales_order_lines_check",
      sql`(quantity_shipped >= 0) AND (quantity_shipped <= quantity_allocated)`,
    ),
    check(
      "sales_order_lines_quantity_allocated_check",
      sql`quantity_allocated >= 0`,
    ),
    check(
      "sales_order_lines_quantity_requested_check",
      sql`quantity_requested > 0`,
    ),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
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
    createdAt: timestamp("created_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    index("idx_stock_movements_created").using(
      "btree",
      table.createdAt.asc().nullsLast().op("timestamp_ops"),
    ),
    index("idx_stock_movements_item").using(
      "btree",
      table.itemId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.destinationLocationId],
      foreignColumns: [locations.locationId],
      name: "stock_movements_destination_location_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.employeeId],
      foreignColumns: [employees.employeeId],
      name: "stock_movements_employee_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.itemId],
      foreignColumns: [items.itemId],
      name: "stock_movements_item_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.sourceLocationId],
      foreignColumns: [locations.locationId],
      name: "stock_movements_source_location_id_fkey",
    }).onDelete("restrict"),
    check("stock_movements_quantity_check", sql`quantity > 0`),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    taskId: uuid("task_id").defaultRandom().primaryKey().notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    taskTypeId: integer("task_type_id").notNull(),
    statusId: integer("status_id").notNull(),
    priority: integer().default(100).notNull(),
    assignedEmployeeId: integer("assigned_employee_id"),
    mheTypeRequired: integer("mhe_type_required"),
    createdAt: timestamp("created_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
    startedAt: timestamp("started_at", { mode: "string" }),
    completedAt: timestamp("completed_at", { mode: "string" }),
  },
  (table) => [
    index("idx_tasks_assigned_employee").using(
      "btree",
      table.assignedEmployeeId.asc().nullsLast().op("int4_ops"),
    ),
    index("idx_tasks_warehouse_status").using(
      "btree",
      table.warehouseId.asc().nullsLast().op("int4_ops"),
      table.statusId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.assignedEmployeeId],
      foreignColumns: [employees.employeeId],
      name: "tasks_assigned_employee_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.mheTypeRequired],
      foreignColumns: [mheTypes.mheTypeId],
      name: "tasks_mhe_type_required_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.statusId],
      foreignColumns: [taskStatuses.statusId],
      name: "tasks_status_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.taskTypeId],
      foreignColumns: [taskTypes.taskTypeId],
      name: "tasks_task_type_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "tasks_warehouse_id_fkey",
    }).onDelete("restrict"),
  ],
);

export const bookingTasks = pgTable(
  "booking_tasks",
  {
    taskId: uuid("task_id").primaryKey().notNull(),
    dockDoorLocationId: integer("dock_door_location_id").notNull(),
    palletHeightCm: integer("pallet_height_cm").notNull(),
    itemId: integer("item_id").notNull(),
    productType: varchar("product_type", { length: 50 }).notNull(),
    productQuantity: integer("product_quantity").notNull(),
    batchNumber: varchar("batch_number", { length: 50 }),
    lotNumber: varchar("lot_number", { length: 50 }),
    expiryDate: date("expiry_date"),
  },
  (table) => [
    foreignKey({
      columns: [table.dockDoorLocationId],
      foreignColumns: [locations.locationId],
      name: "booking_tasks_dock_door_location_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.itemId],
      foreignColumns: [items.itemId],
      name: "booking_tasks_item_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [tasks.taskId],
      name: "booking_tasks_task_id_fkey",
    }).onDelete("cascade"),
    check("booking_tasks_product_quantity_check", sql`product_quantity > 0`),
  ],
);

export const putawayTasks = pgTable(
  "putaway_tasks",
  {
    taskId: uuid("task_id").primaryKey().notNull(),
    lpnId: varchar("lpn_id", { length: 50 }).notNull(),
    sourceLocationId: integer("source_location_id").notNull(),
    suggestedDestLocationId: integer("suggested_dest_location_id").notNull(),
    actualDestLocationId: integer("actual_dest_location_id"),
  },
  (table) => [
    foreignKey({
      columns: [table.actualDestLocationId],
      foreignColumns: [locations.locationId],
      name: "putaway_tasks_actual_dest_location_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.lpnId],
      foreignColumns: [pallets.lpnId],
      name: "putaway_tasks_lpn_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.sourceLocationId],
      foreignColumns: [locations.locationId],
      name: "putaway_tasks_source_location_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.suggestedDestLocationId],
      foreignColumns: [locations.locationId],
      name: "putaway_tasks_suggested_dest_location_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [tasks.taskId],
      name: "putaway_tasks_task_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const unloadingTasks = pgTable(
  "unloading_tasks",
  {
    taskId: uuid("task_id").primaryKey().notNull(),
    dockDoorLocationId: integer("dock_door_location_id").notNull(),
    trailerNumber: varchar("trailer_number", { length: 30 }),
    expectedPallets: integer("expected_pallets").notNull(),
    carrierId: integer("carrier_id"),
  },
  (table) => [
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.carrierId],
      name: "unloading_tasks_carrier_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.dockDoorLocationId],
      foreignColumns: [locations.locationId],
      name: "unloading_tasks_dock_door_location_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [tasks.taskId],
      name: "unloading_tasks_task_id_fkey",
    }).onDelete("cascade"),
    check("unloading_tasks_expected_pallets_check", sql`expected_pallets > 0`),
  ],
);

export const pickingTasks = pgTable(
  "picking_tasks",
  {
    taskId: uuid("task_id").primaryKey().notNull(),
    pickLocationId: integer("pick_location_id").notNull(),
    itemId: integer("item_id").notNull(),
    batchNumber: varchar("batch_number", { length: 50 }),
    lotNumber: varchar("lot_number", { length: 50 }),
    pickQuantity: integer("pick_quantity").notNull(),
    lpnId: varchar("lpn_id", { length: 50 }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.itemId],
      foreignColumns: [items.itemId],
      name: "picking_tasks_item_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.lpnId],
      foreignColumns: [pallets.lpnId],
      name: "picking_tasks_lpn_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.pickLocationId],
      foreignColumns: [locations.locationId],
      name: "picking_tasks_pick_location_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [tasks.taskId],
      name: "picking_tasks_task_id_fkey",
    }).onDelete("cascade"),
    check("picking_tasks_pick_quantity_check", sql`pick_quantity > 0`),
  ],
);

export const loadingTasks = pgTable(
  "loading_tasks",
  {
    taskId: uuid("task_id").primaryKey().notNull(),
    dockDoorLocationId: integer("dock_door_location_id").notNull(),
    lpnId: varchar("lpn_id", { length: 50 }).notNull(),
    shipmentId: uuid("shipment_id").notNull(),
    sequenceNumber: integer("sequence_number").default(1).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.dockDoorLocationId],
      foreignColumns: [locations.locationId],
      name: "loading_tasks_dock_door_location_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.lpnId],
      foreignColumns: [pallets.lpnId],
      name: "loading_tasks_lpn_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.shipmentId],
      foreignColumns: [shipments.shipmentId],
      name: "loading_tasks_shipment_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [tasks.taskId],
      name: "loading_tasks_task_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const replenishmentTasks = pgTable(
  "replenishment_tasks",
  {
    taskId: uuid("task_id").primaryKey().notNull(),
    itemId: integer("item_id").notNull(),
    batchNumber: varchar("batch_number", { length: 50 }),
    lotNumber: varchar("lot_number", { length: 50 }),
    sourceLocationId: integer("source_location_id").notNull(),
    destinationLocationId: integer("destination_location_id").notNull(),
    quantity: integer().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.destinationLocationId],
      foreignColumns: [locations.locationId],
      name: "replenishment_tasks_destination_location_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.itemId],
      foreignColumns: [items.itemId],
      name: "replenishment_tasks_item_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.sourceLocationId],
      foreignColumns: [locations.locationId],
      name: "replenishment_tasks_source_location_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [tasks.taskId],
      name: "replenishment_tasks_task_id_fkey",
    }).onDelete("cascade"),
    check("replenishment_tasks_quantity_check", sql`quantity > 0`),
  ],
);

export const cycleCountTasks = pgTable(
  "cycle_count_tasks",
  {
    taskId: uuid("task_id").primaryKey().notNull(),
    locationId: integer("location_id").notNull(),
    itemId: integer("item_id").notNull(),
    batchNumber: varchar("batch_number", { length: 50 }),
    lotNumber: varchar("lot_number", { length: 50 }),
    expectedQuantity: integer("expected_quantity").notNull(),
    countedQuantity: integer("counted_quantity"),
  },
  (table) => [
    foreignKey({
      columns: [table.itemId],
      foreignColumns: [items.itemId],
      name: "cycle_count_tasks_item_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.locationId],
      name: "cycle_count_tasks_location_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [tasks.taskId],
      name: "cycle_count_tasks_task_id_fkey",
    }).onDelete("cascade"),
    check(
      "cycle_count_tasks_counted_quantity_check",
      sql`counted_quantity >= 0`,
    ),
  ],
);

export const timeClockEntries = pgTable(
  "time_clock_entries",
  {
    timeClockId: serial("time_clock_id").primaryKey().notNull(),
    employeeId: integer("employee_id"),
    warehouseId: integer("warehouse_id"),
    clockInAt: timestamp("clock_in_at", { mode: "string" }).notNull(),
    clockOutAt: timestamp("clock_out_at", { mode: "string" }),
    breakMinutes: integer("break_minutes").default(0),
    source: varchar({ length: 20 }).default("TERMINAL"),
    editedByEmployeeId: integer("edited_by_employee_id"),
  },
  (table) => [
    index("idx_time_clock_employee").using(
      "btree",
      table.employeeId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.editedByEmployeeId],
      foreignColumns: [employees.employeeId],
      name: "time_clock_entries_edited_by_employee_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.employeeId],
      foreignColumns: [employees.employeeId],
      name: "time_clock_entries_employee_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "time_clock_entries_warehouse_id_fkey",
    }).onDelete("restrict"),
  ],
);

export const positionTypes = pgTable(
  "position_types",
  {
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
    canOverrideUnexpectedDeliveries: boolean(
      "can_override_unexpected_deliveries",
    ).default(false),
    canRegisterDamages: boolean("can_register_damages").default(false),
    canModifyLocations: boolean("can_modify_locations").default(false),
    canReplenish: boolean("can_replenish").default(false),
    canForceRecount: boolean("can_force_recount").default(false),
    canReleaseOrders: boolean("can_release_orders").default(false),
    canVoidShipments: boolean("can_void_shipments").default(false),
    canManageUsers: boolean("can_manage_users").default(false),
    canModifyConfigs: boolean("can_modify_configs").default(false),
    canModifyLayout: boolean("can_modify_layout").default(false),
    warehouseId: integer("warehouse_id"),
  },
  (table) => [
    index("idx_position_types_warehouse_id").using(
      "btree",
      table.warehouseId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "position_types_warehouse_id_fkey",
    }).onDelete("cascade"),
    unique("position_types_title_key").on(table.title),
  ],
);

export const halls = pgTable(
  "halls",
  {
    hallId: serial("hall_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    name: varchar({ length: 100 }).notNull(),
    physicalWidthMm: integer("physical_width_mm").default(80000).notNull(),
    physicalLengthMm: integer("physical_length_mm").default(60000).notNull(),
    clearHeightMm: integer("clear_height_mm").default(12000),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_warehouse_halls_wh_id").using(
      "btree",
      table.warehouseId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.organizationId, table.warehouseId],
      foreignColumns: [warehouses.warehouseId, warehouses.organizationId],
      name: "fk_halls_warehouse",
    }).onDelete("cascade"),
    unique("uq_warehouse_hall_name").on(table.warehouseId, table.name),
  ],
);

export const locations = pgTable(
  "locations",
  {
    locationId: serial("location_id").primaryKey().notNull(),
    warehouseId: integer("warehouse_id"),
    locationCode: varchar("location_code", { length: 50 }).notNull(),
    aisle: integer(),
    bay: integer(),
    level: integer(),
    heightMm: integer("height_mm"),
    maxWeightKg: integer("max_weight_kg"),
    isBlocked: boolean("is_blocked").default(false),
    // Replaces the former is_racking/is_shelf/is_floor_storage triple: those
    // encoded one mutually-exclusive choice as three independent booleans,
    // with nothing preventing a row from being both racking and shelf.
    locationType: varchar("location_type", { length: 20 })
      .default("NONE")
      .notNull(),
    // Marks a staging/buffer slot (pallets waiting to move or load) as
    // distinct from permanent storage. Replaces the zone-based
    // storage_permanence scheme -- zones turned out to model nothing no code
    // ever read, where this is the one bit that actually mattered.
    isTemporary: boolean("is_temporary").default(false).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
    physicalX: integer("physical_x").default(0).notNull(),
    physicalY: integer("physical_y").default(0).notNull(),
    physicalWidthMm: integer("physical_width_mm").default(0).notNull(),
    physicalLengthMm: integer("physical_length_mm").default(0).notNull(),
    rotationDegrees: integer("rotation_degrees").default(0).notNull(),
    floorLevel: integer("floor_level").default(1).notNull(),
    hallId: integer("hall_id"),
    row: integer(),
  },
  (table) => [
    index("idx_locations_canvas_render")
      .using(
        "btree",
        table.warehouseId.asc().nullsLast().op("int4_ops"),
        table.hallId.asc().nullsLast().op("int4_ops"),
        table.physicalX.asc().nullsLast().op("int4_ops"),
        table.physicalY.asc().nullsLast().op("int4_ops"),
      )
      .where(sql`(is_blocked = false)`),
    foreignKey({
      columns: [table.hallId],
      foreignColumns: [halls.hallId],
      name: "locations_hall_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "locations_warehouse_id_fkey",
    }).onDelete("cascade"),
    // Location codes are unique per warehouse, not globally -- two tenants
    // (or two warehouses in one org) can legitimately both use "A01-01-1".
    unique("uq_locations_wh_code").on(table.warehouseId, table.locationCode),
    check(
      "chk_rotation_range",
      sql`(rotation_degrees >= 0) AND (rotation_degrees < 360)`,
    ),
    check(
      "chk_location_type",
      sql`(location_type)::text = ANY ((ARRAY['RACKING'::character varying, 'SHELF'::character varying, 'FLOOR'::character varying, 'NONE'::character varying])::text[])`,
    ),
  ],
);

export const shipmentSalesOrders = pgTable(
  "shipment_sales_orders",
  {
    shipmentId: uuid("shipment_id").notNull(),
    soId: integer("so_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.shipmentId],
      foreignColumns: [shipments.shipmentId],
      name: "shipment_sales_orders_shipment_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.soId],
      foreignColumns: [salesOrders.soId],
      name: "shipment_sales_orders_so_id_fkey",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.shipmentId, table.soId],
      name: "shipment_sales_orders_pkey",
    }),
  ],
);

export const taskEligibleDepartments = pgTable(
  "task_eligible_departments",
  {
    taskId: uuid("task_id").notNull(),
    departmentId: integer("department_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.departmentId],
      foreignColumns: [departments.departmentId],
      name: "task_eligible_departments_department_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [tasks.taskId],
      name: "task_eligible_departments_task_id_fkey",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.taskId, table.departmentId],
      name: "task_eligible_departments_pkey",
    }),
  ],
);

export const employeeDepartments = pgTable(
  "employee_departments",
  {
    employeeId: integer("employee_id").notNull(),
    departmentId: integer("department_id").notNull(),
    isPrimary: boolean("is_primary").default(false),
    assignedAt: timestamp("assigned_at", { mode: "string" }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    foreignKey({
      columns: [table.departmentId],
      foreignColumns: [departments.departmentId],
      name: "employee_departments_department_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.employeeId],
      foreignColumns: [employees.employeeId],
      name: "employee_departments_employee_id_fkey",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.employeeId, table.departmentId],
      name: "employee_departments_pkey",
    }),
  ],
);

export const employeeLicenses = pgTable(
  "employee_licenses",
  {
    employeeId: integer("employee_id").notNull(),
    mheTypeId: integer("mhe_type_id").notNull(),
    issuedDate: date("issued_date"),
    expiryDate: date("expiry_date"),
  },
  (table) => [
    foreignKey({
      columns: [table.employeeId],
      foreignColumns: [employees.employeeId],
      name: "employee_licenses_employee_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.mheTypeId],
      foreignColumns: [mheTypes.mheTypeId],
      name: "employee_licenses_mhe_type_id_fkey",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.employeeId, table.mheTypeId],
      name: "employee_licenses_pkey",
    }),
  ],
);

// ---------------------------------------------------------------------------
// Layout designer: physical map features
//
// `locations` means "inventory can be here". Everything else with a footprint
// -- walls, columns, dock doors, pack stations, charging bays, travel lanes --
// lives in `layout_features`. Keeping them apart matters because locations are
// referenced forever by stock_movements and are enumerated by putaway/picking
// strategies, while features are edited freely in the designer.
// ---------------------------------------------------------------------------

// Global lookup (like mhe_types / task_types): what kinds of feature exist,
// how they default, and how the designer palette groups and draws them.
export const featureKinds = pgTable(
  "feature_kinds",
  {
    kind: varchar({ length: 40 }).primaryKey().notNull(),
    category: varchar({ length: 20 }).notNull(),
    label: varchar({ length: 60 }).notNull(),
    defaultGeometryKind: varchar("default_geometry_kind", {
      length: 10,
    }).notNull(),
    defaultWidthMm: integer("default_width_mm"),
    defaultLengthMm: integer("default_length_mm"),
    defaultHeightMm: integer("default_height_mm"),
    isObstacleDefault: boolean("is_obstacle_default").default(true).notNull(),
    defaultColor: varchar("default_color", { length: 7 }).notNull(),
    sortOrder: integer("sort_order").default(100).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
  },
  () => [
    check(
      "chk_feature_kind_category",
      sql`(category)::text = ANY ((ARRAY['STRUCTURE'::character varying, 'LOGISTICS'::character varying, 'WORKSTATION'::character varying, 'FACILITY'::character varying, 'HAZARD'::character varying, 'NAVIGATION'::character varying, 'ANNOTATION'::character varying])::text[])`,
    ),
    check(
      "chk_feature_kind_geometry",
      sql`(default_geometry_kind)::text = ANY ((ARRAY['RECT'::character varying, 'POLYGON'::character varying, 'POLYLINE'::character varying, 'POINT'::character varying, 'CIRCLE'::character varying])::text[])`,
    ),
  ],
);

export const layoutFeatures = pgTable(
  "layout_features",
  {
    featureId: serial("feature_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    hallId: integer("hall_id").notNull(),
    floorLevel: integer("floor_level").default(1).notNull(),
    kind: varchar({ length: 40 }).notNull(),
    geometryKind: varchar("geometry_kind", { length: 10 }).notNull(),

    // Anchor + extent, mirroring locations.physical_* so the canvas can treat
    // a RECT feature and a location with the same transform code.
    originXMm: integer("origin_x_mm").default(0).notNull(),
    originYMm: integer("origin_y_mm").default(0).notNull(),
    widthMm: integer("width_mm").default(0).notNull(),
    lengthMm: integer("length_mm").default(0).notNull(),
    rotationDegrees: integer("rotation_degrees").default(0).notNull(),
    // [[x,y], ...] in feature-local mm, for POLYGON/POLYLINE only.
    points: jsonb(),

    // Rotated bounding box, maintained on write. Indexing origin+width would
    // be wrong for any rotated feature, so the envelope is what gets indexed
    // and used as the broad phase before exact OBB/polygon intersection.
    envelopeMinXMm: integer("envelope_min_x_mm").default(0).notNull(),
    envelopeMinYMm: integer("envelope_min_y_mm").default(0).notNull(),
    envelopeMaxXMm: integer("envelope_max_x_mm").default(0).notNull(),
    envelopeMaxYMm: integer("envelope_max_y_mm").default(0).notNull(),

    // Vertical extent: z spans [elevation_mm, elevation_mm + height_mm]. This
    // is what lets a conveyor at 2400mm not block a pedestrian underneath it.
    elevationMm: integer("elevation_mm").default(0).notNull(),
    heightMm: integer("height_mm"),

    layerIndex: integer("layer_index").default(0).notNull(),
    isObstacle: boolean("is_obstacle").default(true).notNull(),
    isVisualOnly: boolean("is_visual_only").default(false).notNull(),
    impedanceMultiplier: numeric("impedance_multiplier", {
      precision: 5,
      scale: 2,
    })
      .default("1.00")
      .notNull(),

    label: varchar({ length: 100 }),
    color: varchar({ length: 7 }),

    // Kind-specific attributes, validated in app code against the spec in
    // layout-designer/feature-kinds.ts before every write.
    attrs: jsonb().default({}).notNull(),
    attrsVersion: integer("attrs_version").default(1).notNull(),

    // Soft lifecycle -- features referenced by nav edges or historical routes
    // are deactivated, not deleted.
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_layout_features_canvas_render")
      .using(
        "btree",
        table.warehouseId.asc().nullsLast().op("int4_ops"),
        table.hallId.asc().nullsLast().op("int4_ops"),
        table.floorLevel.asc().nullsLast().op("int4_ops"),
        table.envelopeMinXMm.asc().nullsLast().op("int4_ops"),
        table.envelopeMinYMm.asc().nullsLast().op("int4_ops"),
      )
      .where(sql`(is_active = true)`),
    index("idx_layout_features_kind").using(
      "btree",
      table.warehouseId.asc().nullsLast().op("int4_ops"),
      table.kind.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.hallId],
      foreignColumns: [halls.hallId],
      name: "layout_features_hall_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "layout_features_warehouse_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.kind],
      foreignColumns: [featureKinds.kind],
      name: "layout_features_kind_fkey",
    }).onDelete("restrict"),
    check(
      "chk_feature_rotation_range",
      sql`(rotation_degrees >= 0) AND (rotation_degrees < 360)`,
    ),
    check(
      "chk_feature_geometry_kind",
      sql`(geometry_kind)::text = ANY ((ARRAY['RECT'::character varying, 'POLYGON'::character varying, 'POLYLINE'::character varying, 'POINT'::character varying, 'CIRCLE'::character varying])::text[])`,
    ),
    check(
      "chk_feature_envelope",
      sql`(envelope_max_x_mm >= envelope_min_x_mm) AND (envelope_max_y_mm >= envelope_min_y_mm)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Navigation graph
//
// An explicit node/edge graph, not a grid. A 50m x 30m hall is ~150,000 cells
// at 100mm resolution but a few hundred nodes as a graph, and warehouses are
// corridor networks rather than open terrain. The graph also gives stable ids
// a task row can reference, and puts one-way/clearance/vehicle constraints
// where they naturally belong -- on an edge.
//
// Rows are stamped with the layout_version they were compiled from, and rows
// with is_generated = false survive recompilation so hand-placed corrections
// are never lost.
// ---------------------------------------------------------------------------

export const navNodes = pgTable(
  "nav_nodes",
  {
    nodeId: serial("node_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    hallId: integer("hall_id").notNull(),
    floorLevel: integer("floor_level").default(1).notNull(),
    xMm: integer("x_mm").notNull(),
    yMm: integer("y_mm").notNull(),
    nodeKind: varchar("node_kind", { length: 20 })
      .default("WAYPOINT")
      .notNull(),
    // Lifts and stairs share a group across floors so the compiler can join
    // their per-floor endpoints into vertical PORTAL edges.
    portalGroupId: integer("portal_group_id"),
    // Concurrent occupants before the node counts as congested. A goods lift
    // is capacity 1 and is often the real bottleneck of a mezzanine.
    capacity: integer().default(1).notNull(),
    isGenerated: boolean("is_generated").default(true).notNull(),
    sourceFeatureId: integer("source_feature_id"),
    layoutVersion: integer("layout_version").default(0).notNull(),
  },
  (table) => [
    index("idx_nav_nodes_hall").using(
      "btree",
      table.warehouseId.asc().nullsLast().op("int4_ops"),
      table.hallId.asc().nullsLast().op("int4_ops"),
      table.floorLevel.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.hallId],
      foreignColumns: [halls.hallId],
      name: "nav_nodes_hall_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "nav_nodes_warehouse_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceFeatureId],
      foreignColumns: [layoutFeatures.featureId],
      name: "nav_nodes_source_feature_id_fkey",
    }).onDelete("set null"),
    check(
      "chk_nav_node_kind",
      sql`(node_kind)::text = ANY ((ARRAY['WAYPOINT'::character varying, 'INTERSECTION'::character varying, 'ACCESS'::character varying, 'DOCK'::character varying, 'PORTAL'::character varying, 'CHARGE'::character varying, 'PARK'::character varying, 'STAGE'::character varying])::text[])`,
    ),
  ],
);

export const navEdges = pgTable(
  "nav_edges",
  {
    edgeId: serial("edge_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    hallId: integer("hall_id").notNull(),
    fromNodeId: integer("from_node_id").notNull(),
    toNodeId: integer("to_node_id").notNull(),

    // Stored once per physical connection and expanded into two directed arcs
    // in memory. Storing both directions doubles what a designer has to keep
    // consistent and makes one-way edits easy to get half-right.
    traversal: varchar({ length: 20 }).default("BIDIRECTIONAL").notNull(),
    edgeKind: varchar("edge_kind", { length: 20 }).default("LANE").notNull(),

    // Authoritative path length. For a curved lane this is the polyline
    // length, which is not the straight-line distance between endpoints.
    lengthMm: integer("length_mm").notNull(),
    points: jsonb(),
    widthMm: integer("width_mm"),
    maxSpeedMms: integer("max_speed_mms"),
    minClearanceMm: integer("min_clearance_mm"),
    maxWeightKg: integer("max_weight_kg"),
    maxVehicleWidthMm: integer("max_vehicle_width_mm"),

    // bit_or of the mhe_types.class_bit values permitted here.
    allowedVehicleMask: bigint("allowed_vehicle_mask", { mode: "number" })
      .default(0)
      .notNull(),

    impedance: numeric({ precision: 5, scale: 2 }).default("1.00").notNull(),
    // Lift cycle, door open, stop sign -- cost that does not scale with length.
    fixedDelayMs: integer("fixed_delay_ms").default(0).notNull(),

    sourceFeatureId: integer("source_feature_id"),
    isGenerated: boolean("is_generated").default(true).notNull(),
    layoutVersion: integer("layout_version").default(0).notNull(),
  },
  (table) => [
    index("idx_nav_edges_hall").using(
      "btree",
      table.warehouseId.asc().nullsLast().op("int4_ops"),
      table.hallId.asc().nullsLast().op("int4_ops"),
    ),
    index("idx_nav_edges_from").using(
      "btree",
      table.fromNodeId.asc().nullsLast().op("int4_ops"),
    ),
    index("idx_nav_edges_to").using(
      "btree",
      table.toNodeId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.fromNodeId],
      foreignColumns: [navNodes.nodeId],
      name: "nav_edges_from_node_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.toNodeId],
      foreignColumns: [navNodes.nodeId],
      name: "nav_edges_to_node_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.hallId],
      foreignColumns: [halls.hallId],
      name: "nav_edges_hall_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "nav_edges_warehouse_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceFeatureId],
      foreignColumns: [layoutFeatures.featureId],
      name: "nav_edges_source_feature_id_fkey",
    }).onDelete("set null"),
    check(
      "chk_nav_edge_traversal",
      sql`(traversal)::text = ANY ((ARRAY['BIDIRECTIONAL'::character varying, 'FORWARD_ONLY'::character varying, 'REVERSE_ONLY'::character varying])::text[])`,
    ),
    check(
      "chk_nav_edge_kind",
      sql`(edge_kind)::text = ANY ((ARRAY['LANE'::character varying, 'AISLE'::character varying, 'CROSS_AISLE'::character varying, 'WALKWAY'::character varying, 'PORTAL'::character varying, 'ACCESS'::character varying, 'YARD'::character varying, 'ZONE'::character varying])::text[])`,
    ),
    check("chk_nav_edge_length", sql`length_mm >= 0`),
    check("chk_nav_edge_endpoints", sql`from_node_id <> to_node_id`),
  ],
);

// Turn cost depends on the edge you arrived on, which is why the search runs
// over directed arcs rather than nodes. Most turns are derived from the angle
// between them; this table is only for hand-authored exceptions (no left turn
// out of the dock lane, and so on).
export const navTurnRestrictions = pgTable(
  "nav_turn_restrictions",
  {
    restrictionId: serial("restriction_id").primaryKey().notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    fromEdgeId: integer("from_edge_id").notNull(),
    toEdgeId: integer("to_edge_id").notNull(),
    penaltyMs: integer("penalty_ms").default(0).notNull(),
    isForbidden: boolean("is_forbidden").default(false).notNull(),
    allowedVehicleMask: bigint("allowed_vehicle_mask", { mode: "number" }),
  },
  (table) => [
    foreignKey({
      columns: [table.fromEdgeId],
      foreignColumns: [navEdges.edgeId],
      name: "nav_turn_restrictions_from_edge_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.toEdgeId],
      foreignColumns: [navEdges.edgeId],
      name: "nav_turn_restrictions_to_edge_id_fkey",
    }).onDelete("cascade"),
    unique("uq_nav_turn_restriction").on(table.fromEdgeId, table.toEdgeId),
  ],
);

// Where an operator stands (or a truck parks) to service a bin, and what it
// costs once they are there.
//
// Rack level deliberately does NOT affect travel: level 4 sits at the same
// (x, y) as level 1, so the aisle travel is identical and only the lift time
// differs. That is why handling_time_ms is here rather than encoded as extra
// graph distance.
export const locationAccessPoints = pgTable(
  "location_access_points",
  {
    accessPointId: serial("access_point_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    locationId: integer("location_id").notNull(),
    nodeId: integer("node_id").notNull(),
    approachHeadingDeg: integer("approach_heading_deg").default(0).notNull(),
    face: varchar({ length: 10 }).default("FRONT").notNull(),
    offsetMm: integer("offset_mm").default(0).notNull(),
    handlingTimeMs: integer("handling_time_ms").default(0).notNull(),
    allowedVehicleMask: bigint("allowed_vehicle_mask", {
      mode: "number",
    }).default(0),
    // Double-deep and back-to-back racking is reachable from two aisles at
    // different costs, so a location may legitimately have several.
    isPrimary: boolean("is_primary").default(true).notNull(),
    layoutVersion: integer("layout_version").default(0).notNull(),
  },
  (table) => [
    index("idx_location_access_points_location").using(
      "btree",
      table.locationId.asc().nullsLast().op("int4_ops"),
    ),
    index("idx_location_access_points_node").using(
      "btree",
      table.nodeId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.locationId],
      name: "location_access_points_location_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.nodeId],
      foreignColumns: [navNodes.nodeId],
      name: "location_access_points_node_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "location_access_points_warehouse_id_fkey",
    }).onDelete("cascade"),
    unique("uq_location_access_point").on(table.locationId, table.nodeId),
    check(
      "chk_access_point_face",
      sql`(face)::text = ANY ((ARRAY['FRONT'::character varying, 'BACK'::character varying, 'LEFT'::character varying, 'RIGHT'::character varying])::text[])`,
    ),
  ],
);

// A computed route. Stamped with the (layout_version, graph_epoch) it was
// planned against, because that pair is exactly what invalidates it: a
// republish moves the version, and a temporary blockage moves the epoch
// without one. A plan whose stamp is stale must be recomputed, never trusted.
//
// `task_id` is nullable so the designer can compute a preview route that
// belongs to no task at all.
export const routePlans = pgTable(
  "route_plans",
  {
    routePlanId: serial("route_plan_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    hallId: integer("hall_id").notNull(),
    taskId: uuid("task_id"),
    mheTypeId: integer("mhe_type_id"),

    fromNodeId: integer("from_node_id").notNull(),
    toNodeId: integer("to_node_id").notNull(),
    // Ordered edges of the path. Storing edge ids rather than coordinates is
    // what lets a blockage on edge X find every route that crosses it.
    edgeIds: integer("edge_ids").array().notNull(),
    // Ordered stops for a multi-drop pick, as [{ locationId, nodeId, ... }].
    stops: jsonb(),

    estDurationMs: integer("est_duration_ms").notNull(),
    estDistanceMm: integer("est_distance_mm").notNull(),

    layoutVersion: integer("layout_version").default(0).notNull(),
    graphEpoch: integer("graph_epoch").default(0).notNull(),
    computedAt: timestamp("computed_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
    supersededBy: integer("superseded_by"),
  },
  (table) => [
    index("idx_route_plans_task").using(
      "btree",
      table.taskId.asc().nullsLast().op("uuid_ops"),
    ),
    index("idx_route_plans_stamp").using(
      "btree",
      table.warehouseId.asc().nullsLast().op("int4_ops"),
      table.layoutVersion.asc().nullsLast().op("int4_ops"),
      table.graphEpoch.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "route_plans_warehouse_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.hallId],
      foreignColumns: [halls.hallId],
      name: "route_plans_hall_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [tasks.taskId],
      name: "route_plans_task_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.mheTypeId],
      foreignColumns: [mheTypes.mheTypeId],
      name: "route_plans_mhe_type_id_fkey",
    }).onDelete("set null"),
    check("chk_route_plan_duration", sql`est_duration_ms >= 0`),
    check("chk_route_plan_distance", sql`est_distance_mm >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Live map
// ---------------------------------------------------------------------------

// Where each asset is *now*. One row per asset, upserted -- not an append log.
//
// Live positions travel over a Realtime presence channel and never touch this
// table at their true rate; 200 workers at 1 Hz would be 17M rows a day of
// data whose value expires in seconds. This is the snapshot a page load reads
// before the channel starts delivering, written on state change or every
// ~15 s, whichever comes first.
export const assetPositions = pgTable(
  "asset_positions",
  {
    assetPositionId: serial("asset_position_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    hallId: integer("hall_id"),
    assetKind: varchar("asset_kind", { length: 20 }).notNull(),
    /** employee_id or mhe unit id, depending on asset_kind. */
    assetRefId: integer("asset_ref_id").notNull(),

    xMm: integer("x_mm").notNull(),
    yMm: integer("y_mm").notNull(),
    floorLevel: integer("floor_level").default(1).notNull(),
    headingDeg: integer("heading_deg"),
    /** Nearest graph node, for congestion and map-matching. */
    nodeId: integer("node_id"),
    /** Edge the asset was map-matched onto, if any. */
    edgeId: integer("edge_id"),

    // Most warehouses have no RTLS. Modelling the source explicitly is what
    // lets a scan-derived estimate and a UWB fix coexist honestly instead of
    // pretending both are ground truth.
    source: varchar({ length: 20 }).default("SCAN").notNull(),
    confidence: numeric({ precision: 3, scale: 2 }).default("1.00").notNull(),

    status: varchar({ length: 20 }).default("IDLE").notNull(),
    routePlanId: integer("route_plan_id"),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_asset_positions_warehouse").using(
      "btree",
      table.warehouseId.asc().nullsLast().op("int4_ops"),
      table.hallId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "asset_positions_warehouse_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.routePlanId],
      foreignColumns: [routePlans.routePlanId],
      name: "asset_positions_route_plan_id_fkey",
    }).onDelete("set null"),
    unique("uq_asset_positions_asset").on(table.assetKind, table.assetRefId),
    check(
      "chk_asset_kind",
      sql`(asset_kind)::text = ANY ((ARRAY['EMPLOYEE'::character varying, 'MHE'::character varying])::text[])`,
    ),
    check(
      "chk_asset_position_source",
      sql`(source)::text = ANY ((ARRAY['SCAN'::character varying, 'TASK_INFERRED'::character varying, 'MHE_TELEMETRY'::character varying, 'RTLS_UWB'::character varying, 'WIFI_RSSI'::character varying, 'BLE'::character varying, 'MANUAL'::character varying])::text[])`,
    ),
    check(
      "chk_asset_position_confidence",
      sql`(confidence >= 0) AND (confidence <= 1)`,
    ),
  ],
);

// Downsampled trail, for heatmaps and travel analytics -- never for the live
// view. Deliberately separate from asset_positions so retention can be short
// on identified traces without losing the current snapshot (see §5.8: this is
// regulated data in the EU).
export const assetPositionHistory = pgTable(
  "asset_position_history",
  {
    historyId: serial("history_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    hallId: integer("hall_id"),
    assetKind: varchar("asset_kind", { length: 20 }).notNull(),
    assetRefId: integer("asset_ref_id").notNull(),
    xMm: integer("x_mm").notNull(),
    yMm: integer("y_mm").notNull(),
    floorLevel: integer("floor_level").default(1).notNull(),
    edgeId: integer("edge_id"),
    source: varchar({ length: 20 }).default("SCAN").notNull(),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
  },
  (table) => [
    index("idx_asset_position_history_scan").using(
      "btree",
      table.warehouseId.asc().nullsLast().op("int4_ops"),
      table.observedAt.desc().nullsLast().op("timestamptz_ops"),
    ),
    index("idx_asset_position_history_asset").using(
      "btree",
      table.assetKind.asc().nullsLast().op("text_ops"),
      table.assetRefId.asc().nullsLast().op("int4_ops"),
      table.observedAt.desc().nullsLast().op("timestamptz_ops"),
    ),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "asset_position_history_warehouse_id_fkey",
    }).onDelete("cascade"),
  ],
);

// A temporary obstruction: a spill, a dropped pallet, maintenance. Raising one
// bumps graph_epoch, which is what invalidates every cached route crossing it
// without needing a republish.
export const layoutBlockages = pgTable(
  "layout_blockages",
  {
    blockageId: serial("blockage_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    hallId: integer("hall_id").notNull(),
    floorLevel: integer("floor_level").default(1).notNull(),

    // Explicit edge list. Resolved at report time rather than stored as
    // geometry alone, so invalidation is an array intersection instead of a
    // spatial query on every route.
    edgeIds: integer("edge_ids").array().notNull(),
    /** Optional footprint, for drawing it on the map. */
    originXMm: integer("origin_x_mm"),
    originYMm: integer("origin_y_mm"),
    radiusMm: integer("radius_mm"),

    reason: varchar({ length: 30 }).default("OTHER").notNull(),
    notes: varchar({ length: 300 }),
    reportedBy: integer("reported_by"),
    isActive: boolean("is_active").default(true).notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }),
    clearedAt: timestamp("cleared_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    index("idx_layout_blockages_active")
      .using(
        "btree",
        table.warehouseId.asc().nullsLast().op("int4_ops"),
        table.hallId.asc().nullsLast().op("int4_ops"),
      )
      .where(sql`(is_active = true)`),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "layout_blockages_warehouse_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.hallId],
      foreignColumns: [halls.hallId],
      name: "layout_blockages_hall_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.reportedBy],
      foreignColumns: [employees.employeeId],
      name: "layout_blockages_reported_by_fkey",
    }).onDelete("set null"),
    check(
      "chk_blockage_reason",
      sql`(reason)::text = ANY ((ARRAY['SPILL'::character varying, 'DROPPED_LOAD'::character varying, 'MAINTENANCE'::character varying, 'EQUIPMENT_FAILURE'::character varying, 'CONGESTION'::character varying, 'SAFETY'::character varying, 'OTHER'::character varying])::text[])`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Traffic analytics
//
// edge_traversals is the map-matched fact table -- one row per asset per
// continuous run on one edge, derived from asset_position_history by a
// background rollup rather than written live. edge_traffic_stats is the
// per-bucket aggregate that bottleneck detection and congestion-aware
// routing actually read; nothing queries edge_traversals directly at
// request time.
// ---------------------------------------------------------------------------

export const edgeTraversals = pgTable(
  "edge_traversals",
  {
    traversalId: serial("traversal_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    hallId: integer("hall_id").notNull(),
    edgeId: integer("edge_id").notNull(),
    assetKind: varchar("asset_kind", { length: 20 }).notNull(),
    assetRefId: integer("asset_ref_id").notNull(),
    enteredAt: timestamp("entered_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    exitedAt: timestamp("exited_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    durationMs: integer("duration_ms").notNull(),
  },
  (table) => [
    index("idx_edge_traversals_edge_time").using(
      "btree",
      table.edgeId.asc().nullsLast().op("int4_ops"),
      table.enteredAt.desc().nullsLast().op("timestamptz_ops"),
    ),
    index("idx_edge_traversals_warehouse_time").using(
      "btree",
      table.warehouseId.asc().nullsLast().op("int4_ops"),
      table.enteredAt.desc().nullsLast().op("timestamptz_ops"),
    ),
    foreignKey({
      columns: [table.edgeId],
      foreignColumns: [navEdges.edgeId],
      name: "edge_traversals_edge_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "edge_traversals_warehouse_id_fkey",
    }).onDelete("cascade"),
    check("chk_edge_traversal_duration", sql`duration_ms >= 0`),
    check("chk_edge_traversal_order", sql`exited_at >= entered_at`),
  ],
);

// One row per (edge, bucket). Upserted by the rollup, read by everything
// else -- bottleneck detection, the heatmap, and the damped congestion
// multiplier fed into routing impedance all read this table, never
// edge_traversals or asset_position_history directly.
export const edgeTrafficStats = pgTable(
  "edge_traffic_stats",
  {
    statId: serial("stat_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    hallId: integer("hall_id").notNull(),
    edgeId: integer("edge_id").notNull(),
    bucketStart: timestamp("bucket_start", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    bucketMinutes: integer("bucket_minutes").default(15).notNull(),
    traversalCount: integer("traversal_count").default(0).notNull(),
    p50DurationMs: integer("p50_duration_ms"),
    p95DurationMs: integer("p95_duration_ms"),
    meanOccupancy: numeric("mean_occupancy", { precision: 6, scale: 2 }),
    // EWMA of observed traversal speed, in mm/s -- this is what lets travel
    // time estimation "learn the building" instead of trusting only the
    // designer's nominal max_speed_mms.
    observedSpeedMms: integer("observed_speed_mms"),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_edge_traffic_stats_edge").using(
      "btree",
      table.edgeId.asc().nullsLast().op("int4_ops"),
      table.bucketStart.desc().nullsLast().op("timestamptz_ops"),
    ),
    index("idx_edge_traffic_stats_warehouse_bucket").using(
      "btree",
      table.warehouseId.asc().nullsLast().op("int4_ops"),
      table.bucketStart.desc().nullsLast().op("timestamptz_ops"),
    ),
    foreignKey({
      columns: [table.edgeId],
      foreignColumns: [navEdges.edgeId],
      name: "edge_traffic_stats_edge_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "edge_traffic_stats_warehouse_id_fkey",
    }).onDelete("cascade"),
    unique("uq_edge_traffic_stats_bucket").on(table.edgeId, table.bucketStart),
    check("chk_edge_traffic_stats_count", sql`traversal_count >= 0`),
  ],
);

// One row per edge: the damped congestion signal actually fed into routing
// impedance. Separate from edge_traffic_stats (which is bucketed history)
// because this is a single running EWMA that must persist *across* rollup
// runs -- recomputing it fresh from a stats window each time would throw
// away the hysteresis that stops congestion-aware routing from oscillating
// (docs §4.5/§5.9).
export const edgeCongestionState = pgTable(
  "edge_congestion_state",
  {
    edgeId: integer("edge_id").primaryKey().notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    hallId: integer("hall_id").notNull(),
    smoothedRatio: numeric("smoothed_ratio", { precision: 6, scale: 3 })
      .default("0")
      .notNull(),
    activeMultiplier: numeric("active_multiplier", {
      precision: 4,
      scale: 2,
    })
      .default("1.00")
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_edge_congestion_state_warehouse").using(
      "btree",
      table.warehouseId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.edgeId],
      foreignColumns: [navEdges.edgeId],
      name: "edge_congestion_state_edge_id_fkey",
    }).onDelete("cascade"),
    check(
      "chk_edge_congestion_multiplier",
      sql`active_multiplier >= 1 AND active_multiplier <= 3`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Layout lifecycle: versions, drafts, underlays
// ---------------------------------------------------------------------------

// One row per publish. `version_number` is monotonic per warehouse and is what
// the designer carries as its optimistic-concurrency base: a save built on
// version N is rejected if someone else has already published N+1.
//
// `graph_epoch` is bumped separately because it also has to move for changes
// that invalidate cached routes without being a publish (a temporary blockage,
// once those exist), so routes reference (version_number, graph_epoch).
export const layoutVersions = pgTable(
  "layout_versions",
  {
    versionId: serial("version_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    status: varchar({ length: 20 }).default("PUBLISHED").notNull(),
    graphEpoch: integer("graph_epoch").default(1).notNull(),
    changeCount: integer("change_count").default(0).notNull(),
    notes: varchar({ length: 500 }),
    publishedBy: integer("published_by"),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_layout_versions_current").using(
      "btree",
      table.warehouseId.asc().nullsLast().op("int4_ops"),
      table.versionNumber.desc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "layout_versions_warehouse_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.publishedBy],
      foreignColumns: [employees.employeeId],
      name: "layout_versions_published_by_fkey",
    }).onDelete("set null"),
    // The unique key is what actually enforces the concurrency check: two
    // supervisors racing to publish version N+1 means the loser's INSERT
    // fails rather than silently overwriting.
    unique("uq_layout_versions_wh_number").on(
      table.warehouseId,
      table.versionNumber,
    ),
    check(
      "chk_layout_version_status",
      sql`(status)::text = ANY ((ARRAY['DRAFT'::character varying, 'PUBLISHED'::character varying, 'ARCHIVED'::character varying])::text[])`,
    ),
  ],
);

// Server-side home for the designer's in-progress HallState. localStorage
// already survives a refresh, but it is per-browser: the draft is invisible
// from another machine and gives no way to tell that someone else has
// published underneath it.
export const layoutDrafts = pgTable(
  "layout_drafts",
  {
    draftId: serial("draft_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    hallId: integer("hall_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    state: jsonb().notNull(),
    stateVersion: integer("state_version").default(1).notNull(),
    baseVersionNumber: integer("base_version_number").default(0).notNull(),
    changeCount: integer("change_count").default(0).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    foreignKey({
      columns: [table.hallId],
      foreignColumns: [halls.hallId],
      name: "layout_drafts_hall_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "layout_drafts_warehouse_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.employeeId],
      foreignColumns: [employees.employeeId],
      name: "layout_drafts_employee_id_fkey",
    }).onDelete("cascade"),
    // One draft per person per hall -- the autosave upserts onto this.
    unique("uq_layout_drafts_hall_employee").on(
      table.hallId,
      table.employeeId,
    ),
  ],
);

// An imported floorplan (PDF export, CAD raster, survey scan) traced by the
// designer. Nobody hand-draws a 20,000 m² DC from measurements, so this is
// what makes the tool usable on a real building.
export const hallUnderlays = pgTable(
  "hall_underlays",
  {
    underlayId: serial("underlay_id").primaryKey().notNull(),
    organizationId: integer("organization_id").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    hallId: integer("hall_id").notNull(),
    floorLevel: integer("floor_level").default(1).notNull(),

    // Object path inside the private storage bucket. Never a public URL --
    // a floorplan is commercially sensitive, so reads go through a
    // short-lived signed URL minted server-side.
    storagePath: text("storage_path").notNull(),
    originalFilename: varchar("original_filename", { length: 255 }),
    mimeType: varchar("mime_type", { length: 100 }),
    fileSizeBytes: integer("file_size_bytes"),
    imageWidthPx: integer("image_width_px"),
    imageHeightPx: integer("image_height_px"),

    // Placement. scale_mm_per_px is the whole point of calibration: it turns
    // an arbitrary raster into something measured in the same millimetres as
    // every location and feature.
    scaleMmPerPx: numeric("scale_mm_per_px", { precision: 12, scale: 6 })
      .default("10.000000")
      .notNull(),
    offsetXMm: integer("offset_x_mm").default(0).notNull(),
    offsetYMm: integer("offset_y_mm").default(0).notNull(),
    rotationDegrees: integer("rotation_degrees").default(0).notNull(),
    opacity: numeric({ precision: 3, scale: 2 }).default("0.60").notNull(),
    isVisible: boolean("is_visible").default(true).notNull(),

    // Kept for audit: what the user measured and what they said it really is.
    // Lets a later calibration be re-derived instead of guessed at.
    calibMeasuredMm: integer("calib_measured_mm"),
    calibKnownMm: integer("calib_known_mm"),

    uploadedBy: integer("uploaded_by"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    foreignKey({
      columns: [table.hallId],
      foreignColumns: [halls.hallId],
      name: "hall_underlays_hall_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.warehouseId],
      foreignColumns: [warehouses.warehouseId],
      name: "hall_underlays_warehouse_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.uploadedBy],
      foreignColumns: [employees.employeeId],
      name: "hall_underlays_uploaded_by_fkey",
    }).onDelete("set null"),
    unique("uq_hall_underlays_hall_floor").on(table.hallId, table.floorLevel),
    check(
      "chk_underlay_rotation_range",
      sql`(rotation_degrees >= 0) AND (rotation_degrees < 360)`,
    ),
    check(
      "chk_underlay_opacity_range",
      sql`(opacity >= 0) AND (opacity <= 1)`,
    ),
    check("chk_underlay_scale_positive", sql`scale_mm_per_px > 0`),
  ],
);

// zone_areas dropped alongside zone_types (see migration 0010): 0 rows, and
// no code ever read from it or zone_types -- the zone-polygon geometry this
// table was meant to hold for "which zone is this worker standing in" was
// never actually built.
