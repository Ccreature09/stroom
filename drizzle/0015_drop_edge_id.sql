-- Moves the traffic tables onto the stable edge_key added in 0014 and retires
-- edge_id. After this, recompiling the nav graph no longer cascades away
-- traversal history, learned travel time or congestion state -- history
-- detaches only for edges whose geometry genuinely changed.

ALTER TABLE "edge_traffic_stats" DROP CONSTRAINT "uq_edge_traffic_stats_bucket";--> statement-breakpoint
ALTER TABLE "edge_traversals" DROP CONSTRAINT "uq_edge_traversal_event";--> statement-breakpoint

-- The cascading foreign keys are the whole defect: they are what turned
-- "replace the generated rows" into "erase the history".
ALTER TABLE "edge_congestion_state" DROP CONSTRAINT "edge_congestion_state_edge_id_fkey";--> statement-breakpoint
ALTER TABLE "edge_traffic_stats" DROP CONSTRAINT "edge_traffic_stats_edge_id_fkey";--> statement-breakpoint
ALTER TABLE "edge_traversals" DROP CONSTRAINT "edge_traversals_edge_id_fkey";--> statement-breakpoint

DROP INDEX "idx_edge_traffic_stats_edge";--> statement-breakpoint
DROP INDEX "idx_edge_traversals_edge_time";--> statement-breakpoint

-- The old primary key has to go before the new one is added: Postgres permits
-- only one per table, and drizzle-kit emitted these in the opposite order.
ALTER TABLE "edge_congestion_state" DROP CONSTRAINT "edge_congestion_state_pkey";--> statement-breakpoint

ALTER TABLE "edge_congestion_state" DROP COLUMN "edge_id";--> statement-breakpoint
ALTER TABLE "edge_traffic_stats" DROP COLUMN "edge_id";--> statement-breakpoint
ALTER TABLE "edge_traversals" DROP COLUMN "edge_id";--> statement-breakpoint

-- Every key below is (hall_id, edge_key): the key is built from hall-local
-- coordinates, so it is only unique within a hall.
ALTER TABLE "edge_congestion_state" ADD CONSTRAINT "edge_congestion_state_pkey" PRIMARY KEY("hall_id","edge_key");--> statement-breakpoint
CREATE INDEX "idx_edge_traffic_stats_edge" ON "edge_traffic_stats" USING btree ("hall_id" int4_ops,"edge_key" text_ops,"bucket_start" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_edge_traversals_edge_time" ON "edge_traversals" USING btree ("hall_id" int4_ops,"edge_key" text_ops,"entered_at" timestamptz_ops);--> statement-breakpoint
ALTER TABLE "edge_traffic_stats" ADD CONSTRAINT "uq_edge_traffic_stats_bucket" UNIQUE("hall_id","edge_key","bucket_start");--> statement-breakpoint
ALTER TABLE "edge_traversals" ADD CONSTRAINT "uq_edge_traversal_event" UNIQUE("hall_id","edge_key","asset_kind","asset_ref_id","entered_at");
