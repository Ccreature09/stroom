# Warehouse Layout Designer & Live Map — Architecture

## Module boundary

Designing the map and watching it are different jobs, done by different people,
under different permissions. They are separate modules:

| Module | Path | Purpose |
| --- | --- | --- |
| **Shared domain** | `lib/warehouse-map/` | geometry, DTOs, feature catalog, graph compiler, router, live-map core, server context. No UI, no React. |
| **Layout Designer** | `app/warehouses/[id]/layout-designer/` | Design time only: draw, edit, draft, publish, compile the graph, preview routes. Requires `can_modify_locations`. |
| **Live Map** | `app/warehouses/[id]/live-map/` | Operational, read-only over the *published* layout: live assets, blockages, congestion. Requires `can_view_metrics`; reporting a blockage requires `can_assign_tasks`. |

The designer cannot mutate live state and the live map cannot mutate geometry.
Each has its own Pixi renderer rather than one component in two modes — the
designer needs hit testing, drag handles, draft state and undo; the live map
needs none of that and instead redraws moving assets every frame for hours.
Sharing one component would drag all the editing machinery into a view that must
never mutate anything.


Design document. Nothing here is implemented yet; it is a target architecture for
extending the existing layout designer (`app/warehouses/[warehouseId]/layout-designer/`,
Pixi.js v8 + `pixi-viewport`, mm world coordinates) from "racking editor" into a
full digital twin plus live operational map.

> **Update:** `zone_types` and `zone_areas` were dropped (migration `0010_drop_zones`)
> -- every location's `zone_id` was `NULL` in practice and nothing read the
> zone-derived fields, so the "Zones become spatial" plan below (§1.4) and every
> other zone/zone-area reference in this document describe a system that no
> longer exists. The one real need zones served -- flagging a location as
> temporary staging -- is now `locations.is_temporary`. The zone-geometry,
> zone-impedance, and point-in-zone sections below are unrevised; treat them as
> a shelved plan to reconsider, not current direction, until someone decides
> whether to rebuild that richer per-area model against an actual consumer.

**Where we are today**

| Concern | Current state |
| --- | --- |
| Envelope | `halls` — a rectangle (`physical_width_mm` × `physical_length_mm`, `clear_height_mm`) |
| Storage | `locations` — OBB (`physical_x/y`, `physical_width/length_mm`, `rotation_degrees`), `floor_level`, `aisle/bay/level/row`, three type booleans |
| Zones | `zone_types` — **attributes only, no geometry** |
| Vehicles | `mhe_types` — name, license flag, weight capacity, reach height |
| Work | `tasks` + 8 subtype tables; `booking_tasks.dock_door_location_id → locations` |
| Transport | Supabase (`@supabase/ssr`), Postgres via `postgres`; **no realtime channel in use yet** |
| Draft editing | `HallState` in `types.ts` — autosaved to `layout_drafts`, mirrored to `localStorage` as an offline fallback |
| Storage | Private `layout-underlays` bucket, read through short-lived signed URLs |

Three structural facts drive most of what follows:

1. **`locations` is being used as a catch-all for "things with a footprint."** Dock
   doors already live there (`booking_tasks.dock_door_location_id`). Walls, columns,
   and pack stations must *not* follow them in.
2. **Zones have no geometry.** Nothing can answer "which zone is this worker
   standing in," which is a hard prerequisite for the live map.
3. **There is no navigation model at all.** Distance today can only be Euclidean,
   which is wrong the moment a rack run sits between two points.

---

## 1. Comprehensive Element Catalog

### 1.1 The core split: storage vs. features vs. network

Three tables, three different lifecycles. Do not merge them.

| Table | Means | Lifecycle | Referenced by |
| --- | --- | --- | --- |
| `locations` | *Inventory can be here.* Has a code, holds stock. | Rarely changes; historical rows referenced forever by `stock_movements` | inventory, tasks, movements |
| `layout_features` | *Physical/logical thing on the floor that is not a bin.* | Edited freely in the designer | graph edges, live map |
| `nav_nodes` / `nav_edges` | *Where things can travel.* | Regenerated on publish | routes, telemetry |

The rule of thumb: **if a putaway algorithm could ever choose it, it is a
`location`. Otherwise it is a `layout_feature`.** Staging areas are the interesting
boundary case — see §5.4.

### 1.2 Feature kinds

One `feature_kind` enum, one table, kind-specific attributes in validated JSONB
(§3.3). Grouped by `feature_category` for layer toggles and legend grouping.

**A. Structural envelope** (`STRUCTURE`)

| Kind | Geometry | Key attributes |
| --- | --- | --- |
| `WALL_EXTERIOR`, `WALL_INTERIOR`, `PARTITION` | polyline + thickness | `thickness_mm`, `height_mm`, `is_fire_rated` |
| `COLUMN` | rect / circle | `height_mm`, `is_load_bearing` — the #1 cause of "the rack doesn't actually fit" |
| `DOOR_PERSONNEL`, `GATE`, `ROLLER_SHUTTER`, `SPEED_DOOR` | polyline (opening) | `clear_width_mm`, `clear_height_mm`, `swing`, `is_fire_exit`, `access_control_id` |
| `STAIRS`, `GOODS_LIFT`, `PASSENGER_LIFT`, `RAMP` | polygon | `connects_floors[]`, `capacity_kg`, `cycle_time_ms`, `allowed_vehicle_mask` |
| `MEZZANINE_DECK`, `FLOOR_OPENING`, `PIT`, `DOCK_LEVELER` | polygon | `floor_level`, `elevation_mm`, `deck_capacity_kg_m2` |
| `FIRE_EXIT`, `FIRE_EQUIPMENT`, `ASSEMBLY_POINT`, `FIRST_AID`, `EYEWASH` | point | `keepout_radius_mm` (legally mandated clearance) |

**B. Inbound / outbound** (`LOGISTICS`)

| Kind | Geometry | Key attributes |
| --- | --- | --- |
| `DOCK_DOOR` | rect on wall | `door_number`, `direction` (IN/OUT/BOTH), `leveler_type`, `trailer_types[]`, `clear_height_mm`, `is_refrigerated` |
| `TRUCK_BAY`, `TRAILER_PARKING`, `YARD_SLOT` | polygon | `slot_code`, `trailer_length_mm`, `has_power` (reefer) |
| `STAGING_AREA` | polygon | `direction`, `slot_grid` (rows/cols/pitch), `capacity_pallets`, `dwell_target_ms` |
| `CROSS_DOCK_LANE` | polygon | `source_dock_ids[]`, `dest_dock_ids[]` |
| `QUARANTINE_AREA`, `RETURNS_AREA`, `DAMAGE_AREA` | polygon | `requires_qa_release` |
| `WEIGH_SCALE`, `GATEHOUSE`, `SEAL_CHECK` | point/rect | `max_weight_kg` |

