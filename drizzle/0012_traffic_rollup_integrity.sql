-- Indexes the traffic rollup actually reads on. Both of its hot queries filter
-- by hall_id first, and no existing index on either table led with it, so the
-- two highest-volume tables in the schema were being scanned every run.
CREATE INDEX "idx_asset_position_history_hall_time" ON "asset_position_history" USING btree ("hall_id" int4_ops,"observed_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_edge_traversals_hall_time" ON "edge_traversals" USING btree ("hall_id" int4_ops,"exited_at" timestamptz_ops);--> statement-breakpoint

-- Any duplicates already written by concurrent rollups have to go before the
-- constraint can exist. Keeping the lowest traversal_id per event is
-- arbitrary but safe: duplicates are byte-identical apart from the serial,
-- because they were produced by re-running the same computation over the same
-- history rows.
DELETE FROM "edge_traversals" a
USING "edge_traversals" b
WHERE a."traversal_id" > b."traversal_id"
  AND a."edge_id" = b."edge_id"
  AND a."asset_kind" = b."asset_kind"
  AND a."asset_ref_id" = b."asset_ref_id"
  AND a."entered_at" = b."entered_at";--> statement-breakpoint

-- One asset enters one edge at most once at a given instant. This is what
-- makes the rollup genuinely idempotent rather than idempotent-by-comment:
-- concurrent runs recompute the same traversals from the same high-water
-- mark, and onConflictDoNothing now discards the loser instead of both
-- inserting and permanently inflating every count and percentile downstream.
ALTER TABLE "edge_traversals" ADD CONSTRAINT "uq_edge_traversal_event" UNIQUE("edge_id","asset_kind","asset_ref_id","entered_at");
