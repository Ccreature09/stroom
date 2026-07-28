CREATE TABLE "feature_kinds" (
	"kind" varchar(40) PRIMARY KEY NOT NULL,
	"category" varchar(20) NOT NULL,
	"label" varchar(60) NOT NULL,
	"default_geometry_kind" varchar(10) NOT NULL,
	"default_width_mm" integer,
	"default_length_mm" integer,
	"default_height_mm" integer,
	"is_obstacle_default" boolean DEFAULT true NOT NULL,
	"default_color" varchar(7) NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "chk_feature_kind_category" CHECK ((category)::text = ANY ((ARRAY['STRUCTURE'::character varying, 'LOGISTICS'::character varying, 'WORKSTATION'::character varying, 'FACILITY'::character varying, 'HAZARD'::character varying, 'NAVIGATION'::character varying, 'ANNOTATION'::character varying])::text[])),
	CONSTRAINT "chk_feature_kind_geometry" CHECK ((default_geometry_kind)::text = ANY ((ARRAY['RECT'::character varying, 'POLYGON'::character varying, 'POLYLINE'::character varying, 'POINT'::character varying, 'CIRCLE'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "layout_features" (
	"feature_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"hall_id" integer NOT NULL,
	"floor_level" integer DEFAULT 1 NOT NULL,
	"kind" varchar(40) NOT NULL,
	"geometry_kind" varchar(10) NOT NULL,
	"origin_x_mm" integer DEFAULT 0 NOT NULL,
	"origin_y_mm" integer DEFAULT 0 NOT NULL,
	"width_mm" integer DEFAULT 0 NOT NULL,
	"length_mm" integer DEFAULT 0 NOT NULL,
	"rotation_degrees" integer DEFAULT 0 NOT NULL,
	"points" jsonb,
	"envelope_min_x_mm" integer DEFAULT 0 NOT NULL,
	"envelope_min_y_mm" integer DEFAULT 0 NOT NULL,
	"envelope_max_x_mm" integer DEFAULT 0 NOT NULL,
	"envelope_max_y_mm" integer DEFAULT 0 NOT NULL,
	"elevation_mm" integer DEFAULT 0 NOT NULL,
	"height_mm" integer,
	"layer_index" integer DEFAULT 0 NOT NULL,
	"is_obstacle" boolean DEFAULT true NOT NULL,
	"is_visual_only" boolean DEFAULT false NOT NULL,
	"impedance_multiplier" numeric(5, 2) DEFAULT '1.00' NOT NULL,
	"zone_id" integer,
	"label" varchar(100),
	"color" varchar(7),
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attrs_version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "chk_feature_rotation_range" CHECK ((rotation_degrees >= 0) AND (rotation_degrees < 360)),
	CONSTRAINT "chk_feature_geometry_kind" CHECK ((geometry_kind)::text = ANY ((ARRAY['RECT'::character varying, 'POLYGON'::character varying, 'POLYLINE'::character varying, 'POINT'::character varying, 'CIRCLE'::character varying])::text[])),
	CONSTRAINT "chk_feature_envelope" CHECK ((envelope_max_x_mm >= envelope_min_x_mm) AND (envelope_max_y_mm >= envelope_min_y_mm))
);
--> statement-breakpoint
CREATE TABLE "zone_areas" (
	"zone_area_id" serial PRIMARY KEY NOT NULL,
	"zone_id" integer NOT NULL,
	"hall_id" integer NOT NULL,
	"floor_level" integer DEFAULT 1 NOT NULL,
	"points" jsonb NOT NULL,
	"envelope_min_x_mm" integer DEFAULT 0 NOT NULL,
	"envelope_min_y_mm" integer DEFAULT 0 NOT NULL,
	"envelope_max_x_mm" integer DEFAULT 0 NOT NULL,
	"envelope_max_y_mm" integer DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "locations" DROP CONSTRAINT "locations_location_code_key";--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "location_type" varchar(20) DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
UPDATE "locations" SET "location_type" = CASE
	WHEN "is_racking" THEN 'RACKING'
	WHEN "is_shelf" THEN 'SHELF'
	WHEN "is_floor_storage" THEN 'FLOOR'
	ELSE 'NONE'
END;--> statement-breakpoint
ALTER TABLE "layout_features" ADD CONSTRAINT "layout_features_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("hall_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_features" ADD CONSTRAINT "layout_features_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_features" ADD CONSTRAINT "layout_features_kind_fkey" FOREIGN KEY ("kind") REFERENCES "public"."feature_kinds"("kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_features" ADD CONSTRAINT "layout_features_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."zone_types"("zone_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_areas" ADD CONSTRAINT "zone_areas_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."zone_types"("zone_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_areas" ADD CONSTRAINT "zone_areas_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("hall_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_layout_features_canvas_render" ON "layout_features" USING btree ("warehouse_id" int4_ops,"hall_id" int4_ops,"floor_level" int4_ops,"envelope_min_x_mm" int4_ops,"envelope_min_y_mm" int4_ops) WHERE (is_active = true);--> statement-breakpoint
CREATE INDEX "idx_layout_features_kind" ON "layout_features" USING btree ("warehouse_id" int4_ops,"kind" text_ops);--> statement-breakpoint
CREATE INDEX "idx_zone_areas_hall" ON "zone_areas" USING btree ("hall_id" int4_ops,"floor_level" int4_ops);--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "uq_locations_wh_code" UNIQUE("warehouse_id","location_code");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "chk_location_type" CHECK ((location_type)::text = ANY ((ARRAY['RACKING'::character varying, 'SHELF'::character varying, 'FLOOR'::character varying, 'NONE'::character varying])::text[]));--> statement-breakpoint
INSERT INTO "feature_kinds" ("kind","category","label","default_geometry_kind","default_width_mm","default_length_mm","default_height_mm","is_obstacle_default","default_color","sort_order") VALUES
	('WALL_EXTERIOR','STRUCTURE','Exterior wall','POLYLINE',NULL,NULL,8000,true,'#334155',10),
	('WALL_INTERIOR','STRUCTURE','Interior wall','POLYLINE',NULL,NULL,3000,true,'#475569',11),
	('PARTITION','STRUCTURE','Partition','POLYLINE',NULL,NULL,2400,true,'#64748b',12),
	('COLUMN','STRUCTURE','Support column','RECT',400,400,8000,true,'#1e293b',13),
	('DOOR_PERSONNEL','STRUCTURE','Personnel door','RECT',1000,200,2100,false,'#0891b2',14),
	('GATE','STRUCTURE','Gate','RECT',3000,200,3000,false,'#0e7490',15),
	('ROLLER_SHUTTER','STRUCTURE','Roller shutter','RECT',3000,300,4000,false,'#155e75',16),
	('STAIRS','STRUCTURE','Stairs','RECT',1200,3000,3000,true,'#64748b',17),
	('GOODS_LIFT','STRUCTURE','Goods lift','RECT',2500,2500,3000,true,'#475569',18),
	('RAMP','STRUCTURE','Ramp','RECT',3000,6000,0,false,'#94a3b8',19),
	('MEZZANINE_DECK','STRUCTURE','Mezzanine deck','POLYGON',NULL,NULL,0,false,'#cbd5e1',20),
	('FIRE_EXIT','STRUCTURE','Fire exit','POINT',NULL,NULL,NULL,false,'#dc2626',21),
	('FIRE_EQUIPMENT','STRUCTURE','Fire equipment','POINT',NULL,NULL,NULL,false,'#ef4444',22),
	('ASSEMBLY_POINT','STRUCTURE','Assembly point','POINT',NULL,NULL,NULL,false,'#16a34a',23),
	('FIRST_AID','STRUCTURE','First aid','POINT',NULL,NULL,NULL,false,'#22c55e',24),
	('DOCK_DOOR','LOGISTICS','Dock door','RECT',3000,400,4200,false,'#2563eb',30),
	('DOCK_LEVELER','LOGISTICS','Dock leveler','RECT',2000,2500,0,false,'#1d4ed8',31),
	('TRUCK_BAY','LOGISTICS','Truck bay','RECT',3500,16000,NULL,false,'#93c5fd',32),
	('TRAILER_PARKING','LOGISTICS','Trailer parking','RECT',3500,16000,NULL,false,'#bfdbfe',33),
	('STAGING_AREA','LOGISTICS','Staging area','POLYGON',NULL,NULL,NULL,false,'#60a5fa',34),
	('CROSS_DOCK_LANE','LOGISTICS','Cross-dock lane','POLYGON',NULL,NULL,NULL,false,'#3b82f6',35),
	('QUARANTINE_AREA','LOGISTICS','Quarantine area','POLYGON',NULL,NULL,NULL,false,'#f59e0b',36),
	('RETURNS_AREA','LOGISTICS','Returns area','POLYGON',NULL,NULL,NULL,false,'#fbbf24',37),
	('DAMAGE_AREA','LOGISTICS','Damage area','POLYGON',NULL,NULL,NULL,false,'#f97316',38),
	('WEIGH_SCALE','LOGISTICS','Weigh scale','RECT',2000,3000,NULL,true,'#0891b2',39),
	('GATEHOUSE','LOGISTICS','Gatehouse','RECT',4000,3000,3000,true,'#0e7490',40),
	('PACK_STATION','WORKSTATION','Pack station','RECT',2000,1000,900,true,'#16a34a',50),
	('VAS_DESK','WORKSTATION','VAS desk','RECT',2000,1000,900,true,'#22c55e',51),
	('QA_INSPECTION','WORKSTATION','QA / inspection','RECT',2000,1200,900,true,'#10b981',52),
	('RETURNS_DESK','WORKSTATION','Returns desk','RECT',2000,1000,900,true,'#34d399',53),
	('PUT_WALL','WORKSTATION','Put wall','RECT',3000,600,2000,true,'#059669',54),
	('CONVEYOR_SEGMENT','WORKSTATION','Conveyor','POLYLINE',NULL,NULL,400,true,'#6b7280',55),
	('CHARGING_STATION','WORKSTATION','Charging station','RECT',1500,2000,2000,true,'#eab308',56),
	('MHE_PARKING','WORKSTATION','MHE parking','POLYGON',NULL,NULL,NULL,false,'#fde047',57),
	('PRINTER','WORKSTATION','Printer','POINT',NULL,NULL,NULL,false,'#64748b',58),
	('OFFICE','FACILITY','Office','POLYGON',NULL,NULL,2700,true,'#a78bfa',70),
	('MEETING_ROOM','FACILITY','Meeting room','POLYGON',NULL,NULL,2700,true,'#c4b5fd',71),
	('RESTROOM','FACILITY','Restroom','POLYGON',NULL,NULL,2700,true,'#ddd6fe',72),
	('BREAK_ROOM','FACILITY','Break room','POLYGON',NULL,NULL,2700,true,'#ede9fe',73),
	('LOCKER_ROOM','FACILITY','Locker room','POLYGON',NULL,NULL,2700,true,'#d8b4fe',74),
	('MAINTENANCE_WORKSHOP','FACILITY','Maintenance workshop','POLYGON',NULL,NULL,3000,true,'#a855f7',75),
	('ELECTRICAL_ROOM','FACILITY','Electrical room','RECT',3000,2000,2700,true,'#7c3aed',76),
	('HAZMAT_STORAGE','HAZARD','Hazmat storage','POLYGON',NULL,NULL,NULL,true,'#dc2626',90),
	('BATTERY_ROOM','HAZARD','Battery room','RECT',6000,4000,3000,true,'#b91c1c',91),
	('TEMPERATURE_CHAMBER','HAZARD','Temperature chamber','POLYGON',NULL,NULL,NULL,true,'#06b6d4',92),
	('HIGH_VALUE_CAGE','HAZARD','High-value cage','POLYGON',NULL,NULL,2400,true,'#7f1d1d',93),
	('CCTV_CAMERA','HAZARD','CCTV camera','POINT',NULL,NULL,NULL,false,'#737373',94),
	('NO_ENTRY_ZONE','HAZARD','No-entry zone','POLYGON',NULL,NULL,NULL,true,'#991b1b',95)
ON CONFLICT ("kind") DO NOTHING;