**C. Processing & equipment** (`WORKSTATION`)

| Kind | Geometry | Key attributes |
| --- | --- | --- |
| `PACK_STATION`, `VAS_DESK`, `QA_INSPECTION`, `RETURNS_DESK` | rect | `station_code`, `headcount_capacity`, `throughput_uph`, `department_id`, `required_position_type_id` |
| `PUT_WALL`, `SORTER_INDUCT`, `SORTER_CHUTE` | rect / polygon | `cubby_count`, `chute_number` |
| `CONVEYOR_SEGMENT` | polyline | `direction`, `speed_mms`, `is_crossable` (does it split the floor?), `elevation_mm` |
| `CHARGING_STATION`, `BATTERY_SWAP`, `LPG_SWAP` | rect | `bay_count`, `mhe_type_ids[]`, `charge_time_ms`, `requires_ventilation` |
| `MHE_PARKING`, `CART_PARK`, `PALLET_STACK` | polygon | `capacity`, `mhe_type_ids[]` |
| `PRINTER`, `SCAN_TUNNEL`, `TOOL_CRIB`, `BALER`, `WASTE` | point/rect | `device_id` (links to hardware inventory) |

**D. Non-operational** (`FACILITY`) — matters because it is *floor area that is not
storage and not travel*: `OFFICE`, `MEETING_ROOM`, `RESTROOM`, `BREAK_ROOM`,
`LOCKER_ROOM`, `CANTEEN`, `SERVER_ROOM`, `ELECTRICAL_ROOM`, `MAINTENANCE_WORKSHOP`.
Attributes: `headcount`, `is_pedestrian_only`, `excluded_from_utilization_kpi`.

**E. Hazard & regulatory** (`HAZARD`)

| Kind | Key attributes |
| --- | --- |
| `HAZMAT_STORAGE`, `FLAMMABLES_CABINET` | `un_classes[]`, `segregation_distance_mm`, `max_quantity_kg` |
| `BATTERY_ROOM` | `ventilation_required`, `no_ignition_radius_mm` |
| `TEMPERATURE_CHAMBER` | `min_c`, `max_c`, `airlock_feature_id`, `max_dwell_ms` |
| `HIGH_VALUE_CAGE`, `SECURITY_CHECKPOINT` | `access_role_ids[]`, `requires_two_person` |
| `CCTV_CAMERA` | `heading_deg`, `fov_deg`, `range_mm` — render the cone; coverage gaps are a real supervisor question |
| `NO_ENTRY_ZONE`, `RESTRICTED_ZONE` | `allowed_vehicle_mask`, `allowed_role_ids[]` |

**F. Navigation & traffic** (`NAVIGATION`) — these are *authored* features that
compile into the graph (§2.4), not the graph itself.

| Kind | Geometry | Key attributes |
| --- | --- | --- |
| `TRAVEL_LANE`, `MAIN_ROAD`, `CROSS_AISLE` | polyline + width | `direction`, `width_mm`, `max_speed_mms`, `allowed_vehicle_mask`, `min_clearance_mm`, `max_axle_load_kg` |
| `PEDESTRIAN_WALKWAY` | polyline + width | `is_vehicle_prohibited`, `is_protected` (barrier) |
| `CROSSING`, `INTERSECTION` | point / polygon | `priority`, `has_mirror`, `has_traffic_light`, `stop_required` |
| `SPEED_ZONE` | polygon | `max_speed_mms` — overrides edges it contains |
| `BLIND_CORNER`, `GIVE_WAY`, `MIRROR` | point | `impedance_multiplier` |
| `VEHICLE_EXCLUSION`, `PEDESTRIAN_EXCLUSION` | polygon | `allowed_vehicle_mask` |

**G. Annotation** (`ANNOTATION`) — never affects logic, always renders:
`TEXT_LABEL`, `DIMENSION_LINE`, `LEGEND`, `UNDERLAY_IMAGE` (§5.6), `GRID_GUIDE`,
`AREA_MEASURE`.

### 1.3 Attributes every feature carries

```
feature_id, organization_id, warehouse_id, hall_id, floor_level
feature_kind, feature_category
geometry_kind      RECT | POLYGON | POLYLINE | POINT | CIRCLE
origin_x_mm, origin_y_mm        -- anchor, consistent with locations.physical_x/y
rotation_degrees                -- 0..359, same check constraint as locations
width_mm, length_mm             -- RECT/CIRCLE fast path (matches today's editor)
points                          -- jsonb [[x,y],…] for POLYGON/POLYLINE
envelope_min_x/y, envelope_max_x/y  -- generated AABB *after* rotation, for indexing
elevation_mm, height_mm         -- vertical extent: z ∈ [elevation, elevation+height]
layer_index                     -- render/z order within a floor
is_obstacle                     -- blocks travel
is_visual_only                  -- annotation
impedance_multiplier            -- ≥1.0, slows travel through it (congested lane, ramp)
zone_id                         -- optional link to zone_types
color, opacity, icon, label
is_active, valid_from, valid_to -- soft lifecycle; never hard-delete referenced features
attrs jsonb                     -- kind-specific, validated per §3.3
```

`elevation_mm` + `height_mm` is what makes a conveyor at 2.4 m *not* an obstacle for
a pedestrian passing under it, and a mezzanine deck an obstacle only on the floor
below. Do not model height as a boolean.

### 1.4 Zones become spatial

`zone_types` today is an attribute bag. Add geometry as a separate table so a zone
can be several disjoint polygons and can keep its attribute row stable:

```
zone_areas(zone_area_id, zone_id → zone_types, hall_id, floor_level,
           points jsonb, envelope_*, priority)
```

Zone attributes then extend with the operational knobs the live map needs:
`max_speed_mms`, `allowed_vehicle_mask`, `requires_ppe[]`, `max_occupancy`,
`temperature_min_c/max_c`, `impedance_multiplier`.

