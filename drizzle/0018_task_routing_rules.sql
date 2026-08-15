CREATE TABLE "task_routing_rules" (
	"rule_id" serial PRIMARY KEY NOT NULL,
	"warehouse_id" integer NOT NULL,
	"task_type_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uq_task_routing_rules_wh_type_dept" UNIQUE("warehouse_id","task_type_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "task_routing_rules" ADD CONSTRAINT "task_routing_rules_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_routing_rules" ADD CONSTRAINT "task_routing_rules_task_type_id_fkey" FOREIGN KEY ("task_type_id") REFERENCES "public"."task_types"("task_type_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_routing_rules" ADD CONSTRAINT "task_routing_rules_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_task_routing_rules_lookup" ON "task_routing_rules" USING btree ("warehouse_id" int4_ops,"task_type_id" int4_ops);--> statement-breakpoint

-- RLS, matching the per-table policies established in 0017. Every other
-- table in `public` carries one, so a new table without one would be the
-- single hole in that pattern -- and this one names which team gets which
-- work, which is tenant data like any other.
ALTER TABLE "public"."task_routing_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "task_routing_rules_select_own_org" ON "public"."task_routing_rules"
  FOR SELECT TO authenticated USING ("warehouse_id" IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id()));