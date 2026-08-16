CREATE TABLE "vas_rule_steps" (
	"step_id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"instruction" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vas_rules" (
	"rule_id" serial PRIMARY KEY NOT NULL,
	"warehouse_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"applies_to" varchar(20) DEFAULT 'ALL' NOT NULL,
	"customer_id" integer,
	"item_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "chk_vas_rule_applies_to" CHECK ((applies_to)::text = ANY ((ARRAY['ALL'::character varying, 'CUSTOMER'::character varying, 'ITEM'::character varying])::text[])),
	CONSTRAINT "chk_vas_rule_target" CHECK ((applies_to = 'ALL' AND customer_id IS NULL AND item_id IS NULL)
       OR (applies_to = 'CUSTOMER' AND customer_id IS NOT NULL)
       OR (applies_to = 'ITEM' AND item_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "vas_task_steps" (
	"step_id" serial PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"instruction" text NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp,
	"done_by_employee_id" integer
);
--> statement-breakpoint
CREATE TABLE "vas_tasks" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"so_id" integer NOT NULL,
	"lpn_id" varchar(50),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "warehouse_task_settings" (
	"setting_id" serial PRIMARY KEY NOT NULL,
	"warehouse_id" integer NOT NULL,
	"task_type_id" integer NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"auto_create" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uq_warehouse_task_settings" UNIQUE("warehouse_id","task_type_id")
);
--> statement-breakpoint
ALTER TABLE "vas_rule_steps" ADD CONSTRAINT "vas_rule_steps_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "public"."vas_rules"("rule_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vas_rules" ADD CONSTRAINT "vas_rules_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vas_rules" ADD CONSTRAINT "vas_rules_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vas_rules" ADD CONSTRAINT "vas_rules_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vas_task_steps" ADD CONSTRAINT "vas_task_steps_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."vas_tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vas_task_steps" ADD CONSTRAINT "vas_task_steps_done_by_employee_id_fkey" FOREIGN KEY ("done_by_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vas_tasks" ADD CONSTRAINT "vas_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vas_tasks" ADD CONSTRAINT "vas_tasks_so_id_fkey" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("so_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vas_tasks" ADD CONSTRAINT "vas_tasks_lpn_id_fkey" FOREIGN KEY ("lpn_id") REFERENCES "public"."pallets"("lpn_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_task_settings" ADD CONSTRAINT "warehouse_task_settings_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_task_settings" ADD CONSTRAINT "warehouse_task_settings_task_type_id_fkey" FOREIGN KEY ("task_type_id") REFERENCES "public"."task_types"("task_type_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_vas_rules_warehouse" ON "vas_rules" USING btree ("warehouse_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_vas_task_steps_task" ON "vas_task_steps" USING btree ("task_id" uuid_ops);--> statement-breakpoint

-- RLS, matching the per-table policies established in 0017. Warehouse-scoped
-- tables filter on their own warehouse_id; child tables reach their parent.
ALTER TABLE "public"."warehouse_task_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "warehouse_task_settings_select_own_org" ON "public"."warehouse_task_settings"
  FOR SELECT TO authenticated USING ("warehouse_id" IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id()));--> statement-breakpoint
ALTER TABLE "public"."vas_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "vas_rules_select_own_org" ON "public"."vas_rules"
  FOR SELECT TO authenticated USING ("warehouse_id" IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id()));--> statement-breakpoint
ALTER TABLE "public"."vas_rule_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "vas_rule_steps_select_own_org" ON "public"."vas_rule_steps"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.vas_rules p WHERE p.rule_id = public.vas_rule_steps.rule_id AND p.warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id())));--> statement-breakpoint
ALTER TABLE "public"."vas_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "vas_tasks_select_own_org" ON "public"."vas_tasks"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tasks p WHERE p.task_id = public.vas_tasks.task_id AND p.warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id())));--> statement-breakpoint
ALTER TABLE "public"."vas_task_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "vas_task_steps_select_own_org" ON "public"."vas_task_steps"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.vas_tasks v JOIN public.tasks p ON p.task_id = v.task_id WHERE v.task_id = public.vas_task_steps.task_id AND p.warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id())));