Locations keep their `zone_id` FK as the authoritative assignment (a bin's zone is a
business fact, not a geometry accident); zone *areas* are used for point-in-polygon
lookups on moving assets and for "assign all locations inside this polygon" tooling.

---

## 2. Graph Infrastructure & Pathfinding Spec

### 2.1 Recommendation: explicit node/edge graph, not a grid

Use a **persisted node-and-edge graph** as the authoritative navigation model.

Warehouses are not open terrain — they are corridor networks. A 50 m × 30 m hall at
100 mm grid resolution is 150,000 cells; the same hall as a graph is roughly 200–600
nodes. The graph wins on every axis that matters here:

- **Stable IDs.** A route can be stored as `[edge_id]` in a task row and still mean
  the same thing tomorrow. Grid cell indices break the moment the hall is resized.
- **Rich constraints per edge.** One-way, vehicle class, clearance, weight, speed —
  all natural on an edge, awkward on a cell.
- **Cheap.** A* over 10³ nodes is tens of microseconds in plain JS. No need for
  contraction hierarchies or precomputed all-pairs (§2.7 has the one exception).
- **Editable.** A supervisor can drag a lane; you cannot meaningfully hand-edit a
  bitmap.

Use a **local grid only for the last metre** — approach into a staging area or an
open yard, where movement genuinely is free-form. Generate it on demand from the
feature obstacles in the local bounding box; never persist it.

### 2.2 Node and edge model

```sql
nav_nodes(
  node_id bigserial pk,
  organization_id, warehouse_id, hall_id, floor_level,
  x_mm int, y_mm int,
  node_kind text,      -- WAYPOINT|INTERSECTION|ACCESS|DOCK|PORTAL|CHARGE|PARK|STAGE
  portal_group_id int, -- lift/stairs shafts share a group across floors
  capacity smallint default 1,   -- concurrent occupants before congestion
  is_generated bool,   -- true = compiled from features, false = hand-placed
  layout_version int
)

nav_edges(
  edge_id bigserial pk,
  organization_id, warehouse_id, hall_id,
  from_node_id, to_node_id,
  traversal text,             -- BIDIRECTIONAL | FORWARD_ONLY | REVERSE_ONLY
  edge_kind text,             -- LANE|AISLE|CROSS_AISLE|WALKWAY|PORTAL|ACCESS|YARD
  length_mm int,              -- authoritative; polyline length, not straight-line
  points jsonb,               -- optional intermediate vertices for curved lanes
  width_mm int,
  max_speed_mms int,
  min_clearance_mm int,       -- vertical: door heights, conveyor underpasses
  max_weight_kg int,
  max_vehicle_width_mm int,
  allowed_vehicle_mask bigint not null,  -- see §2.3
  impedance numeric(5,2) default 1.0,
  fixed_delay_ms int default 0,          -- lift cycle, door open, stop sign
  zone_id int,
  source_feature_id bigint,   -- provenance when compiled from a TRAVEL_LANE
  layout_version int
)
```

Store each physical connection **once** with a `traversal` enum and expand to two
directed arcs in memory. Storing both directions in the table doubles the rows a
designer has to keep consistent and makes one-way edits error-prone.

### 2.3 Vehicle classes as a bitmask

Extend `mhe_types` into a proper capability profile and give each one a bit:

```sql
alter table mhe_types add column
  class_bit int,                -- 0..62, unique per warehouse
  width_mm int, length_mm int, height_mm int,
  turning_radius_mm int,
  min_aisle_width_mm int,       -- right-angle stacking aisle
  max_speed_laden_mms int, max_speed_unladen_mms int,
  lift_height_mm int,
  is_pedestrian bool,           -- "on foot" is a vehicle class: bit 0
  requires_license_type_id int; -- ties to employee_licenses
```

`allowed_vehicle_mask` on an edge is then `bit_or` of permitted classes, and the A*
filter is a single `mask & (1 << classBit)` — branchless, and indexable server-side.
Pedestrians are class bit 0; this is what makes "walkway, no forklifts" and
"VNA aisle, no pedestrians" the same mechanism.

**Design-time validation** falls out for free: for every aisle edge, flag any
`mhe_type` whose `min_aisle_width_mm > edge.width_mm` but which is still in the
allowed mask. That catches the classic "we bought reach trucks for a VNA aisle"
mistake before it reaches the floor.

### 2.4 Compiling the graph from the layout

The designer should not require hand-placing hundreds of nodes. Compile, then allow
override:

1. **Seed from authored features.** Every `TRAVEL_LANE` / `CROSS_AISLE` /
   `PEDESTRIAN_WALKWAY` polyline becomes a chain of nodes at its vertices.
2. **Infer aisle centerlines.** Racking already carries `aisle` numbers and OBBs.
   For each aisle, take the facing rack runs, compute the free corridor between
   them, and lay a centerline down it. This is the single highest-value automation
   in the whole feature — it turns an existing bulk-generated layout into a routable
   network with zero extra authoring.
3. **Intersect and split.** Split every lane at crossings, insert `INTERSECTION`
   nodes, dedupe nodes within a snap tolerance (~250 mm).
4. **Connect portals.** Doors, gates, ramps, lifts and stairs become `PORTAL` edges
   joining nodes on either side (and across `floor_level` for vertical connectors),
   inheriting `clear_width_mm` / `clear_height_mm` as edge constraints.
5. **Subtract obstacles.** Any edge whose corridor intersects an `is_obstacle`
   feature (column, wall, cage) at overlapping z-range is either clipped or rejected
   with a designer warning. Columns in aisles are extremely common — flag, don't
   silently delete.
6. **Attach access points** (§2.5).
7. **Validate.** Connectivity check per vehicle class: every location access node
   must be reachable from every dock node for at least one class, else surface the
   orphan set in the UI. An unreachable pick face is a production incident waiting
   to happen; catch it at publish time.

Compilation is deterministic and runs on **publish**, writing a new `layout_version`.
Hand-placed nodes (`is_generated = false`) survive recompilation and are merged in.

### 2.5 Connecting bins to the network

```sql
location_access_points(
  access_point_id bigserial pk,
  location_id int → locations,
  node_id bigint → nav_nodes,
  approach_heading_deg int,     -- which way the operator/truck faces
  face text,                    -- FRONT|BACK|LEFT|RIGHT of the location OBB
  offset_mm int,                -- distance from node to the pick face
  handling_time_ms int,         -- fixed cost: dismount, scan, lift, place
  allowed_vehicle_mask bigint,
  is_primary bool
)
```

