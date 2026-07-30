CREATE TABLE "edge_traffic_stats" (
	"stat_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"hall_id" integer NOT NULL,
	"edge_id" integer NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"bucket_minutes" integer DEFAULT 15 NOT NULL,
	"traversal_count" integer DEFAULT 0 NOT NULL,
	"p50_duration_ms" integer,
	"p95_duration_ms" integer,
	"mean_occupancy" numeric(6, 2),
	"observed_speed_mms" integer,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uq_edge_traffic_stats_bucket" UNIQUE("edge_id","bucket_start"),
	CONSTRAINT "chk_edge_traffic_stats_count" CHECK (traversal_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "edge_traversals" (
	"traversal_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"hall_id" integer NOT NULL,
	"edge_id" integer NOT NULL,
	"asset_kind" varchar(20) NOT NULL,
	"asset_ref_id" integer NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	"exited_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	CONSTRAINT "chk_edge_traversal_duration" CHECK (duration_ms >= 0),
	CONSTRAINT "chk_edge_traversal_order" CHECK (exited_at >= entered_at)
);
--> statement-breakpoint
ALTER TABLE "edge_traffic_stats" ADD CONSTRAINT "edge_traffic_stats_edge_id_fkey" FOREIGN KEY ("edge_id") REFERENCES "public"."nav_edges"("edge_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_traffic_stats" ADD CONSTRAINT "edge_traffic_stats_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_traversals" ADD CONSTRAINT "edge_traversals_edge_id_fkey" FOREIGN KEY ("edge_id") REFERENCES "public"."nav_edges"("edge_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_traversals" ADD CONSTRAINT "edge_traversals_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_edge_traffic_stats_edge" ON "edge_traffic_stats" USING btree ("edge_id" int4_ops,"bucket_start" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_edge_traffic_stats_warehouse_bucket" ON "edge_traffic_stats" USING btree ("warehouse_id" int4_ops,"bucket_start" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_edge_traversals_edge_time" ON "edge_traversals" USING btree ("edge_id" int4_ops,"entered_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_edge_traversals_warehouse_time" ON "edge_traversals" USING btree ("warehouse_id" int4_ops,"entered_at" timestamptz_ops);