-- Stable, geometry-derived identity for a nav edge.
--
-- edge_id is a serial and "Recompile graph" deletes every generated row and
-- inserts replacements, so the same physical aisle gets a new id each time.
-- The traffic tables cascaded off that serial, which meant a routine recompile
-- silently destroyed all traversal history, learned travel times and the
-- damped congestion state. This adds the key; migration 0015 moves the traffic
-- tables onto it and drops edge_id.
--
-- The key must reproduce `edgeKeyFor` in lib/warehouse-map/graph-compiler.ts
-- exactly. Two details make that true:
--   * Math.round(v) === Math.floor(v + 0.5) for every finite v, hence
--     floor(x / 250.0 + 0.5) rather than SQL's round(), which breaks ties away
--     from zero where JS breaks them towards +Infinity.
--   * COLLATE "C" on the endpoint comparison, so canonical ordering is by byte
--     like JS string comparison. A locale-aware collation can ignore
--     punctuation, which would order "-13:52" against "1200:840" differently
--     from the compiler and produce a key it never generates.

ALTER TABLE "nav_edges" ADD COLUMN "edge_key" varchar(80);--> statement-breakpoint

WITH k AS (
  SELECT
    e."edge_id",
    f."floor_level"::text AS fl,
    floor(f."x_mm" / 250.0 + 0.5)::bigint::text || ':' ||
      floor(f."y_mm" / 250.0 + 0.5)::bigint::text AS ka,
    floor(t."x_mm" / 250.0 + 0.5)::bigint::text || ':' ||
      floor(t."y_mm" / 250.0 + 0.5)::bigint::text AS kb
  FROM "nav_edges" e
  JOIN "nav_nodes" f ON f."node_id" = e."from_node_id"
  JOIN "nav_nodes" t ON t."node_id" = e."to_node_id"
)
UPDATE "nav_edges" e
SET "edge_key" = CASE
  WHEN k.ka COLLATE "C" <= k.kb COLLATE "C"
    THEN k.fl || ':' || k.ka || '|' || k.kb
    ELSE k.fl || ':' || k.kb || '|' || k.ka
  END
FROM k
WHERE k."edge_id" = e."edge_id";--> statement-breakpoint

-- Unreachable while the from/to foreign keys hold, but NOT NULL below must not
-- be able to fail on a row the join missed.
UPDATE "nav_edges" SET "edge_key" = 'orphan:' || "edge_id"::text
WHERE "edge_key" IS NULL;--> statement-breakpoint

ALTER TABLE "nav_edges" ALTER COLUMN "edge_key" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_nav_edges_key" ON "nav_edges" USING btree ("hall_id" int4_ops,"edge_key" text_ops);--> statement-breakpoint

-- Traffic tables inherit their key through edge_id, which still exists at this
-- point. Nothing is dropped or recreated, so any history that does exist
-- carries across intact.
ALTER TABLE "edge_traversals" ADD COLUMN "edge_key" varchar(80);--> statement-breakpoint
UPDATE "edge_traversals" x SET "edge_key" = e."edge_key"
FROM "nav_edges" e WHERE e."edge_id" = x."edge_id";--> statement-breakpoint
ALTER TABLE "edge_traversals" ALTER COLUMN "edge_key" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "edge_traffic_stats" ADD COLUMN "edge_key" varchar(80);--> statement-breakpoint
UPDATE "edge_traffic_stats" x SET "edge_key" = e."edge_key"
FROM "nav_edges" e WHERE e."edge_id" = x."edge_id";--> statement-breakpoint
ALTER TABLE "edge_traffic_stats" ALTER COLUMN "edge_key" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "edge_congestion_state" ADD COLUMN "edge_key" varchar(80);--> statement-breakpoint
UPDATE "edge_congestion_state" x SET "edge_key" = e."edge_key"
FROM "nav_edges" e WHERE e."edge_id" = x."edge_id";--> statement-breakpoint
ALTER TABLE "edge_congestion_state" ALTER COLUMN "edge_key" SET NOT NULL;
