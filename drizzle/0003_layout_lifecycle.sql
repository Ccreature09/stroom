CREATE TABLE "hall_underlays" (
	"underlay_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"hall_id" integer NOT NULL,
	"floor_level" integer DEFAULT 1 NOT NULL,
	"storage_path" text NOT NULL,
	"original_filename" varchar(255),
	"mime_type" varchar(100),
	"file_size_bytes" integer,
	"image_width_px" integer,
	"image_height_px" integer,
	"scale_mm_per_px" numeric(12, 6) DEFAULT '10.000000' NOT NULL,
	"offset_x_mm" integer DEFAULT 0 NOT NULL,
	"offset_y_mm" integer DEFAULT 0 NOT NULL,
	"rotation_degrees" integer DEFAULT 0 NOT NULL,
	"opacity" numeric(3, 2) DEFAULT '0.60' NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"calib_measured_mm" integer,
	"calib_known_mm" integer,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uq_hall_underlays_hall_floor" UNIQUE("hall_id","floor_level"),
	CONSTRAINT "chk_underlay_rotation_range" CHECK ((rotation_degrees >= 0) AND (rotation_degrees < 360)),
	CONSTRAINT "chk_underlay_opacity_range" CHECK ((opacity >= 0) AND (opacity <= 1)),
	CONSTRAINT "chk_underlay_scale_positive" CHECK (scale_mm_per_px > 0)
);
--> statement-breakpoint
CREATE TABLE "layout_drafts" (
	"draft_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"hall_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"state" jsonb NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"base_version_number" integer DEFAULT 0 NOT NULL,
	"change_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uq_layout_drafts_hall_employee" UNIQUE("hall_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "layout_versions" (
	"version_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"status" varchar(20) DEFAULT 'PUBLISHED' NOT NULL,
	"graph_epoch" integer DEFAULT 1 NOT NULL,
	"change_count" integer DEFAULT 0 NOT NULL,
	"notes" varchar(500),
	"published_by" integer,
	"published_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uq_layout_versions_wh_number" UNIQUE("warehouse_id","version_number"),
	CONSTRAINT "chk_layout_version_status" CHECK ((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'PUBLISHED'::character varying, 'ARCHIVED'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "hall_underlays" ADD CONSTRAINT "hall_underlays_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("hall_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_underlays" ADD CONSTRAINT "hall_underlays_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_underlays" ADD CONSTRAINT "hall_underlays_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."employees"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_drafts" ADD CONSTRAINT "layout_drafts_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("hall_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_drafts" ADD CONSTRAINT "layout_drafts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_drafts" ADD CONSTRAINT "layout_drafts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_versions" ADD CONSTRAINT "layout_versions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_versions" ADD CONSTRAINT "layout_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."employees"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_layout_versions_current" ON "layout_versions" USING btree ("warehouse_id" int4_ops,"version_number" int4_ops);