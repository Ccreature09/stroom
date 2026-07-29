CREATE TABLE "route_plans" (
	"route_plan_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"hall_id" integer NOT NULL,
	"task_id" uuid,
	"mhe_type_id" integer,
	"from_node_id" integer NOT NULL,
	"to_node_id" integer NOT NULL,
	"edge_ids" integer[] NOT NULL,
	"stops" jsonb,
	"est_duration_ms" integer NOT NULL,
	"est_distance_mm" integer NOT NULL,
	"layout_version" integer DEFAULT 0 NOT NULL,
	"graph_epoch" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	"superseded_by" integer,
	CONSTRAINT "chk_route_plan_duration" CHECK (est_duration_ms >= 0),
	CONSTRAINT "chk_route_plan_distance" CHECK (est_distance_mm >= 0)
);
--> statement-breakpoint
ALTER TABLE "mhe_types" DROP CONSTRAINT "chk_mhe_class_bit_range";--> statement-breakpoint
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("hall_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_mhe_type_id_fkey" FOREIGN KEY ("mhe_type_id") REFERENCES "public"."mhe_types"("mhe_type_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_route_plans_task" ON "route_plans" USING btree ("task_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_route_plans_stamp" ON "route_plans" USING btree ("warehouse_id" int4_ops,"layout_version" int4_ops,"graph_epoch" int4_ops);--> statement-breakpoint
ALTER TABLE "mhe_types" ADD CONSTRAINT "chk_mhe_class_bit_range" CHECK (class_bit IS NULL OR (class_bit >= 0 AND class_bit <= 30));