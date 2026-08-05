-- Equipment catalogue becomes per-warehouse.
--
-- Sites within one organisation genuinely run different fleets (long EPTs at
-- one, OPTs at another), and aisle-width requirements are a fact about a
-- building rather than a company. This also gives each warehouse its own
-- class_bit space: vehicle masks are only ever compared within a single
-- warehouse's nav graph, so the 31-slot ceiling stops being shared across
-- every tenant in the database.

-- Global uniques go first -- they would otherwise reject the per-warehouse
-- copies made below.
ALTER TABLE "mhe_types" DROP CONSTRAINT "mhe_types_name_key";--> statement-breakpoint
ALTER TABLE "mhe_types" DROP CONSTRAINT "uq_mhe_types_class_bit";--> statement-breakpoint

-- Nullable first: the column has to be backfilled before it can be NOT NULL.
ALTER TABLE "mhe_types" ADD COLUMN "warehouse_id" integer;--> statement-breakpoint

-- Fan the existing warehouse-less catalogue out to every warehouse, so no site
-- loses equipment it was already using. Every warehouse except the lowest-id
-- one gets fresh copies...
INSERT INTO "mhe_types" (
  "warehouse_id","name","requires_license","max_weight_capacity_kg",
  "max_reach_height_mm","class_bit","is_pedestrian","width_mm","length_mm",
  "height_mm","turning_radius_mm","min_aisle_width_mm","max_speed_laden_mms",
  "max_speed_unladen_mms"
)
SELECT
  w."warehouse_id", m."name", m."requires_license", m."max_weight_capacity_kg",
  m."max_reach_height_mm", m."class_bit", m."is_pedestrian", m."width_mm",
  m."length_mm", m."height_mm", m."turning_radius_mm", m."min_aisle_width_mm",
  m."max_speed_laden_mms", m."max_speed_unladen_mms"
FROM "mhe_types" m
CROSS JOIN "warehouses" w
WHERE m."warehouse_id" IS NULL
  AND w."warehouse_id" <> (SELECT min("warehouse_id") FROM "warehouses");--> statement-breakpoint

-- ...and the lowest-id warehouse keeps the ORIGINAL rows, so their
-- mhe_type_id values survive and anything already pointing at them
-- (employee_licenses, tasks.mhe_type_required, route_plans.mhe_type_id)
-- stays valid.
UPDATE "mhe_types"
SET "warehouse_id" = (SELECT min("warehouse_id") FROM "warehouses")
WHERE "warehouse_id" IS NULL;--> statement-breakpoint

-- Only reachable when the database has no warehouses at all, in which case a
-- warehouse-less catalogue belongs to nothing and cannot satisfy NOT NULL.
DELETE FROM "mhe_types" WHERE "warehouse_id" IS NULL;--> statement-breakpoint

ALTER TABLE "mhe_types" ALTER COLUMN "warehouse_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mhe_types" ADD CONSTRAINT "mhe_types_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("warehouse_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mhe_types_warehouse" ON "mhe_types" USING btree ("warehouse_id" int4_ops);--> statement-breakpoint
ALTER TABLE "mhe_types" ADD CONSTRAINT "uq_mhe_types_warehouse_name" UNIQUE("warehouse_id","name");--> statement-breakpoint
ALTER TABLE "mhe_types" ADD CONSTRAINT "uq_mhe_types_warehouse_class_bit" UNIQUE("warehouse_id","class_bit");
