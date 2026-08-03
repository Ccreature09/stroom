ALTER TABLE "zone_areas" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "zone_types" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- zone_areas dropped before zone_types (it FKs to zone_types). CASCADE on
-- zone_types below also auto-drops locations_zone_id_fkey,
-- layout_features_zone_id_fkey and nav_edges_zone_id_fkey -- verified in a
-- rolled-back dry run -- so those constraints are not dropped explicitly here;
-- doing so after the CASCADE already removed them would error.
DROP TABLE "zone_areas" CASCADE;--> statement-breakpoint
DROP TABLE "zone_types" CASCADE;--> statement-breakpoint
DROP INDEX "idx_locations_zone_lookup";--> statement-breakpoint
ALTER TABLE "layout_features" DROP COLUMN "zone_id";--> statement-breakpoint
ALTER TABLE "locations" DROP COLUMN "zone_id";--> statement-breakpoint
ALTER TABLE "nav_edges" DROP COLUMN "zone_id";
