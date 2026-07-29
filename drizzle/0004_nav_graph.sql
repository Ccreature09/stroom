CREATE TABLE "location_access_points" (
	"access_point_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"node_id" integer NOT NULL,
	"approach_heading_deg" integer DEFAULT 0 NOT NULL,
	"face" varchar(10) DEFAULT 'FRONT' NOT NULL,
	"offset_mm" integer DEFAULT 0 NOT NULL,
	"handling_time_ms" integer DEFAULT 0 NOT NULL,
	"allowed_vehicle_mask" bigint DEFAULT 0,
	"is_primary" boolean DEFAULT true NOT NULL,
	"layout_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_location_access_point" UNIQUE("location_id","node_id"),
	CONSTRAINT "chk_access_point_face" CHECK ((face)::text = ANY ((ARRAY['FRONT'::character varying, 'BACK'::character varying, 'LEFT'::character varying, 'RIGHT'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "nav_edges" (
	"edge_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"hall_id" integer NOT NULL,
	"from_node_id" integer NOT NULL,
	"to_node_id" integer NOT NULL,
	"traversal" varchar(20) DEFAULT 'BIDIRECTIONAL' NOT NULL,
	"edge_kind" varchar(20) DEFAULT 'LANE' NOT NULL,
	"length_mm" integer NOT NULL,
	"points" jsonb,
	"width_mm" integer,
	"max_speed_mms" integer,
	"min_clearance_mm" integer,
	"max_weight_kg" integer,
	"max_vehicle_width_mm" integer,
	"allowed_vehicle_mask" bigint DEFAULT 0 NOT NULL,
	"impedance" numeric(5, 2) DEFAULT '1.00' NOT NULL,
	"fixed_delay_ms" integer DEFAULT 0 NOT NULL,
	"zone_id" integer,
	"source_feature_id" integer,
	"is_generated" boolean DEFAULT true NOT NULL,
	"layout_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "chk_nav_edge_traversal" CHECK ((traversal)::text = ANY ((ARRAY['BIDIRECTIONAL'::character varying, 'FORWARD_ONLY'::character varying, 'REVERSE_ONLY'::character varying])::text[])),
	CONSTRAINT "chk_nav_edge_kind" CHECK ((edge_kind)::text = ANY ((ARRAY['LANE'::character varying, 'AISLE'::character varying, 'CROSS_AISLE'::character varying, 'WALKWAY'::character varying, 'PORTAL'::character varying, 'ACCESS'::character varying, 'YARD'::character varying])::text[])),
	CONSTRAINT "chk_nav_edge_length" CHECK (length_mm >= 0),
	CONSTRAINT "chk_nav_edge_endpoints" CHECK (from_node_id <> to_node_id)
);
--> statement-breakpoint
CREATE TABLE "nav_nodes" (
	"node_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"hall_id" integer NOT NULL,
	"floor_level" integer DEFAULT 1 NOT NULL,
	"x_mm" integer NOT NULL,
	"y_mm" integer NOT NULL,
	"node_kind" varchar(20) DEFAULT 'WAYPOINT' NOT NULL,
	"portal_group_id" integer,
	"capacity" integer DEFAULT 1 NOT NULL,
	"is_generated" boolean DEFAULT true NOT NULL,
	"source_feature_id" integer,
	"layout_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "chk_nav_node_kind" CHECK ((node_kind)::text = ANY ((ARRAY['WAYPOINT'::character varying, 'INTERSECTION'::character varying, 'ACCESS'::character varying, 'DOCK'::character varying, 'PORTAL'::character varying, 'CHARGE'::character varying, 'PARK'::character varying, 'STAGE'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "nav_turn_restrictions" (
	"restriction_id" serial PRIMARY KEY NOT NULL,
	"warehouse_id" integer NOT NULL,
	"from_edge_id" integer NOT NULL,
	"to_edge_id" integer NOT NULL,
	"penalty_ms" integer DEFAULT 0 NOT NULL,
	"is_forbidden" boolean DEFAULT false NOT NULL,
	"allowed_vehicle_mask" bigint,
	CONSTRAINT "uq_nav_turn_restriction" UNIQUE("from_edge_id","to_edge_id")
);
--> statement-breakpoint
ALTER TABLE "mhe_types" ADD COLUMN "class_bit" integer;--> statement-breakpoint
ALTER TABLE "mhe_types" ADD COLUMN "is_pedestrian" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mhe_types" ADD COLUMN "width_mm" integer;--> statement-breakpoint
ALTER TABLE "mhe_types" ADD COLUMN "length_mm" integer;--> statement-breakpoint
ALTER TABLE "mhe_types" ADD COLUMN "height_mm" integer;--> statement-breakpoint
ALTER TABLE "mhe_types" ADD COLUMN "turning_radius_mm" integer;--> statement-breakpoint
ALTER TABLE "mhe_types" ADD COLUMN "min_aisle_width_mm" integer;--> statement-breakpoint
ALTER TABLE "mhe_types" ADD COLUMN "max_speed_laden_mms" integer;--> statement-breakpoint
ALTER TABLE "mhe_types" ADD COLUMN "max_speed_unladen_mms" integer;--> statement-breakpoint
ALTER TABLE "location_access_points" ADD CONSTRAINT "location_access_points_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_access_points" ADD CONSTRAINT "location_access_points_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "public"."nav_nodes"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_access_points" ADD CONSTRAINT "location_access_points_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_edges" ADD CONSTRAINT "nav_edges_from_node_id_fkey" FOREIGN KEY ("from_node_id") REFERENCES "public"."nav_nodes"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_edges" ADD CONSTRAINT "nav_edges_to_node_id_fkey" FOREIGN KEY ("to_node_id") REFERENCES "public"."nav_nodes"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_edges" ADD CONSTRAINT "nav_edges_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("hall_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_edges" ADD CONSTRAINT "nav_edges_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_edges" ADD CONSTRAINT "nav_edges_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."zone_types"("zone_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_edges" ADD CONSTRAINT "nav_edges_source_feature_id_fkey" FOREIGN KEY ("source_feature_id") REFERENCES "public"."layout_features"("feature_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_nodes" ADD CONSTRAINT "nav_nodes_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("hall_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_nodes" ADD CONSTRAINT "nav_nodes_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_nodes" ADD CONSTRAINT "nav_nodes_source_feature_id_fkey" FOREIGN KEY ("source_feature_id") REFERENCES "public"."layout_features"("feature_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_turn_restrictions" ADD CONSTRAINT "nav_turn_restrictions_from_edge_id_fkey" FOREIGN KEY ("from_edge_id") REFERENCES "public"."nav_edges"("edge_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_turn_restrictions" ADD CONSTRAINT "nav_turn_restrictions_to_edge_id_fkey" FOREIGN KEY ("to_edge_id") REFERENCES "public"."nav_edges"("edge_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_location_access_points_location" ON "location_access_points" USING btree ("location_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_location_access_points_node" ON "location_access_points" USING btree ("node_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_nav_edges_hall" ON "nav_edges" USING btree ("warehouse_id" int4_ops,"hall_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_nav_edges_from" ON "nav_edges" USING btree ("from_node_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_nav_edges_to" ON "nav_edges" USING btree ("to_node_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_nav_nodes_hall" ON "nav_nodes" USING btree ("warehouse_id" int4_ops,"hall_id" int4_ops,"floor_level" int4_ops);--> statement-breakpoint
ALTER TABLE "mhe_types" ADD CONSTRAINT "uq_mhe_types_class_bit" UNIQUE("class_bit");--> statement-breakpoint
ALTER TABLE "mhe_types" ADD CONSTRAINT "chk_mhe_class_bit_range" CHECK (class_bit IS NULL OR (class_bit >= 0 AND class_bit <= 52));--> statement-breakpoint
INSERT INTO "feature_kinds" ("kind","category","label","default_geometry_kind","default_width_mm","default_length_mm","default_height_mm","is_obstacle_default","default_color","sort_order") VALUES
	('TRAVEL_LANE','NAVIGATION','Travel lane','POLYLINE',NULL,NULL,NULL,false,'#0f766e',110),
	('MAIN_ROAD','NAVIGATION','Main road','POLYLINE',NULL,NULL,NULL,false,'#0d9488',111),
	('CROSS_AISLE','NAVIGATION','Cross aisle','POLYLINE',NULL,NULL,NULL,false,'#14b8a6',112),
	('PEDESTRIAN_WALKWAY','NAVIGATION','Pedestrian walkway','POLYLINE',NULL,NULL,NULL,false,'#65a30d',113),
	('CROSSING','NAVIGATION','Crossing','RECT',2000,1500,NULL,false,'#84cc16',114),
	('SPEED_ZONE','NAVIGATION','Speed-restricted zone','POLYGON',NULL,NULL,NULL,false,'#fbbf24',115),
	('BLIND_CORNER','NAVIGATION','Blind corner','POINT',NULL,NULL,NULL,false,'#f97316',116),
	('GIVE_WAY','NAVIGATION','Give way','POINT',NULL,NULL,NULL,false,'#ef4444',117),
	('VEHICLE_EXCLUSION','NAVIGATION','Vehicle exclusion','POLYGON',NULL,NULL,NULL,false,'#dc2626',118),
	('PEDESTRIAN_EXCLUSION','NAVIGATION','Pedestrian exclusion','POLYGON',NULL,NULL,NULL,false,'#b91c1c',119)
ON CONFLICT ("kind") DO NOTHING;--> statement-breakpoint
-- Bit 0 is reserved for foot traffic. Treating "on foot" as a vehicle class is
-- what lets one bitmask express both "walkway, no forklifts" and "VNA aisle,
-- no pedestrians".
INSERT INTO "mhe_types" ("name","requires_license","class_bit","is_pedestrian","width_mm","length_mm","height_mm","turning_radius_mm","min_aisle_width_mm","max_speed_laden_mms","max_speed_unladen_mms")
VALUES ('Pedestrian', false, 0, true, 600, 400, 1800, 0, 800, 1400, 1400)
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
-- Assign class bits to any pre-existing MHE types that have none, so the
-- compiler has a mask to work with on day one.
WITH numbered AS (
	SELECT mhe_type_id, ROW_NUMBER() OVER (ORDER BY mhe_type_id) AS rn
	FROM mhe_types WHERE class_bit IS NULL
)
UPDATE mhe_types m SET class_bit = n.rn + COALESCE((SELECT MAX(class_bit) FROM mhe_types), 0)
FROM numbered n WHERE m.mhe_type_id = n.mhe_type_id;
