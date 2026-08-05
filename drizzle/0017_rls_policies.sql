-- Row Level Security policies for every table in `public`.
--
-- CONTEXT, because it changes what this migration is for:
--
-- The application does NOT read or write through PostgREST. `lib/db.ts`
-- connects with the postgres driver as the `postgres` role, which carries
-- rolbypassrls, so RLS never applies to it. The Supabase client is used only
-- for auth.getClaims, storage, and Realtime channels -- there is not a single
-- supabase.from() or .rpc() call in the codebase.
--
-- So RLS being enabled with zero policies did not break anything: it made the
-- auto-generated REST/GraphQL surface deny-all while the app carried on
-- untouched. These policies therefore are not a fix. They are two things:
--
--   1. Defence in depth. The day the app stops connecting as a superuser --
--      or a service is added that does use PostgREST -- the tenant boundary
--      is already enforced by the database rather than only by
--      requireLayoutContext / requireLiveMapHall in application code.
--   2. An executable statement of the tenancy model. Every predicate below
--      says, in one line, how a table reaches its owning organisation.
--
-- SELECT ONLY, deliberately. Every write in this application goes through a
-- server action on the bypassrls connection, so `authenticated` needs no
-- INSERT/UPDATE/DELETE. Granting none keeps the write surface sealed: adding
-- write policies later should be a deliberate act, per table, with its own
-- reasoning. `anon` is granted nothing at all.

-- ---------------------------------------------------------------------------
-- Who is asking
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER is required, not incidental: every policy below calls this,
-- including the one on `employees` itself. A plain function would re-enter
-- that policy and recurse forever. Running as owner reads `employees` once,
-- outside RLS, and returns a single integer.
--
-- search_path is pinned empty and every reference schema-qualified, so the
-- function cannot be hijacked by a caller-controlled search_path -- the
-- standard hardening for SECURITY DEFINER.
--
-- Returns NULL when there is no JWT (a direct postgres connection, or an
-- unauthenticated request). NULL makes every `= app_current_org_id()`
-- predicate NULL, which RLS treats as false -- so the failure mode is
-- deny-all rather than allow-all.
CREATE OR REPLACE FUNCTION public.app_current_org_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.organization_id
  FROM public.employees e
  WHERE e.auth_user_id = (SELECT auth.uid())
    AND e.is_active = true
  LIMIT 1;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_current_org_id() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_current_org_id() TO authenticated;--> statement-breakpoint

-- Direct tenant column -----------------------------------------------------
CREATE POLICY "organizations_select_own_org" ON "public"."organizations"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "employees_select_own_org" ON "public"."employees"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "warehouses_select_own_org" ON "public"."warehouses"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "halls_select_own_org" ON "public"."halls"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "carriers_select_own_org" ON "public"."carriers"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "customers_select_own_org" ON "public"."customers"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "items_select_own_org" ON "public"."items"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "suppliers_select_own_org" ON "public"."suppliers"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "layout_features_select_own_org" ON "public"."layout_features"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "layout_versions_select_own_org" ON "public"."layout_versions"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "layout_drafts_select_own_org" ON "public"."layout_drafts"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "layout_blockages_select_own_org" ON "public"."layout_blockages"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "hall_underlays_select_own_org" ON "public"."hall_underlays"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "nav_nodes_select_own_org" ON "public"."nav_nodes"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "nav_edges_select_own_org" ON "public"."nav_edges"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "location_access_points_select_own_org" ON "public"."location_access_points"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "route_plans_select_own_org" ON "public"."route_plans"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "asset_positions_select_own_org" ON "public"."asset_positions"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "asset_position_history_select_own_org" ON "public"."asset_position_history"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "edge_traversals_select_own_org" ON "public"."edge_traversals"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "edge_traffic_stats_select_own_org" ON "public"."edge_traffic_stats"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "purchase_orders_select_own_org" ON "public"."purchase_orders"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "sales_orders_select_own_org" ON "public"."sales_orders"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "shipments_select_own_org" ON "public"."shipments"
  FOR SELECT TO authenticated USING (organization_id = public.app_current_org_id());--> statement-breakpoint
CREATE POLICY "inventory_statuses_select_own_org" ON "public"."inventory_statuses"
  FOR SELECT TO authenticated USING (organization_id IS NULL OR organization_id = public.app_current_org_id());--> statement-breakpoint

