CREATE TABLE "inventory_serials" (
	"serial_id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"serial_number" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'IN_STOCK' NOT NULL,
	"location_id" integer,
	"batch_number" varchar(50),
	"lot_number" varchar(50),
	"expiry_date" date,
	"inventory_status_id" integer,
	"lpn_id" varchar(50),
	"po_line_id" integer,
	"so_id" integer,
	"shipment_id" uuid,
	"received_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"picked_at" timestamp,
	"shipped_at" timestamp,
	"received_by_employee_id" integer,
	"picked_by_employee_id" integer,
	CONSTRAINT "chk_inventory_serial_status" CHECK (status::text = ANY (ARRAY['IN_STOCK'::text, 'PICKED'::text, 'SHIPPED'::text, 'CONSUMED'::text]))
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_serial_tracked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "picking_tasks" ADD COLUMN "so_id" integer;--> statement-breakpoint
ALTER TABLE "inventory_serials" ADD CONSTRAINT "inventory_serials_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_serials" ADD CONSTRAINT "inventory_serials_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_serials" ADD CONSTRAINT "inventory_serials_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("location_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_serials" ADD CONSTRAINT "inventory_serials_inventory_status_id_fkey" FOREIGN KEY ("inventory_status_id") REFERENCES "public"."inventory_statuses"("status_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_serials" ADD CONSTRAINT "inventory_serials_lpn_id_fkey" FOREIGN KEY ("lpn_id") REFERENCES "public"."pallets"("lpn_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_serials" ADD CONSTRAINT "inventory_serials_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("po_line_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_serials" ADD CONSTRAINT "inventory_serials_so_id_fkey" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("so_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_serials" ADD CONSTRAINT "inventory_serials_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("shipment_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_serials" ADD CONSTRAINT "inventory_serials_received_by_employee_id_fkey" FOREIGN KEY ("received_by_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_serials" ADD CONSTRAINT "inventory_serials_picked_by_employee_id_fkey" FOREIGN KEY ("picked_by_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inventory_serials_org_item_number" ON "inventory_serials" USING btree ("organization_id" int4_ops,"item_id" int4_ops,upper(serial_number));--> statement-breakpoint
CREATE INDEX "idx_inventory_serials_location" ON "inventory_serials" USING btree ("location_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_inventory_serials_item" ON "inventory_serials" USING btree ("item_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_inventory_serials_so" ON "inventory_serials" USING btree ("so_id" int4_ops);--> statement-breakpoint
ALTER TABLE "picking_tasks" ADD CONSTRAINT "picking_tasks_so_id_fkey" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("so_id") ON DELETE set null ON UPDATE no action;

-- RLS, matching the per-table policies established in 0017. Serials are
-- org-scoped directly rather than through a warehouse, because a serial
-- outlives its location: once shipped it has no warehouse to reach through.
ALTER TABLE "public"."inventory_serials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "inventory_serials_select_own_org" ON "public"."inventory_serials"
  FOR SELECT TO authenticated USING ("organization_id" = public.app_current_org_id());--> statement-breakpoint

-- Backfill the new picking_tasks.so_id from the pallet-name convention it
-- replaces (`PICK-<so_number>`), so existing picks keep their order link
-- instead of being stranded when the parsing code goes away. Only touches
-- rows where the name actually resolves to a real order in the same
-- warehouse; anything ambiguous is left null rather than guessed at.
UPDATE "public"."picking_tasks" pt
SET "so_id" = so."so_id"
FROM "public"."tasks" t, "public"."sales_orders" so
WHERE t."task_id" = pt."task_id"
  AND pt."so_id" IS NULL
  AND pt."lpn_id" = 'PICK-' || so."so_number"
  AND so."warehouse_id" = t."warehouse_id";
