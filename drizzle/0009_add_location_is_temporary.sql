ALTER TABLE "locations" ADD COLUMN "is_temporary" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Backfill from the zone-based scheme being replaced: any location whose zone
-- was TEMPORARY/FLUID_BUFFER becomes is_temporary = true before zone_id is
-- dropped in the next migration.
UPDATE "locations" l
SET "is_temporary" = true
FROM "zone_types" z
WHERE l."zone_id" = z."zone_id"
  AND z."storage_permanence" IN ('TEMPORARY', 'FLUID_BUFFER');