-- Reached through warehouses -----------------------------------------------
CREATE POLICY "locations_select_own_org" ON "public"."locations"
  FOR SELECT TO authenticated USING (warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "mhe_types_select_own_org" ON "public"."mhe_types"
  FOR SELECT TO authenticated USING (warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "pallets_select_own_org" ON "public"."pallets"
  FOR SELECT TO authenticated USING (warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "tasks_select_own_org" ON "public"."tasks"
  FOR SELECT TO authenticated USING (warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "nav_turn_restrictions_select_own_org" ON "public"."nav_turn_restrictions"
  FOR SELECT TO authenticated USING (warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "edge_congestion_state_select_own_org" ON "public"."edge_congestion_state"
  FOR SELECT TO authenticated USING (warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "time_clock_entries_select_own_org" ON "public"."time_clock_entries"
  FOR SELECT TO authenticated USING (warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "departments_select_own_org" ON "public"."departments"
  FOR SELECT TO authenticated USING (warehouse_id IS NULL OR warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "position_types_select_own_org" ON "public"."position_types"
  FOR SELECT TO authenticated USING (warehouse_id IS NULL OR warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id()));--> statement-breakpoint

-- Reached through an owning parent row. The outer column is schema-qualified
-- on purpose: unqualified, Postgres binds it to the subquery's own table and
-- the join collapses to `p.x = p.x`, which is always true and leaks the lot.
CREATE POLICY "booking_tasks_select_own_org" ON "public"."booking_tasks"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tasks p WHERE p.task_id = public.booking_tasks.task_id AND p.warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id())));--> statement-breakpoint
CREATE POLICY "cycle_count_tasks_select_own_org" ON "public"."cycle_count_tasks"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tasks p WHERE p.task_id = public.cycle_count_tasks.task_id AND p.warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id())));--> statement-breakpoint
CREATE POLICY "loading_tasks_select_own_org" ON "public"."loading_tasks"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tasks p WHERE p.task_id = public.loading_tasks.task_id AND p.warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id())));--> statement-breakpoint
CREATE POLICY "picking_tasks_select_own_org" ON "public"."picking_tasks"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tasks p WHERE p.task_id = public.picking_tasks.task_id AND p.warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id())));--> statement-breakpoint
CREATE POLICY "putaway_tasks_select_own_org" ON "public"."putaway_tasks"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tasks p WHERE p.task_id = public.putaway_tasks.task_id AND p.warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id())));--> statement-breakpoint
CREATE POLICY "replenishment_tasks_select_own_org" ON "public"."replenishment_tasks"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tasks p WHERE p.task_id = public.replenishment_tasks.task_id AND p.warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id())));--> statement-breakpoint
CREATE POLICY "unloading_tasks_select_own_org" ON "public"."unloading_tasks"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tasks p WHERE p.task_id = public.unloading_tasks.task_id AND p.warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id())));--> statement-breakpoint
CREATE POLICY "task_eligible_departments_select_own_org" ON "public"."task_eligible_departments"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tasks p WHERE p.task_id = public.task_eligible_departments.task_id AND p.warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id())));--> statement-breakpoint
CREATE POLICY "employee_departments_select_own_org" ON "public"."employee_departments"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.employees p WHERE p.employee_id = public.employee_departments.employee_id AND p.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "employee_licenses_select_own_org" ON "public"."employee_licenses"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.employees p WHERE p.employee_id = public.employee_licenses.employee_id AND p.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "purchase_order_lines_select_own_org" ON "public"."purchase_order_lines"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.purchase_orders p WHERE p.po_id = public.purchase_order_lines.po_id AND p.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "sales_order_lines_select_own_org" ON "public"."sales_order_lines"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.sales_orders p WHERE p.so_id = public.sales_order_lines.so_id AND p.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "shipment_sales_orders_select_own_org" ON "public"."shipment_sales_orders"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.shipments p WHERE p.shipment_id = public.shipment_sales_orders.shipment_id AND p.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "inventory_select_own_org" ON "public"."inventory"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.locations p WHERE p.location_id = public.inventory.location_id AND p.warehouse_id IN (SELECT w.warehouse_id FROM public.warehouses w WHERE w.organization_id = public.app_current_org_id())) OR EXISTS (SELECT 1 FROM public.items p WHERE p.item_id = public.inventory.item_id AND p.organization_id = public.app_current_org_id()));--> statement-breakpoint
CREATE POLICY "stock_movements_select_own_org" ON "public"."stock_movements"
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.items p WHERE p.item_id = public.stock_movements.item_id AND p.organization_id = public.app_current_org_id()) OR EXISTS (SELECT 1 FROM public.employees p WHERE p.employee_id = public.stock_movements.employee_id AND p.organization_id = public.app_current_org_id()));--> statement-breakpoint

-- Global lookups: these carry no tenant dimension at all, so every
-- authenticated user shares them. Writes stay closed.
CREATE POLICY "feature_kinds_select_own_org" ON "public"."feature_kinds"
  FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY "task_statuses_select_own_org" ON "public"."task_statuses"
  FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY "task_types_select_own_org" ON "public"."task_types"
  FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY "warehouse_configs_select_own_org" ON "public"."warehouse_configs"
  FOR SELECT TO authenticated USING (true);