Notes that matter in practice:

- **Level drives handling time, not travel time.** A bin at level 4 sits at the same
  (x, y) as level 1 — the aisle travel is identical; the *lift* time is not. Model
  it as `handling_time_ms = base + level_factor × height_mm`, not as graph distance.
  Today's `groupByBayFootprint()` already encodes this insight on the render side.
- **Multiple access points are normal.** Double-deep racking or back-to-back runs
  are reachable from two aisles at different costs; A* should consider all of them.
- Generalize the same table for features: `feature_access_points` (or one polymorphic
  `access_points` with `target_kind`/`target_id`) so pack stations, dock doors and
  charging bays are routable destinations too.

### 2.6 Cost model and search

Cost is **time**, never distance:

```
edge_cost_ms = (length_mm / effective_speed_mms) × impedance × zone_impedance
             + fixed_delay_ms
             + turn_penalty(prev_edge, this_edge, vehicle)
effective_speed = min(edge.max_speed, zone.max_speed, vehicle.max_speed_laden)
```

Two implementation points that are easy to get wrong:

**Turn penalties require a directed-arc state space.** If your A* node is "graph
node," you cannot express "turning 90° here costs 3 s" because the cost depends on
the *incoming* edge. Search over `(edge_id, direction)` states instead — the arc you
just traversed *is* the state. Successor generation reads adjacency of
`edge.to_node`. Turn cost is then `f(angle_between(prev, next), vehicle.turning_radius)`.

