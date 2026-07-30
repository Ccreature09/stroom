CREATE TABLE "asset_position_history" (
	"history_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"hall_id" integer,
	"asset_kind" varchar(20) NOT NULL,
	"asset_ref_id" integer NOT NULL,
	"x_mm" integer NOT NULL,
	"y_mm" integer NOT NULL,
	"floor_level" integer DEFAULT 1 NOT NULL,
	"edge_id" integer,
	"source" varchar(20) DEFAULT 'SCAN' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_positions" (
	"asset_position_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"hall_id" integer,
	"asset_kind" varchar(20) NOT NULL,
	"asset_ref_id" integer NOT NULL,
	"x_mm" integer NOT NULL,
	"y_mm" integer NOT NULL,
	"floor_level" integer DEFAULT 1 NOT NULL,
	"heading_deg" integer,
	"node_id" integer,
	"edge_id" integer,
	"source" varchar(20) DEFAULT 'SCAN' NOT NULL,
	"confidence" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"status" varchar(20) DEFAULT 'IDLE' NOT NULL,
	"route_plan_id" integer,
	"observed_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uq_asset_positions_asset" UNIQUE("asset_kind","asset_ref_id"),
	CONSTRAINT "chk_asset_kind" CHECK ((asset_kind)::text = ANY ((ARRAY['EMPLOYEE'::character varying, 'MHE'::character varying])::text[])),
	CONSTRAINT "chk_asset_position_source" CHECK ((source)::text = ANY ((ARRAY['SCAN'::character varying, 'TASK_INFERRED'::character varying, 'MHE_TELEMETRY'::character varying, 'RTLS_UWB'::character varying, 'WIFI_RSSI'::character varying, 'BLE'::character varying, 'MANUAL'::character varying])::text[])),
	CONSTRAINT "chk_asset_position_confidence" CHECK ((confidence >= 0) AND (confidence <= 1))
);
--> statement-breakpoint
CREATE TABLE "layout_blockages" (
	"blockage_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"hall_id" integer NOT NULL,
	"floor_level" integer DEFAULT 1 NOT NULL,
	"edge_ids" integer[] NOT NULL,
	"origin_x_mm" integer,
	"origin_y_mm" integer,
	"radius_mm" integer,
	"reason" varchar(30) DEFAULT 'OTHER' NOT NULL,
	"notes" varchar(300),
	"reported_by" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	"expires_at" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	CONSTRAINT "chk_blockage_reason" CHECK ((reason)::text = ANY ((ARRAY['SPILL'::character varying, 'DROPPED_LOAD'::character varying, 'MAINTENANCE'::character varying, 'EQUIPMENT_FAILURE'::character varying, 'CONGESTION'::character varying, 'SAFETY'::character varying, 'OTHER'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "asset_position_history" ADD CONSTRAINT "asset_position_history_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_positions" ADD CONSTRAINT "asset_positions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_positions" ADD CONSTRAINT "asset_positions_route_plan_id_fkey" FOREIGN KEY ("route_plan_id") REFERENCES "public"."route_plans"("route_plan_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_blockages" ADD CONSTRAINT "layout_blockages_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_blockages" ADD CONSTRAINT "layout_blockages_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("hall_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_blockages" ADD CONSTRAINT "layout_blockages_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "public"."employees"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_asset_position_history_scan" ON "asset_position_history" USING btree ("warehouse_id" int4_ops,"observed_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_asset_position_history_asset" ON "asset_position_history" USING btree ("asset_kind" text_ops,"asset_ref_id" int4_ops,"observed_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_asset_positions_warehouse" ON "asset_positions" USING btree ("warehouse_id" int4_ops,"hall_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_layout_blockages_active" ON "layout_blockages" USING btree ("warehouse_id" int4_ops,"hall_id" int4_ops) WHERE (is_active = true);