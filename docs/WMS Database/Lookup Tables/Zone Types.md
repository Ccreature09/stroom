
**Removed.** `zone_types` and `zone_areas` (plus `zone_id` on `locations`, `layout_features`, and `nav_edges`) were dropped in migration `0010_drop_zones`. In practice every location's `zone_id` was `NULL` and nothing in the app ever read `storage_permanence`, `is_pickable`, `requires_barcode_scan`, or the other zone-derived fields -- the zone/zone-area system never had a consumer.

The one thing zones were actually being used for -- marking a slot as temporary staging rather than permanent storage -- is now a plain `is_temporary BOOLEAN` column directly on [[Locations]].

If a future feature needs the richer per-area rules zones offered (pickability, scan requirements, hazmat/temperature clearance), rebuild it against a real consumer rather than resurrecting this table speculatively.