> **Update:** a sparse `nav_turn_restrictions(from_edge_id, to_edge_id,
> penalty_ms, is_forbidden)` table for hand-authored exceptions ("no left turn
> out of the dock lane") was created with the graph and **dropped in migration
> `0019`** — it was never written to, never read, and had no UI, so it was an
> empty table documenting an intention rather than a behaviour. Turn cost is
> angle-derived, full stop. The directed-arc state space above is the hard
> prerequisite and it stays, so re-adding per-turn overrides later is a small
> additive migration rather than a redesign.

**Keep the heuristic admissible.** If cost is milliseconds and the heuristic is
Euclidean distance, you must divide by the network's *maximum* speed:
`h = euclidean_mm / max_speed_across_network`. Dividing by the vehicle's speed
over-estimates on fast lanes and quietly returns non-optimal paths. For multi-floor,
add `|Δfloor| × min_portal_cost`.

**Determinism matters.** With symmetric layouts, many paths tie exactly. Break ties
on `(f, -g, edge_id)` so the same request always returns the same route — otherwise
the worker's handheld redraws a different-but-equal path on every poll and they lose
trust in it immediately.

### 2.7 In-memory representation & spatial indexing

Build once per `layout_version`, cache in module scope keyed by
`(warehouse_id, layout_version)`:

```ts
type CompiledGraph = {
  version: number;
  nodeX: Int32Array; nodeY: Int32Array; nodeFloor: Int8Array;
  arcOffset: Int32Array;      // CSR: arcOffset[n]..arcOffset[n+1]
  arcTarget: Int32Array;
  arcEdgeId: Int32Array;
  arcLength: Float32Array;
  arcSpeed: Float32Array;
  arcMask: BigInt64Array;     // vehicle-class bitmask
  arcClearance: Int32Array;
  nodeIndex: UniformGrid;     // 2 m buckets → nearest-node lookup
};
```

Compressed-sparse-row typed arrays keep the whole graph in a few hundred KB and
cache-resident. Avoid object graphs — the allocation churn dominates the search.

Spatial indexing, three tiers:

- **Postgres:** enable PostGIS and add `geom geometry(Geometry, 0)` (SRID 0 — this
  is a local mm Cartesian frame, not geographic) to `layout_features`, `zone_areas`,
  `nav_edges`, with GiST indexes. Needed for point-in-zone on telemetry,
  `ST_DWithin` proximity, and heatmap aggregation. Without PostGIS you can get most
  of the way with the generated `envelope_*` columns and a btree/GiST `box` index,
  but containment against rotated polygons then has to happen in app code.
- **Server memory:** the uniform grid above for nearest-node and the flat CSR graph.
- **Client:** ship the same compiled graph to the browser (it is small) so the
  designer can preview routes and the live map can interpolate positions without a
  round trip.

### 2.8 Beyond point-to-point

Once the graph exists, the valuable queries are not single routes:

- **Pick path sequencing** = TSP over access points. Nearest-neighbour seeded with
  the aisle order, then 2-opt, bounded by a time budget; or the classic S-shape /
  return / largest-gap heuristics, which are near-optimal in conventional racking
  and far cheaper. Requires a distance matrix over access nodes — precompute
  all-pairs among access + dock + station nodes on publish and cache it
  (a few thousand nodes ⇒ a Dijkstra per source, seconds total, done once).
- **Slotting scoring**: total weighted travel time for a period's order history under
  a candidate assignment. This is the metric that justifies the whole graph.
- **What-if layout comparison**: two `layout_version`s, same order history, diff the
  travel time.

---

## 3. Database Schema Recommendations

### 3.1 New tables

| Table | Purpose |
| --- | --- |
| `hall_floors` | per-floor definition: `floor_level`, `elevation_mm`, `clear_height_mm`, `floor_capacity_kg_m2`, `outline` polygon. Halls are not always one rectangle per floor. |
| `layout_features` | §1.3 |
| `feature_kinds` | lookup: kind → category, default geometry kind, default style, `is_obstacle_default` |
| `zone_areas` | §1.4 |
| `nav_nodes`, `nav_edges` | §2.2, §2.6 |
| `location_access_points`, `feature_access_points` | §2.5 |
| `layout_versions` | `version_id`, `warehouse_id`, `status` (DRAFT/PUBLISHED/ARCHIVED), `published_at`, `published_by`, `graph_epoch`, `notes` |
| `layout_drafts` | server-persisted `HallState`, keyed by `(hall_id, employee_id)`, so a refresh doesn't lose an hour of work |
| `hall_underlays` | imported floorplan raster/PDF: `storage_path`, `scale_mm_per_px`, `offset_x/y`, `rotation`, `opacity` |
| `mhe_units` | *individual* trucks (the current `mhe_types` is only the model): `unit_code`, `mhe_type_id`, `status`, `battery_pct`, `assigned_employee_id`, `home_charge_feature_id` |
| `asset_positions` | current position, one row per asset — upsert target, not an append log |
| `asset_position_history` | partitioned/downsampled trail for analytics |
| `route_plans` | computed route for a task: `task_id`, `layout_version`, `edge_ids int[]`, `est_duration_ms`, `computed_at`, `superseded_by` |
| `layout_blockages` | temporary obstruction: geometry or `edge_ids[]`, `reason`, `reported_by`, `expires_at` |
| `edge_traversals` | fact table: `asset_id`, `edge_id`, `entered_at`, `exited_at`, `duration_ms` |
| `edge_traffic_stats` | rollup: `edge_id`, `bucket_start`, `traversals`, `p50/p95_duration_ms`, `mean_occupancy` |

### 3.2 Changes to existing tables

- **`locations.location_code` is globally unique** (`locations_location_code_key` on
  the bare column). Two tenants can never both use `A01-01-1`. Change to
  `unique(warehouse_id, location_code)`. This is a real multi-tenancy defect, not a
  layout concern, but it will bite hard once a second customer onboards.
- **`locations`**: add `elevation_mm` (bottom-of-beam height for the level — the
  `level` integer alone doesn't tell you the lift height), `hall_id` should become
  `not null`, and add a soft-delete `is_archived` since `stock_movements` references
  locations historically.
- **`locations` type booleans → enum.** `is_racking`/`is_shelf`/`is_floor_storage` are
  three booleans representing one mutually-exclusive choice, and nothing in the DB
  enforces that. A `location_type` varchar + check constraint (or an enum) removes a
  whole class of impossible state; `locationTypeKeyFor()` in `types.ts` already
  reduces them to exactly this.
- **`booking_tasks.dock_door_location_id`**: dock doors should be
  `layout_features(kind = DOCK_DOOR)`. Migration path: add
  `dock_door_feature_id`, backfill by creating features from the existing dock
  `locations`, dual-write, then drop the old column. Do not leave docks in
  `locations` — putaway strategies will eventually enumerate them as storage.
- **`zone_types`**: add the operational knobs from §1.4. Also note the FK is
  `onDelete("restrict")` from locations — correct, keep it, but the designer must
  surface *why* a zone can't be deleted rather than throwing a DB error.
- **`halls`**: add `origin_x_mm`, `origin_y_mm`, `rotation_degrees` — the hall's
  transform into a warehouse-wide site frame (§5.2).
- **`mhe_types`**: §2.3.

### 3.3 JSONB discipline

`attrs` should be typed, not free-form. One Zod schema per `feature_kind`, exported
as a discriminated union so the property panel is generated from it:

```ts
const dockDoorAttrs = z.object({
  doorNumber: z.string(),
  direction: z.enum(["INBOUND", "OUTBOUND", "BOTH"]),
  clearHeightMm: z.number().int().positive(),
  levelerType: z.enum(["NONE", "HYDRAULIC", "MECHANICAL", "AIR"]),
  trailerTypes: z.array(z.string()).default([]),
  isRefrigerated: z.boolean().default(false),
});

export type FeatureAttrs = z.infer<typeof featureAttrsSchema>; // discriminated on kind
```

Rules: anything **queried, filtered, joined, or spatially indexed** gets a real
column. Everything else lives in `attrs`. Validate on write in the server action —
Postgres will not do it for you. Add a `attrs_version` int per feature so schema
evolution can migrate lazily.

### 3.4 Versioning and RLS

Every layout table carries `organization_id` and `warehouse_id` and a Supabase RLS
policy mirroring the existing tenancy rules — the live map will be read directly
from the client over Realtime, so RLS is the only thing standing between tenants.

`layout_version` is monotonic per warehouse. `nav_nodes`/`nav_edges` rows are stamped
with it and old versions retained (archived) so historical `route_plans` and
`edge_traversals` still resolve. `graph_epoch` bumps on *any* change that invalidates
cached routes, including a blockage being added — routes reference
`(layout_version, graph_epoch)` and are recomputed when either moves.

---

## 4. Live Overlay & Event Stream Architecture

### 4.1 Position sourcing — start with what you already have

Most warehouses have no RTLS. Do not architect as if they do. Model a spectrum:

```
position_source: SCAN | TASK_INFERRED | MHE_TELEMETRY | RTLS_UWB | WIFI_RSSI | BLE | MANUAL
position_confidence: 0..1
```

The practical baseline is **scan-derived + route-interpolated**: the last barcode
scan pins the worker to a known location with confidence 1.0; between scans, animate
them along their assigned `route_plan` at the vehicle's nominal speed with decaying
confidence. Render high-confidence assets solid and interpolated ones with a fading
halo. This gives a live map that looks and behaves correctly on day one, on
infrastructure the customer already has, and degrades gracefully into real RTLS
later by swapping the source.

### 4.2 Transport: don't write telemetry to Postgres at 1 Hz

Three Supabase Realtime channels per warehouse:

| Channel | Mechanism | Contents |
| --- | --- | --- |
| `wh:{id}:presence` | **Presence** | live asset positions — ephemeral, zero DB writes, auto-cleanup on disconnect |
| `wh:{id}:events` | **Broadcast** | task state changes, blockages, alerts, route assignments |
| `wh:{id}:layout` | **Postgres Changes** | `layout_versions` rows only — a publish event tells every open map to refetch |

Presence is exactly the right primitive for "where is everyone right now": it is
last-write-wins per key, it expires on disconnect, and it never touches disk. Writing
200 workers × 1 Hz into a table is 17 M rows/day of data whose value expires in
seconds.

Persist deliberately and separately:
- `asset_positions` — upsert on **state change or every N seconds** (N ≈ 15), not
  every tick. This is the "what did the map look like when the page loaded" snapshot.
- `asset_position_history` — partitioned by day, downsampled, retention-capped
  (§5.8). Feeds heatmaps and travel analytics, not the live view.

### 4.3 Message envelope

```ts
type MapEvent = {
  seq: number;            // server-assigned, monotonic per warehouse
  ts: number;             // server clock — never trust device clocks
  warehouseId: number;
  kind: "POSITION" | "TASK" | "ROUTE" | "BLOCKAGE" | "ALERT" | "LAYOUT";
  payload: unknown;
};
```

**Snapshot + delta with gap detection.** On mount, a server action returns
`{ snapshot, seq }`; the client applies deltas from `seq + 1`. If an incoming `seq`
skips, refetch the snapshot rather than trying to reconcile. Coalesce position
updates server-side into one batched message at 4–10 Hz — never one message per
asset per tick, or 200 forklifts will produce 200 WebSocket frames per second and
the browser will drop them.

Device clocks in a warehouse are routinely minutes off. All ordering uses the
server-assigned `seq`; `ts` is for display only.

### 4.4 Rendering layers in Pixi

The current canvas rebuilds `Graphics` per location. That is fine for a design
session; it will not survive a live map. Split into containers with different update
cadences:

| Layer | Rebuild trigger | Technique |
| --- | --- | --- |
| Underlay | layout change | sprite, `cacheAsTexture` |
| Static structure (walls, columns, features) | layout change | one baked `RenderTexture` per hall per floor |
| Storage locations | layout change or level switch | batched `Graphics`, viewport-culled |
| Zone/heatmap overlay | analytics tick (seconds) | single mesh with a colour ramp |
| Routes | route assignment | polyline `Graphics`, one per active route |
| Assets (workers/MHE) | 60 fps ticker | sprite pool, position lerped locally |
| HUD (labels, selection, tooltips) | interaction | screen-space container |

Key decoupling: **event rate ≠ frame rate**. Events land in a state buffer; the Pixi
ticker interpolates each asset from its last known position toward its target along
the route polyline. This is what makes 2 Hz telemetry look like smooth motion.

Level-of-detail by zoom (there is already a `LABEL_ZOOM_THRESHOLD` precedent): below
~0.3 scale, draw a rack *run* as a single quad instead of 40 bays, drop labels, and
render assets as fixed-size dots. A 100k-location DC is otherwise unrenderable.

### 4.5 Dynamic re-routing

```
blockage reported (spill, dropped pallet, maintenance, congestion threshold)
  → layout_blockages row + broadcast
  → graph_epoch++
  → mark affected edge_ids (spatial intersect or explicit list)
  → find route_plans whose edge_ids ∩ affected ≠ ∅ and task not completed
  → recompute those routes only
  → broadcast ROUTE events to the affected handhelds
```

Congestion feeds back as **dynamic impedance**: `effective_impedance = base ×
f(current_occupancy / capacity)`, where occupancy comes from live presence data
map-matched to edges. Two guardrails:

- **Damp it.** Naive congestion routing oscillates — everyone reroutes to the empty
  aisle, which becomes the congested aisle. Use an EWMA over ~60 s and a hysteresis
  band, and only reroute when the new route is better by a margin (>15%).
- **Don't reroute mid-aisle.** A worker halfway down an aisle physically cannot take
  the new path. Recompute from their *next* node, not their current position.

For AGVs/AMRs, do **not** build reservation-based multi-agent pathfinding (WHCA*,
CBS). That is a research-grade problem and the fleet vendor already solved it —
integrate over VDA 5050 and treat the fleet manager as authoritative for AGV
motion, publishing its positions into the same presence channel.

### 4.6 Spatial analytics

| Metric | Derivation |
| --- | --- |
| Traffic density heatmap | bin `asset_position_history` into 500 mm cells per time bucket; render as a mesh colour ramp |
| Edge congestion | `edge_traffic_stats.p95_duration_ms / free_flow_duration_ms` |
| Bottleneck detection | edges where p95/p50 ratio > threshold *and* traversal count is high — high variance is the signal, not high count |
| Travel time estimation | per-edge EWMA of observed speed, fed back into the cost model — the graph learns the building |
| Pick face utilization | traversals of `location_access_points` joined to `stock_movements` |
| Congestion-adjusted labour standards | observed vs. computed route time per task; systematic gaps mean the layout model is wrong |
| Dwell/idle | assets stationary > threshold, clustered by feature — surfaces informal staging that isn't on the map |

Map-matching (position stream → edge traversals) is the input to most of this: snap
each position to the nearest edge within a tolerance, emit a traversal when the
matched edge changes. Do it in a background worker off the live path.

---

## 5. Architectural Edge Cases & Pitfalls

### 5.1 Multi-level: three different "levels" that will get confused

`locations` already has both `level` (rack tier) and `floor_level` (building floor).
Anyone reading this schema in six months will conflate them, and a bug where a
mezzanine pick is routed as a level-3 beam is very hard to see. Rename to
`rack_level` and `floor_level`, and add a third concept — `elevation_mm`, the actual
height — because that is what clearance checks and lift times need. Vertical
transitions between floors are graph edges through `PORTAL` nodes with real cycle
times and capacity 1; a goods lift is often the true bottleneck of a mezzanine
operation and a graph that treats floors as free will mis-plan every route.

### 5.2 Coordinate frames

Locations are hall-local mm today. That is correct and should stay — but add a hall
transform (`origin_x_mm`, `origin_y_mm`, `rotation_degrees`) into a warehouse site
frame. You need it for cross-hall routing, the yard, and any site overview. Compute
site coordinates as a derived value; never store both as sources of truth, or they
will drift.

Keep **everything integer millimetres**. The current code already does this, and it
is the right call — float world coordinates accumulate drift under repeated
drag/rotate and produce 0.0001 mm gaps that break adjacency snapping. Round at every
mutation boundary, including rotation math.

### 5.3 Rotated geometry and indexing

`rotation_degrees` means the stored `width`/`length` is *not* the AABB. Any spatial
index built on `physical_x, physical_y, width, length` is wrong for rotated
locations — and there is already an `idx_locations_canvas_render` doing exactly
that. Store generated `envelope_min/max_*` columns computed from the rotated corners
and index those; use the envelope as a broad-phase filter and exact OBB/polygon
intersection as narrow phase.

### 5.4 Dynamic staging areas

A staging area is not 40 permanent bins and it is not nothing. Model it as a
`STAGING_AREA` feature with a `slot_grid` descriptor, and materialize **transient
location rows** with `storage_permanence = 'FLUID_BUFFER'` (the enum already exists
in `zone_types`) that are created on demand and reaped when empty. That keeps
inventory referential integrity intact — a pallet is always *somewhere* with a real
`location_id` — without polluting slotting or cycle-count logic with thousands of
usually-empty bins. Filter them out of putaway candidacy by permanence, not by
naming convention.

### 5.5 Deleting things that history references

`stock_movements`, `tasks`, and `route_plans` reference locations, features and edges
that a supervisor will happily try to delete. Soft-delete everything referenced by
operational history (`is_archived` + `valid_to`), hard-delete only draft-created rows
that were never published. The designer must distinguish "remove from the map" from
"this never existed."

### 5.6 Getting a real building into the tool

Nobody will hand-draw a 20,000 m² DC. The unlock is `hall_underlays`: import a PDF
or DWG export as a raster, set scale by drawing a line over a known dimension
(a two-click calibration), then trace. Add snapping (to grid, to feature edges, to
alignment guides) and the aisle-inference in §2.4. Budget real time for this — it is
the difference between a demo and a tool.

### 5.7 Concurrent editing

The draft (`HallState`) is client-only today. A refresh is already survivable — it is
mirrored into `localStorage` and rehydrated on mount, with a `beforeunload` guard for
a closed tab — but it is per-browser: the draft is invisible from another machine, and
two supervisors editing the same hall is silent last-write-wins. Persist drafts
server-side (`layout_drafts`), and on publish use optimistic concurrency — the save
carries the `layout_version` it was based on, and the server rejects a stale base with
a diff the user can review. Full CRDT/OT is not warranted; layout editing is a
low-concurrency, high-stakes operation where an explicit conflict beats a clever merge.

Note that the localStorage draft is versioned (`DRAFT_STORAGE_VERSION`). Any change to
the `HallState` shape must bump it, or a stale draft rehydrates into a reducer that
expects fields it does not have.

### 5.8 Worker tracking is legally loaded

Individual-level location tracking of employees is regulated (GDPR Art. 6/88 in the
EU; in Germany a works council agreement is typically mandatory before deployment).
Design for it rather than retrofitting:

- Separate **individual** visibility from **aggregate** visibility, gated by role —
  most supervisors need heatmaps, not names.
- Short retention on identified position history (days), long retention on
  anonymized/aggregated rollups.
- A per-warehouse config switch for identified tracking, off by default.
- Log access to individual traces in the existing audit log.

Building this in from the start costs little. Retrofitting it after a works council
blocks the rollout costs the deployment.

### 5.9 Other traps worth naming

- **Shortest ≠ fastest ≠ safest.** The optimal route may cross a pedestrian walkway
  or a blind corner. Encode safety as impedance and let the cost model arbitrate.
- **Racking that isn't a rectangle.** Drive-in, push-back, flow racks and cantilever
  have access rules (LIFO/FIFO, single access face) that the current
  racking/shelf/floor triple can't express. Reserve room in `location_type`.
- **Clear height varies within a hall.** `halls.clear_height_mm` is a single number;
  real buildings have sloped roofs, sprinkler drops and mezzanine undersides. Height
  restriction belongs on features/edges, not only on the hall.
- **The graph will drift from reality.** Someone will park a pallet in a cross-aisle
  permanently. Compare planned vs. observed travel times per edge (§4.6) and surface
  edges where reality consistently disagrees with the model — that is a maintenance
  signal for the digital twin itself.
- **Publish is a production event.** Republishing a layout mid-shift invalidates
  in-flight routes. Gate publish behind a confirmation that names how many active
  tasks will be recomputed.

---

## Build order

1. **Foundations** — ✅ **done** (migrations `0001_layout_features`,
   `0002_drop_location_type_booleans`). `layout_features` + `feature_kinds` +
   `zone_areas` exist; 48 feature kinds are seeded across five categories;
   structural, logistics, workstation, facility and hazard kinds draw, select,
   move, resize and save in the canvas. `locations.location_code` is now unique per
   warehouse, and the location-type boolean triple became a single `location_type`
   column with a check constraint.

   Deferred out of this stage on purpose: `zone_areas` has its table but no drawing
   UI (zones are still assigned per location); `NAVIGATION` feature kinds are not
   seeded, because a travel lane that compiles into nothing is worse than no travel
   lane at all — they arrive with the graph in stage 3; `impedance_multiplier` and
   `attrs_version` exist as columns with defaults but are not yet surfaced.
2. **Layout lifecycle** — ✅ **done** (migration `0003_layout_lifecycle`).
   `layout_versions` gives every publish a monotonic number, an author, and a
   `graph_epoch`; publishing carries the version it was based on and is rejected
   with a reviewable message if someone else published in between (the unique key
   on `(warehouse_id, version_number)` is what makes the race safe, not the read).
   Drafts autosave to `layout_drafts` on a 1.5 s debounce and are recovered
   server-first, with a notice when a recovered draft predates the current
   published version. `hall_underlays` + a **private** `layout-underlays` bucket
   support tracing a real floorplan: upload, opacity/offset/rotation, and a
   two-click measure that rescales relative to a stated real-world distance.

   Deferred: underlays are one per hall floor and are not themselves versioned;
   `layout_versions.status` accepts DRAFT/ARCHIVED but only PUBLISHED rows are
   written so far; there is no rollback-to-version UI (the history is recorded,
   which is the prerequisite).
3. **Graph** — ✅ **done** (migration `0004_nav_graph`). `nav_nodes`, `nav_edges`,
   `nav_turn_restrictions` (since dropped, see §2.6) and `location_access_points`
   exist; `mhe_types` is now a
   capability profile with a `class_bit` feeding the per-edge vehicle bitmask;
   10 `NAVIGATION` feature kinds are seeded. `graph-compiler.ts` is pure and
   testable — it infers rack runs from geometry, lays corridors between facing
   runs plus perimeter aisles, invents cross-aisles between corridor ends that can
   see each other, splits at intersections, attaches portals and pick faces, and
   reports connectivity and aisle-width problems. A toolbar action compiles and
   stores it; the canvas draws it as a toggleable overlay coloured by edge kind.

   Three findings worth keeping: **rack runs must be derived from geometry, not the
   `aisle` column** — the moment someone drags half an aisle elsewhere, the aisle
   number stops describing a contiguous run, which the live data already does. An
   attachment placed *on* an edge without splitting it is geometrically right
   and topologically isolated; it looks connected and is unreachable. And
   **`MERGE_RADIUS_MM` must exceed twice `SNAP_MM`** — `applyCuts` drops a cut
   landing within `SNAP_MM` of a segment end, so two lanes crossing near an
   endpoint can finish up to `2 × SNAP_MM` apart with no node joining them. Real
   authored geometry hit this: two roads crossing 247 mm from one road's end left
   a dock door in its own component.

   Deferred: no A* yet (stage 4), turn restrictions were a table with no
   derivation (dropped in `0019` -- see §2.6),
   vertical PORTAL edges between floors are modelled but not compiled, and
   `impedance`/`fixed_delay_ms` carry defaults only.
4. **Routing** — ✅ **done** (migration `0005_route_plans`). `routing.ts` builds a
   flat CSR graph and runs A* whose state is a **directed arc**, so turn penalties
   are expressible at all; the heuristic divides by the network's fastest speed to
   stay admissible; ties break on `(f, -g, arcId)` so the same request always
   returns the same path. Vehicle class, vertical clearance, weight and width all
   filter arcs. `costsFrom` is an arc-based Dijkstra over the identical cost
   function, which is both the distance-matrix source and the oracle the tests
   check A* against. `sequencePickPath` does nearest-neighbour + time-budgeted
   2-opt. `route_plans` stores the edge list, so a blockage on an edge can find
   every route crossing it.

   On the real hall: 0.028 ms per route, 12 arcs expanded of 100, optimal on every
   pair, and a 12-stop pick sequenced 36% faster than the order it was handed.

   Deferred: no handheld app exists in this codebase, so routes render in the
   designer only. Turn cost is angle-derived only (the exceptions table was
   later dropped -- see §2.6), and
   congestion-driven dynamic impedance is stage 6.

   **`mhe_types.class_bit` is capped at 30, not 52.** The mask is manipulated with
   JS bitwise operators, which coerce to signed 32-bit — a bit above 30 would
   silently alias another vehicle class rather than fail.
5. **Live map** — ✅ **done** (migration `0006_live_map`). `asset_positions`
   (upserted snapshot, one row per asset), `asset_position_history` (downsampled
   trail, written only when an asset has actually moved) and `layout_blockages`.
   `live-map.ts` is pure: exponential confidence decay, interpolation along the
   assigned route anchored at wherever the fix actually was, map-matching,
   congestion with a **capped** impedance response, and sequence-gap detection.
   `use-live-map.ts` subscribes to Realtime presence for positions and broadcast
   for events. The Pixi asset layer redraws on the **ticker**, not on React state
   — that decoupling is what makes 2 Hz telemetry look like motion instead of
   teleporting.

   Blockages resolve onto an edge list at report time, so invalidation is one
   array-overlap predicate rather than a spatial query per stored route. Raising
   or clearing one bumps `graph_epoch`; the epoch stamp *is* the staleness marker,
   so no second "stale" flag is written that could disagree with it. The returned
   route list is about urgency — those are the plans with someone walking into
   the obstruction right now.

   Verified against live Supabase Realtime: presence tracks and syncs, broadcast
   delivers between two clients in order, and a genuinely dropped message trips
   the resync path.

   Lives in its own `live-map` module, not in the designer — see the module
   boundary at the top. Viewing is gated on `can_view_metrics` and blockage
   reporting on `can_assign_tasks`, deliberately *not* on layout-edit rights: a
   shift supervisor who should see where everyone is has no business being able
   to move racking, and that gate is also the privacy boundary from §5.8.

   Deferred: nothing publishes positions yet — no scanner or telemetry feed
   exists to wire in, so the asset layer renders whatever the channel carries and
   the snapshot table is populated by `reportAssetPosition` when something starts
   calling it. Congestion feedback into routing impedance is computed but not yet
   fed back into the router (stage 6), and there is no retention job on
   `asset_position_history` — see §5.8, that is regulated data.
6. **Analytics** — ✅ **done** (migrations `0007_traffic_analytics`,
   `0008_edge_congestion_state`). `traffic.ts` is pure: it map-matches a position
   stream into `edge_traversals` (grouped per asset, split wherever the matched
   edge changes or a sample leaves the graph), rolls them into `edge_traffic_stats`
   on epoch-aligned buckets so re-running over an overlapping window upserts the
   same rows, and detects bottlenecks by **p95/p50 duration ratio at meaningful
   volume** — variance is the signal, not raw count. Congestion feeds back into
   routing impedance through `withImpedanceOverrides`, which copies only
   `arcImpedance` and shares every other typed array, so the base graph stays a
   pure function of layout and "what it currently costs" is layered on top.

   The damping is the part that matters: an EWMA on the ratio *plus* a hysteresis
   band on the multiplier, persisted in `edge_congestion_state` so it survives
   across rollup runs. Recomputing it fresh each time would throw the hysteresis
   away and reintroduce exactly the oscillation §4.5 warns about.

   Deferred: the rollup is a manual server action — this app has no cron or queue
   runner, so nothing calls it on a schedule. `previewLiveRoute` works and is
   tested but has no picker UI on the live canvas. There is no retention job on
   `edge_traversals` / `edge_traffic_stats`, which grow unbounded the same way
   `asset_position_history` does. What-if layout scoring (§2.8) is not built.

Each stage is independently useful, which matters — stage 3 alone (a validated,
visualized navigation network) already catches unreachable pick faces and
aisle/vehicle mismatches before they reach the floor.

---

## Remaining work

The staged build-out is complete. What is left is the deferred set, which is a
different kind of work — no longer "build the next layer" but "close the gaps
the layers left". Roughly in order of what blocks real use:

| Gap | Why it matters |
| --- | --- |
| **Nothing publishes positions** | The live map and every traffic number downstream render whatever arrives on the channel. Until a scanner feed, MHE telemetry, or task events call `reportAssetPosition`, the whole live/analytics half runs on no data. This is the single biggest blocker. |
| **No scheduler** | The traffic rollup is a button. It should run on an interval. |
| **No retention** | `asset_position_history`, `edge_traversals` and `edge_traffic_stats` grow forever. The first is regulated data (§5.8) and needs a short retention cap, not just a cleanup. |
| **Zone geometry has no UI** | `zone_areas` exists since stage 1 and is still unused; zones remain per-location assignments, so "which zone is this worker in" is still unanswerable. |
| **Rollback-to-version** | `layout_versions` records the history; nothing restores from it. |
| ~~**Turn restrictions**~~ | **Closed, not deferred.** `nav_turn_restrictions` was dropped in `0019` — turn cost is angle-derived by design. The directed-arc search that makes per-turn overrides *possible* is still there if the need ever becomes real. |
| **Vertical portals** | Multi-floor `PORTAL` edges are modelled but the compiler never emits them, so `hall_floors` / mezzanines aren't routable. |
