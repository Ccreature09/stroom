-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "organizations" (
	"organization_id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "organizations_name_key" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "warehouses" (
	"warehouse_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"config_id" integer,
	"name" varchar(100),
	"street" varchar(100),
	"city" varchar(50),
	"postal_code" varchar(20),
	"country" varchar(50),
	"timezone" varchar(50),
	"is_active" boolean DEFAULT true,
	CONSTRAINT "uq_warehouses_org_wh" UNIQUE("warehouse_id","organization_id"),
	CONSTRAINT "warehouses_config_id_key" UNIQUE("config_id")
);
--> statement-breakpoint
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employees" (
	"employee_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"auth_user_id" uuid,
	"work_email" varchar(150) NOT NULL,
	"first_name" varchar(50),
	"middle_name" varchar(50),
	"last_name" varchar(50),
	"profile_picture_url" varchar(255),
	"position_id" integer,
	"primary_warehouse_id" integer,
	"current_warehouse_id" integer,
	"is_active" boolean DEFAULT true,
	"hire_date" date,
	"termination_date" date,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "employees_auth_user_id_key" UNIQUE("auth_user_id"),
	CONSTRAINT "employees_work_email_key" UNIQUE("work_email")
);
--> statement-breakpoint
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "items" (
	"item_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"sku" varchar(50) NOT NULL,
	"barcode" varchar(128),
	"name" varchar(150) NOT NULL,
	"description" text,
	"category" varchar(50),
	"length_cm" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"width_cm" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"height_cm" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"weight_kg" numeric(10, 3) DEFAULT '0.000' NOT NULL,
	"hazard_class" varchar(20) DEFAULT 'None',
	"is_batch_tracked" boolean DEFAULT false NOT NULL,
	"is_lot_tracked" boolean DEFAULT false NOT NULL,
	"has_expiry" boolean DEFAULT false NOT NULL,
	"shelf_life_days" integer,
	"min_stock_level" integer DEFAULT 0,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uq_items_org_sku" UNIQUE("organization_id","sku"),
	CONSTRAINT "items_barcode_key" UNIQUE("barcode")
);
--> statement-breakpoint
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"customer_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" varchar(150) NOT NULL,
	"contact_email" varchar(150),
	"contact_phone" varchar(30),
	"default_shipping_address" text,
	"is_active" boolean DEFAULT true,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uq_customers_org_customer" UNIQUE("customer_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suppliers" (
	"supplier_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" varchar(150) NOT NULL,
	"contact_name" varchar(100),
	"contact_email" varchar(150),
	"contact_phone" varchar(30),
	"address" text,
	"lead_time_days" integer,
	"is_active" boolean DEFAULT true,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uq_suppliers_org_supplier" UNIQUE("supplier_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "carriers" (
	"carrier_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"scac_code" varchar(10),
	"tracking_url_template" varchar(255),
	"is_active" boolean DEFAULT true,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uq_carriers_org_carrier" UNIQUE("carrier_id","organization_id"),
	CONSTRAINT "uq_carriers_org_name" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "carriers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"po_id" serial PRIMARY KEY NOT NULL,
	"po_number" varchar(50) NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'Draft',
	"expected_date" date,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "purchase_orders_po_number_key" UNIQUE("po_number")
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"so_id" serial PRIMARY KEY NOT NULL,
	"so_number" varchar(50) NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"shipping_address" text NOT NULL,
	"status" varchar(20) DEFAULT 'Pending',
	"carrier_id" integer,
	"tracking_number" varchar(100),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "sales_orders_so_number_key" UNIQUE("so_number")
);
--> statement-breakpoint
ALTER TABLE "sales_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shipments" (
	"shipment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"carrier_id" integer,
	"trailer_number" varchar(30),
	"status" varchar(20) DEFAULT 'STAGING',
	"dispatched_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_statuses" (
	"status_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"name" varchar(50) NOT NULL,
	"allow_allocation" boolean DEFAULT true,
	"allow_movement" boolean DEFAULT true,
	"is_sellable" boolean DEFAULT true,
	CONSTRAINT "uq_inventory_statuses_org_name" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "inventory_statuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "position_types" (
	"position_id" serial PRIMARY KEY NOT NULL,
	"title" varchar(50) NOT NULL,
	"is_office_role" boolean DEFAULT false,
	"can_view_metrics" boolean DEFAULT false,
	"can_assign_tasks" boolean DEFAULT false,
	"can_book" boolean DEFAULT false,
	"can_unload" boolean DEFAULT false,
	"can_load" boolean DEFAULT false,
	"can_pick" boolean DEFAULT false,
	"can_pack" boolean DEFAULT false,
	"can_modify_inventory" boolean DEFAULT false,
	"can_override_unexpected_deliveries" boolean DEFAULT false,
	"can_register_damages" boolean DEFAULT false,
	"can_modify_locations" boolean DEFAULT false,
	"can_replenish" boolean DEFAULT false,
	"can_force_recount" boolean DEFAULT false,
	"can_release_orders" boolean DEFAULT false,
	"can_void_shipments" boolean DEFAULT false,
	"can_manage_users" boolean DEFAULT false,
	"can_modify_configs" boolean DEFAULT false,
	CONSTRAINT "position_types_title_key" UNIQUE("title")
);
--> statement-breakpoint
ALTER TABLE "position_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mhe_types" (
	"mhe_type_id" serial PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"requires_license" boolean DEFAULT true,
	"max_weight_capacity_kg" integer,
	"max_reach_height_mm" integer,
	CONSTRAINT "mhe_types_name_key" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "mhe_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_statuses" (
	"status_id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"description" varchar(100),
	CONSTRAINT "task_statuses_code_key" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "task_statuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_types" (
	"task_type_id" serial PRIMARY KEY NOT NULL,
	"code" varchar(30) NOT NULL,
	"description" varchar(100),
	CONSTRAINT "task_types_code_key" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "task_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "warehouse_configs" (
	"config_id" serial PRIMARY KEY NOT NULL,
	"require_staging_before_putaway" boolean DEFAULT true,
	"allow_mixed_sku_per_location" boolean DEFAULT false,
	"allow_mixed_lpn_per_location" boolean DEFAULT true,
	"default_putaway_strategy" varchar(20) DEFAULT 'NEAREST_EMPTY',
	"cycle_count_frequency_days" integer,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE "warehouse_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "departments" (
	"department_id" serial PRIMARY KEY NOT NULL,
	"warehouse_id" integer,
	"department_name" varchar(100) NOT NULL,
	"is_custom" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uq_departments_wh_name" UNIQUE("warehouse_id","department_name")
);
--> statement-breakpoint
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "zones" (
	"zone_id" serial PRIMARY KEY NOT NULL,
	"warehouse_id" integer,
	"name" varchar(50) NOT NULL,
	"is_pickable" boolean DEFAULT true,
	"is_temperature_controlled" boolean DEFAULT false,
	"requires_hazmat_clearance" boolean DEFAULT false,
	CONSTRAINT "uq_zones_wh_name" UNIQUE("warehouse_id","name")
);
--> statement-breakpoint
ALTER TABLE "zones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "locations" (
	"location_id" serial PRIMARY KEY NOT NULL,
	"warehouse_id" integer,
	"zone_id" integer,
	"location_code" varchar(50) NOT NULL,
	"aisle" integer,
	"bay" integer,
	"level" integer,
	"position" integer,
	"height_mm" integer,
	"max_weight_kg" integer,
	"is_blocked" boolean DEFAULT false,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "locations_location_code_key" UNIQUE("location_code")
);
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory" (
	"inventory_id" serial PRIMARY KEY NOT NULL,
	"location_id" integer,
	"item_id" integer,
	"quantity" integer,
	"batch_number" varchar(50),
	"lot_number" varchar(50),
	"expiry_date" date,
	"status_id" integer,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uq_inventory_location_item_batch_lot" UNIQUE("location_id","item_id","batch_number","lot_number"),
	CONSTRAINT "inventory_quantity_check" CHECK (quantity >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pallets" (
	"lpn_id" varchar(50) PRIMARY KEY NOT NULL,
	"warehouse_id" integer,
	"current_location_id" integer,
	"status" varchar(20) DEFAULT 'ACTIVE',
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE "pallets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"po_line_id" serial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity_ordered" integer NOT NULL,
	"quantity_received" integer DEFAULT 0,
	"batch_number" varchar(50),
	"lot_number" varchar(50),
	"expiry_date" date,
	"unit_cost" numeric(10, 2),
	CONSTRAINT "purchase_order_lines_quantity_ordered_check" CHECK (quantity_ordered > 0),
	CONSTRAINT "purchase_order_lines_quantity_received_check" CHECK (quantity_received >= 0),
	CONSTRAINT "purchase_order_lines_unit_cost_check" CHECK (unit_cost >= (0)::numeric)
);
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"so_line_id" serial PRIMARY KEY NOT NULL,
	"so_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity_requested" integer NOT NULL,
	"batch_number" varchar(50),
	"lot_number" varchar(50),
	"expiry_date" date,
	"quantity_allocated" integer DEFAULT 0,
	"quantity_shipped" integer DEFAULT 0,
	CONSTRAINT "sales_order_lines_check" CHECK ((quantity_shipped >= 0) AND (quantity_shipped <= quantity_allocated)),
	CONSTRAINT "sales_order_lines_quantity_allocated_check" CHECK (quantity_allocated >= 0),
	CONSTRAINT "sales_order_lines_quantity_requested_check" CHECK (quantity_requested > 0)
);
--> statement-breakpoint
ALTER TABLE "sales_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"movement_id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer,
	"item_id" integer,
	"batch_number" varchar(50),
	"lot_number" varchar(50),
	"expiry_date" date,
	"quantity" integer NOT NULL,
	"source_location_id" integer,
	"destination_location_id" integer,
	"movement_type" varchar(30) NOT NULL,
	"reason_code" varchar(50),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "stock_movements_quantity_check" CHECK (quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tasks" (
	"task_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" integer NOT NULL,
	"task_type_id" integer NOT NULL,
	"status_id" integer NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"assigned_employee_id" integer,
	"mhe_type_required" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "booking_tasks" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"dock_door_location_id" integer NOT NULL,
	"pallet_height_cm" integer NOT NULL,
	"item_id" integer NOT NULL,
	"product_type" varchar(50) NOT NULL,
	"product_quantity" integer NOT NULL,
	"batch_number" varchar(50),
	"lot_number" varchar(50),
	"expiry_date" date,
	CONSTRAINT "booking_tasks_product_quantity_check" CHECK (product_quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "booking_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "putaway_tasks" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"lpn_id" varchar(50) NOT NULL,
	"source_location_id" integer NOT NULL,
	"suggested_dest_location_id" integer NOT NULL,
	"actual_dest_location_id" integer
);
--> statement-breakpoint
ALTER TABLE "putaway_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "unloading_tasks" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"dock_door_location_id" integer NOT NULL,
	"trailer_number" varchar(30),
	"expected_pallets" integer NOT NULL,
	"carrier_id" integer,
	CONSTRAINT "unloading_tasks_expected_pallets_check" CHECK (expected_pallets > 0)
);
--> statement-breakpoint
ALTER TABLE "unloading_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "picking_tasks" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"pick_location_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"batch_number" varchar(50),
	"lot_number" varchar(50),
	"pick_quantity" integer NOT NULL,
	"lpn_id" varchar(50) NOT NULL,
	CONSTRAINT "picking_tasks_pick_quantity_check" CHECK (pick_quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "picking_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "loading_tasks" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"dock_door_location_id" integer NOT NULL,
	"lpn_id" varchar(50) NOT NULL,
	"shipment_id" uuid NOT NULL,
	"sequence_number" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loading_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "replenishment_tasks" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"batch_number" varchar(50),
	"lot_number" varchar(50),
	"source_location_id" integer NOT NULL,
	"destination_location_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "replenishment_tasks_quantity_check" CHECK (quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "replenishment_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cycle_count_tasks" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"location_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"batch_number" varchar(50),
	"lot_number" varchar(50),
	"expected_quantity" integer NOT NULL,
	"counted_quantity" integer,
	CONSTRAINT "cycle_count_tasks_counted_quantity_check" CHECK (counted_quantity >= 0)
);
--> statement-breakpoint
ALTER TABLE "cycle_count_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time_clock_entries" (
	"time_clock_id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer,
	"warehouse_id" integer,
	"clock_in_at" timestamp NOT NULL,
	"clock_out_at" timestamp,
	"break_minutes" integer DEFAULT 0,
	"source" varchar(20) DEFAULT 'TERMINAL',
	"edited_by_employee_id" integer
);
--> statement-breakpoint
ALTER TABLE "time_clock_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shipment_sales_orders" (
	"shipment_id" uuid NOT NULL,
	"so_id" integer NOT NULL,
	CONSTRAINT "shipment_sales_orders_pkey" PRIMARY KEY("shipment_id","so_id")
);
--> statement-breakpoint
ALTER TABLE "shipment_sales_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_eligible_departments" (
	"task_id" uuid NOT NULL,
	"department_id" integer NOT NULL,
	CONSTRAINT "task_eligible_departments_pkey" PRIMARY KEY("task_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "task_eligible_departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_departments" (
	"employee_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false,
	"assigned_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "employee_departments_pkey" PRIMARY KEY("employee_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "employee_departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_licenses" (
	"employee_id" integer NOT NULL,
	"mhe_type_id" integer NOT NULL,
	"issued_date" date,
	"expiry_date" date,
	CONSTRAINT "employee_licenses_pkey" PRIMARY KEY("employee_id","mhe_type_id")
);
--> statement-breakpoint
ALTER TABLE "employee_licenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "public"."warehouse_configs"("config_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_current_warehouse_id_fkey" FOREIGN KEY ("current_warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "public"."position_types"("position_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_primary_warehouse_id_fkey" FOREIGN KEY ("primary_warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_current_wh" FOREIGN KEY ("organization_id","current_warehouse_id") REFERENCES "public"."warehouses"("warehouse_id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_primary_wh" FOREIGN KEY ("organization_id","primary_warehouse_id") REFERENCES "public"."warehouses"("warehouse_id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_po_supplier" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."suppliers"("supplier_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_po_warehouse" FOREIGN KEY ("organization_id","warehouse_id") REFERENCES "public"."warehouses"("warehouse_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("supplier_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "fk_so_carrier" FOREIGN KEY ("organization_id","carrier_id") REFERENCES "public"."carriers"("carrier_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "fk_so_customer" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("customer_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "fk_so_warehouse" FOREIGN KEY ("organization_id","warehouse_id") REFERENCES "public"."warehouses"("warehouse_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("carrier_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments_carrier" FOREIGN KEY ("organization_id","carrier_id") REFERENCES "public"."carriers"("carrier_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments_warehouse" FOREIGN KEY ("organization_id","warehouse_id") REFERENCES "public"."warehouses"("warehouse_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("carrier_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_statuses" ADD CONSTRAINT "inventory_statuses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("zone_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "public"."inventory_statuses"("status_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallets" ADD CONSTRAINT "pallets_current_location_id_fkey" FOREIGN KEY ("current_location_id") REFERENCES "public"."locations"("location_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallets" ADD CONSTRAINT "pallets_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("po_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_so_id_fkey" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("so_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_destination_location_id_fkey" FOREIGN KEY ("destination_location_id") REFERENCES "public"."locations"("location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "public"."locations"("location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_employee_id_fkey" FOREIGN KEY ("assigned_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_mhe_type_required_fkey" FOREIGN KEY ("mhe_type_required") REFERENCES "public"."mhe_types"("mhe_type_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "public"."task_statuses"("status_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_task_type_id_fkey" FOREIGN KEY ("task_type_id") REFERENCES "public"."task_types"("task_type_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_tasks" ADD CONSTRAINT "booking_tasks_dock_door_location_id_fkey" FOREIGN KEY ("dock_door_location_id") REFERENCES "public"."locations"("location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_tasks" ADD CONSTRAINT "booking_tasks_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_tasks" ADD CONSTRAINT "booking_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_actual_dest_location_id_fkey" FOREIGN KEY ("actual_dest_location_id") REFERENCES "public"."locations"("location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_lpn_id_fkey" FOREIGN KEY ("lpn_id") REFERENCES "public"."pallets"("lpn_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "public"."locations"("location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_suggested_dest_location_id_fkey" FOREIGN KEY ("suggested_dest_location_id") REFERENCES "public"."locations"("location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unloading_tasks" ADD CONSTRAINT "unloading_tasks_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("carrier_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unloading_tasks" ADD CONSTRAINT "unloading_tasks_dock_door_location_id_fkey" FOREIGN KEY ("dock_door_location_id") REFERENCES "public"."locations"("location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unloading_tasks" ADD CONSTRAINT "unloading_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_tasks" ADD CONSTRAINT "picking_tasks_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_tasks" ADD CONSTRAINT "picking_tasks_lpn_id_fkey" FOREIGN KEY ("lpn_id") REFERENCES "public"."pallets"("lpn_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_tasks" ADD CONSTRAINT "picking_tasks_pick_location_id_fkey" FOREIGN KEY ("pick_location_id") REFERENCES "public"."locations"("location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_tasks" ADD CONSTRAINT "picking_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loading_tasks" ADD CONSTRAINT "loading_tasks_dock_door_location_id_fkey" FOREIGN KEY ("dock_door_location_id") REFERENCES "public"."locations"("location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loading_tasks" ADD CONSTRAINT "loading_tasks_lpn_id_fkey" FOREIGN KEY ("lpn_id") REFERENCES "public"."pallets"("lpn_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loading_tasks" ADD CONSTRAINT "loading_tasks_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("shipment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loading_tasks" ADD CONSTRAINT "loading_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_tasks" ADD CONSTRAINT "replenishment_tasks_destination_location_id_fkey" FOREIGN KEY ("destination_location_id") REFERENCES "public"."locations"("location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_tasks" ADD CONSTRAINT "replenishment_tasks_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_tasks" ADD CONSTRAINT "replenishment_tasks_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "public"."locations"("location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_tasks" ADD CONSTRAINT "replenishment_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_tasks" ADD CONSTRAINT "cycle_count_tasks_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_tasks" ADD CONSTRAINT "cycle_count_tasks_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_tasks" ADD CONSTRAINT "cycle_count_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_entries" ADD CONSTRAINT "time_clock_entries_edited_by_employee_id_fkey" FOREIGN KEY ("edited_by_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_entries" ADD CONSTRAINT "time_clock_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_entries" ADD CONSTRAINT "time_clock_entries_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_sales_orders" ADD CONSTRAINT "shipment_sales_orders_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("shipment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_sales_orders" ADD CONSTRAINT "shipment_sales_orders_so_id_fkey" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("so_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_eligible_departments" ADD CONSTRAINT "task_eligible_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_eligible_departments" ADD CONSTRAINT "task_eligible_departments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departments" ADD CONSTRAINT "employee_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departments" ADD CONSTRAINT "employee_departments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_licenses" ADD CONSTRAINT "employee_licenses_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_licenses" ADD CONSTRAINT "employee_licenses_mhe_type_id_fkey" FOREIGN KEY ("mhe_type_id") REFERENCES "public"."mhe_types"("mhe_type_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_items_category" ON "items" USING btree ("category" text_ops);--> statement-breakpoint
CREATE INDEX "idx_po_supplier" ON "purchase_orders" USING btree ("supplier_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_so_customer" ON "sales_orders" USING btree ("customer_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_inventory_item" ON "inventory" USING btree ("item_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_inventory_location" ON "inventory" USING btree ("location_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_pol_item" ON "purchase_order_lines" USING btree ("item_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_sol_item" ON "sales_order_lines" USING btree ("item_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_stock_movements_created" ON "stock_movements" USING btree ("created_at" timestamp_ops);--> statement-breakpoint
CREATE INDEX "idx_stock_movements_item" ON "stock_movements" USING btree ("item_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_tasks_assigned_employee" ON "tasks" USING btree ("assigned_employee_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_tasks_warehouse_status" ON "tasks" USING btree ("warehouse_id" int4_ops,"status_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_time_clock_employee" ON "time_clock_entries" USING btree ("employee_id" int4_ops);--> statement-breakpoint
CREATE POLICY "tenant_isolation_organizations" ON "organizations" AS PERMISSIVE FOR SELECT TO public USING ((organization_id = current_employee_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation_warehouses" ON "warehouses" AS PERMISSIVE FOR SELECT TO public USING ((organization_id = current_employee_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation_employees" ON "employees" AS PERMISSIVE FOR SELECT TO public USING ((organization_id = current_employee_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation_items" ON "items" AS PERMISSIVE FOR SELECT TO public USING ((organization_id = current_employee_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation_customers" ON "customers" AS PERMISSIVE FOR SELECT TO public USING ((organization_id = current_employee_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation_suppliers" ON "suppliers" AS PERMISSIVE FOR SELECT TO public USING ((organization_id = current_employee_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation_carriers" ON "carriers" AS PERMISSIVE FOR SELECT TO public USING ((organization_id = current_employee_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation_purchase_orders" ON "purchase_orders" AS PERMISSIVE FOR SELECT TO public USING ((organization_id = current_employee_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation_sales_orders" ON "sales_orders" AS PERMISSIVE FOR SELECT TO public USING ((organization_id = current_employee_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation_shipments" ON "shipments" AS PERMISSIVE FOR SELECT TO public USING ((organization_id = current_employee_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation_inventory_statuses" ON "inventory_statuses" AS PERMISSIVE FOR SELECT TO public USING ((organization_id = current_employee_org_id()));
*/