-- Free-roam navigable areas.
--
-- A lane is a centreline; an open working area has none, so the compiler fills
-- it with a lattice of nodes instead. Those edges need their own kind so the
-- canvas can draw them faintly and so "how much of this graph is inferred
-- open floor?" stays an answerable question.
ALTER TABLE "nav_edges" DROP CONSTRAINT "chk_nav_edge_kind";--> statement-breakpoint
ALTER TABLE "nav_edges" ADD CONSTRAINT "chk_nav_edge_kind" CHECK ((edge_kind)::text = ANY ((ARRAY['LANE'::character varying, 'AISLE'::character varying, 'CROSS_AISLE'::character varying, 'WALKWAY'::character varying, 'PORTAL'::character varying, 'ACCESS'::character varying, 'YARD'::character varying, 'ZONE'::character varying])::text[]));--> statement-breakpoint

-- POLYGON so an area can follow the shape of the floor it actually covers,
-- and is_obstacle_default false because a zone is travel space -- marking it
-- an obstacle would make it block its own lattice.
INSERT INTO "feature_kinds" ("kind","category","label","default_geometry_kind","default_width_mm","default_length_mm","default_height_mm","is_obstacle_default","default_color","sort_order") VALUES
	('DRIVE_ZONE','NAVIGATION','Drive area (free roam)','POLYGON',NULL,NULL,NULL,false,'#0891b2',105),
	('WORK_ZONE','NAVIGATION','Work area (on foot)','POLYGON',NULL,NULL,NULL,false,'#4d7c0f',106)
ON CONFLICT ("kind") DO NOTHING;
