# Pattern & Execution Trace Report
## Layout Designer + Live Map (`warehouse-map` module)

Scope: `app/warehouses/[warehouseId]/layout-designer/**`, `app/warehouses/[warehouseId]/live-map/**`, and the shared pure-logic core `lib/warehouse-map/**`. ~16.5k LOC.

---

## 0. Module map

The module is deliberately split into three layers, and the split is itself a pattern (**Functional Core / Imperative Shell**):

| Layer | Files | Contains | Depends on |
|---|---|---|---|
| **Functional core** (pure, no React, no Pixi, no DB) | `lib/warehouse-map/geometry.ts`, `graph-compiler.ts`, `routing.ts`, `live-map.ts`, `naming.ts`, `feature-kinds.ts`, `types.ts` | All algorithms and all derived-value maths | nothing |
| **Imperative shell** (server) | `layout-designer/actions.ts`, `graph-actions.ts`, `routing-actions.ts`, `lifecycle-actions.ts`, `live-map/live-actions.ts`, `lib/warehouse-map/context.ts` | Auth, Drizzle I/O, transactions, cache invalidation | core |
| **Presentation** (client) | `layout-designer.tsx`, `layout-designer-canvas.tsx`, `hall-toolbar.tsx`, `*-panel.tsx`, `live-map-view.tsx`, `live-map-canvas.tsx`, `use-live-map.ts` | Pixi rendering, draft reducer, Realtime subscription | core + server actions |

**Why:** the compiler, router and interpolator are where the subtle bugs live, and a browser (or a `"use server"` boundary) is a terrible place to find them. Both the client canvas and the server commit action import the *same* `computeEnvelope` from `geometry.ts`, which is what makes "the server recomputes what the client sent" a cheap guarantee rather than a duplicated implementation.

---

## 1. Methodology & pattern overview

### 1.1 Graph theory & search

#### A\* over a **directed-arc state space** (not a node state space)
`lib/warehouse-map/routing.ts:363` → `findRoute()`

The search frontier holds *arcs*, not nodes: `bestG`, `cameFrom` and `closed` are all `Float64Array/Int32Array/Uint8Array` of length `arcCount`, not `nodeCount`.

- **Why:** turn cost is a function of the **pair** (arrivingArc, departingArc). A node-state search has no memory of how it arrived, so it physically cannot express "a reach truck pays 2.5 s for a 90° corner". Encoding the arc as the state is the standard way to lift edge-dependent costs into a shortest-path problem.
- **Trade-off solved:** state space grows from |V| to |E| (roughly 2–4× here), in exchange for turn penalties, one-way lanes and U-turn costs being *exactly* modelled rather than approximated. In a warehouse with 3 m aisles, turning dominates travel time on short picks, so the cheaper model would give visibly wrong ETAs.

#### Admissible heuristic (straight-line time, network-max divisor)
`routing.ts:388`
```ts
h(n) = hypot(n → goal) / graph.maxSpeedMms * 1000
```
- **Why the *network's* max speed and not the traveller's:** dividing by the traveller's own speed over-estimates wherever the network is faster than the traveller, breaking admissibility and silently returning non-optimal routes. This is a classic A\* correctness trap and the code comments call it out explicitly.
- Turn penalties are non-negative, so they can only make the true cost larger — admissibility survives.

#### Compressed Sparse Row (CSR) adjacency in typed arrays
`routing.ts:58` `CompiledRoutingGraph`, built by `buildRoutingGraph()` via a **counting sort** into `arcOffset`.

- **Why:** an object graph (`{ from, to, edges: [...] }`) allocates on every expansion and thrashes cache lines. Flat `Int32Array`/`Float64Array` keep a whole hall resident in a few hundred KB with sequential access on expansion (`for (arc = arcOffset[n]; arc < arcOffset[n+1]; arc++)`).
- **Trade-off:** the graph is immutable once built and must be rebuilt on change — which is exactly why it is cached by epoch (§1.4).

#### Binary min-heap with **total-order tie-breaking** and lazy deletion
`routing.ts:271` `ArcHeap`. Ordering: lower `f`, then **higher `g`**, then lower arc id.

- Higher-`g` first is the standard "prefer the deeper node" tie-break that reduces expansions near the goal plateau.
- Lower-arc-id last is not a nicety: with symmetric racking, dozens of paths tie *exactly*. A router that returns a different-but-equal path per poll makes the picker's screen flicker and destroys trust. **Determinism is a product requirement here, implemented as a heap comparator.**
- No decrease-key: stale entries are pushed and skipped on pop (`if (top.g > bestG[arc]) continue`). Standard lazy-deletion A\*; trades a slightly larger heap for O(1) relaxation.

#### Dijkstra / uniform-cost search for the distance matrix
`routing.ts:478` `costsFrom()` — same arc state space, heuristic dropped (`f = g`).
- **Why the same state space:** if the matrix used a node-based Dijkstra and the final path used arc-based A\*, the sequencer's numbers and the rendered route's numbers would disagree. Sharing the state space guarantees they agree.

#### TSP approximation: nearest-neighbour construction + **2-opt local search** under a time budget
`routing.ts:544` `sequencePickPath()`

- Multi-stop pick ordering is the Travelling Salesman Problem (asymmetric, because of one-ways and turn costs). It is NP-hard, so it is **approximated, not solved**.
- **Construction:** greedy nearest-neighbour (with the same deterministic node-id tie-break).
- **Improvement:** 2-opt segment reversal, accepting any improvement > 1 ms.
- **Anytime property:** `budgetMs` (default 250 ms) with a `deadline`; on expiry it returns the best tour found and sets `truncated: true`, which the UI surfaces honestly ("the sequence is good, not proven optimal" — `route-panel.tsx:166`).
- **Trade-off solved:** on conventional racking this lands within a few percent of optimal. The picker is walking, not racing a clock; spending 30 s proving optimality to save 4 s of walking is a net loss. Bounded latency beats optimality.
- Cost model: `tourCost()` is recomputed per candidate, so a sweep is O(n³) — acceptable only *because* of the budget guard. Unreachable stops are appended rather than dropped, so a stop never silently vanishes from a pick list.

#### Union-Find (disjoint-set) with path compression
`graph-compiler.ts:596` `connectedComponents()`

- Used for the connectivity report: how many components, and is each access point in the largest one.
- **Why:** an unreachable pick face is a production incident waiting to happen. Detecting it at **compile time** (near-linear via union-find) is enormously cheaper than discovering it when a picker is stood in front of a wall, and cheaper than running |locations| separate BFS searches.

---

### 1.2 Computational geometry — the graph compiler

`lib/warehouse-map/graph-compiler.ts` is an 8-stage pipeline (**Pipes & Filters**). It is a *compiler* in the literal sense: authored geometry (source) → inferred topology (IR) → persisted nav graph (object code), with a **diagnostics channel** (`CompileWarning[]`) rather than a hard failure.

| Stage | Function | Technique |
|---|---|---|
| 1. Footprint collapse | `collectBayFootprints()` | Hash-by-envelope-key; N rack levels at the same (x,y) collapse to **one** footprint |
| 2. Rack run inference | `inferRackRuns()` | Band bucketing on the cross-axis (quantised by `SNAP_MM`), then a gap-based run break at `RUN_BREAK_MM` |
| 3. Corridor inference | `inferCorridors()` | Interval overlap + occlusion test; inner aisles from facing pairs, perimeter aisles per *face* |
| 4. Planar splitting | `splitAtIntersections()` → `applyCuts()` | Pairwise segment–segment proper intersection, parameterised cut ordering |
| 5. Node dedup | `findNearbyNode()` / `ensureNode()` | **Uniform spatial hash grid**, 3×3 neighbourhood scan |
| 6. Portal attach | `projectOntoNetwork()` | Point-to-segment projection, then re-split |
| 7. Access points | inline | Face + approach heading from the projection vector |
| 8. Validation | union-find + width check | Diagnostics |

**Key design decisions and why:**

- **Runs are derived from geometry, not from the `aisle` column** (`graph-compiler.ts:253`). Once a supervisor drags half an aisle elsewhere, the aisle number stops describing a contiguous physical run. Real edited layouts do exactly that, so trusting the label would produce a graph that matches the spreadsheet and not the building.

- **`MERGE_RADIUS_MM = SNAP_MM * 2 + 50`** — and that relationship is *load-bearing*, documented at `graph-compiler.ts:39`. `applyCuts` discards a cut within `SNAP_MM` of a segment end (to avoid zero-length stubs). When two segments cross near an endpoint the cut is dropped on both, and each endpoint can sit up to `SNAP_MM` from the true intersection — so they can end up `2 × SNAP_MM` apart. A narrower merge radius would leave two lanes that *look* joined on the canvas and are *disconnected* in the graph. This is the single most instructive invariant in the module.

- **Spatial hash grid instead of pure cell snapping** (`graph-compiler.ts:883`). Cell snapping has a boundary artifact: two points 200 mm apart can round into different cells and become two nodes — which is precisely how a pick face becomes an isolated island next to the aisle it sits on. Cell size = merge radius means a 3×3 scan is *guaranteed* to find any node within that radius. O(1) expected lookup vs O(n) linear scan.

- **Splitting is what makes attachment topological, not just visual** (`applyCuts`, `graph-compiler.ts:476`). A node placed *on* an edge without splitting it is geometrically correct and topologically isolated. Portals and pick faces are projected first, then the host segments are re-cut, then nodes are materialised — order matters.

- **3-D obstacle filtering** (`obstacleRects`, `graph-compiler.ts:558`): `if (feature.elevationMm >= travellerHeightMm) continue`. A conveyor at 2400 mm is not an obstacle to someone walking underneath it. Storing elevation is pointless unless the compiler uses it.

- **Handling time is not travel distance** (`HANDLING_BASE_MS = 15 s`, `HANDLING_PER_LEVEL_MS = 8 s`). Rack level 4 is at the same (x, y) as level 1; only lift time differs. Encoding level as extra graph length would corrupt every distance in the system. This is why `location_access_points.handling_time_ms` exists as a column (`drizzle/schema.ts:1742`) and is summed *separately* from `route.durationMs` in the preview.

- **Bitmask vehicle classes** — `allowedVehicleMask` is a `bigint` column, tested with `(mask & (1 << classBit)) === 0`. Set membership as a single integer compare inside the hot loop, instead of a join or an array scan per arc expansion.

---

### 1.3 Concurrency & state management

#### Optimistic Concurrency Control (OCC), enforced by a unique constraint
`actions.ts:183` `commitHallStates()` + `unique("uq_layout_versions_wh_number")` at `drizzle/schema.ts:2104`

Three-layer defence:
1. **Read-check inside the transaction** — read `MAX(version_number)`, compare to the client's `baseVersionNumber`, throw a tagged `LayoutVersionConflictError` (`context.ts:202`) if they differ.
2. **The unique key is the actual enforcement** — if two supervisors both read version N and both try to insert N+1, the loser's `INSERT` violates the constraint and its *entire* transaction rolls back.
3. **`23505` catch** (`actions.ts:660`) — the same conflict, lost at commit time instead of read time, mapped to the same reviewable UI state.

- **Why not last-write-wins:** the unit of work is a *whole warehouse layout*. LWW would silently discard another supervisor's afternoon of work.
- **Why not pessimistic locking:** a design session lasts an hour. Holding a row lock for an hour is not a system, it is an outage.
- **Crucially, the losing draft is kept** (`layout-designer.tsx:791`): "discarding the user's work to resolve it would be the worst possible outcome." The conflict banner offers *reload and re-apply*, not *discard*.

#### Command pattern + Memento undo stack ("draft engine")
`layout-designer.tsx:146` `draftReducer`, state shape `Record<hallId, { past[], present, future[] }>`

- Every editing gesture — drag, resize, field edit, create, delete — dispatches a typed action and produces a **new immutable `HallState` snapshot** pushed onto `past`. Undo/redo is a pointer move between the three lists.
- **Unit of Work:** nothing touches the database until "Save Map". `commitHallStates` is the *only* place client-staged hall/location/feature drafts become mutations.
- **Read model projection:** `applyHallStateToLocations` / `...ToFeatures` (`types.ts:344+`) fold the staged patches over the server base so the canvas, toolbar and side panels all read one derived view and can never disagree about what the user is looking at.
- **Negative temp ids** (`nextTempId()`, `layout-designer.tsx:411`) let pending-create rows share the numeric id space with real rows, so every consumer treats them identically.
- **Trade-off solved:** snapshot-per-step is memory-heavier than a diff/inverse-command log, but `HallState` is already a compact patch bag, and snapshotting makes undo trivially correct — no inverse operation to get wrong.

#### Schema-versioned dual persistence with an explicit authority rule
`DRAFT_STATE_VERSION = 2` (`types.ts:291`), checked by **both** `localStorage` (`layout-designer.tsx:431`) and `layout_drafts.state_version` (`page.tsx:490`).

- Server drafts **win** over localStorage; localStorage is consulted only for halls the server has no draft for. Rationale (`layout-designer.tsx:417`): server drafts follow the user between machines and carry the layout version the edits were authored against — something localStorage cannot know.
- A draft written against an older `HallState` shape is **dropped, not migrated** — an un-migratable shape rehydrated into the reducer is worse than a lost draft.
- **Staleness surfacing:** `isStale = baseVersionNumber !== currentVersionNumber` (`page.tsx:497`) drives a review banner rather than a silent merge.

#### Write-behind (debounced) autosave with dirty-set tracking
`layout-designer.tsx:490`, `DRAFT_AUTOSAVE_DEBOUNCE_MS = 1500`, target `saveHallDraft()` (`lifecycle-actions.ts:35`)

- Only halls whose `present` object **identity** changed since last flush are sent (`lastSavedRef`), so switching halls or nudging one box never rewrites every draft row.
- The action is idempotent (`onConflictDoUpdate` on `(hall_id, employee_id)`), which is what makes a debounced retry safe.
- **An emptied draft is a discard, not a save** (`lifecycle-actions.ts:57`) — otherwise "undo everything" leaves a zero-change row that still reads as unsaved work.
- Two `useRef` mount guards (`isFirstPersistRef`, `autosaveSkipRef`) prevent the pre-hydration render from overwriting the draft that is about to be recovered — a real ordering hazard in effect-based persistence.

---

### 1.4 Caching & invalidation

#### Epoch-stamped invalidation: `(layout_version, graph_epoch)`
- `layout_version` moves on **publish** (`layoutVersions.versionNumber`).
- `graph_epoch` moves on **anything that invalidates routes without a publish** — a blockage raised or cleared (`bumpGraphEpoch`, `live-actions.ts:190`).
- Every `route_plans` row carries the pair it was planned against (`drizzle/schema.ts:1822`, indexed as `idx_route_plans_stamp`). **Any mismatch means recompute.**
- **Why two counters:** conflating them would force a fake republish every time someone reports a spill, polluting version history with non-design events.
- **Deliberate non-pattern:** `findRoutesCrossing()` (`live-actions.ts:226`) does *not* write a "stale" flag. The epoch stamp already invalidates everything; a second marker would be a redundant source of truth that could disagree with the stamp. The returned list is used purely for **urgency** — "these people are walking into the obstruction right now, recompute them eagerly rather than lazily."

#### Memoised compiled graph, keyed on the epoch pair
`routing-actions.ts:50` — a module-level `Map<hallId, { key: "version:epoch", graph }>`.

- **Why:** a pick-path sequence runs one Dijkstra **per stop**; rebuilding CSR each time would dominate.
- **Honest limitation:** this is per-process memory. On a multi-instance or serverless deploy each instance keeps its own copy — correct (the key makes a stale entry impossible to serve) but not shared, and it grows unbounded across halls with no eviction.

#### Denormalised `edge_ids` array for O(1)-ish invalidation
`route_plans.edgeIds` is `integer[]`; blockage invalidation is a single Postgres **array-overlap** predicate:
```sql
route_plans.edge_ids && ARRAY[...blockedEdgeIds]
```
(`live-actions.ts:241`). The edge list lives on the plan *precisely* so this stays one predicate instead of a spatial query joined against every stored route.

#### Path-based cache revalidation
`revalidateLayout()` / `revalidateLiveMap()` (`context.ts:100`) wrap `revalidatePath`. Every mutating action ends with one; the server component re-runs and streams fresh props down. Combined with `router.refresh()` from panels, this is the return path for all non-Realtime data.

---

### 1.5 Real-time & state estimation (Live Map)

The governing insight (`live-map.ts:8`): **most warehouses have no RTLS, so do not architect as though they do.** A barcode scan pins someone exactly; between scans, animate along the assigned route and let confidence decay. This works on infrastructure the customer already owns and upgrades to real RTLS by swapping the source.

#### Dead reckoning / local state interpolation
`live-map.ts:161` `renderAssetAt(asset, nowMs)`

1. Find where on the route the *fix* actually was — `nearestPointOnPolyline()` — rather than assuming the fix was at the route's start.
2. Advance `distanceAlong + speedMms * ageMs / 1000`.
3. `pointAlongPolyline()` clamps to route length: **arriving early and waiting is a much smaller lie than sailing through the far wall.**
4. Mark the result `isInterpolated: true` so the UI can distinguish guess from fix.

#### Exponential confidence decay with source-dependent half-life
`live-map.ts:94` `confidenceAt()` — `0.5 ^ (age / halfLife)`, `CONFIDENCE_HALF_LIFE_MS = 45 s`, ×4 for `RTLS_UWB` / `MHE_TELEMETRY`.

- **Why exponential, not a cliff:** a supervisor should see certainty *fade*, not flip. A 5-second-old scan and a 5-minute-old scan are both "the last thing we know", but only one deserves trust.
- **Why source-dependent:** silence from a continuous telemetry source means "not moving"; silence from a scanner means "we lost them". Those are not the same evidence.
- Rendered as a **growing halo** (`live-map-canvas.tsx:333`) — certainty is drawn, not hidden.
- `ASSET_EXPIRY_MS = 10 min` → stop drawing entirely, so the map doesn't accumulate ghosts across a shift.

#### Map matching + damped congestion feedback
- `matchToEdge()` (`live-map.ts:265`): nearest edge within `MAP_MATCH_TOLERANCE_MM = 3 m`. Without it a position is a dot; with it, it becomes a traversal that can be counted and timed.
- `computeCongestion()` skips assets below `CONFIDENCE_STALE` — a stale guess is not a body in an aisle.
- `congestionImpedance()` (`live-map.ts:333`) is **capped at 3× and only engages above 0.75 occupancy**. Explicitly damped, because naive congestion routing **oscillates**: everyone reroutes onto the empty aisle, which promptly becomes the congested one. Uncapped penalties make a busy aisle look impassable and send everyone the long way round — usually worse than queueing for three seconds.

#### Sequenced event stream with gap detection → **full resync**
`live-map.ts:370` `advanceStream()`

- Ordering uses a **server-assigned monotonic `seq`, never a timestamp**: device clocks in a warehouse are routinely minutes out.
- Replays / out-of-order (`seq <= lastSeq`) are ignored, never applied backwards.
- A gap (`seq !== lastSeq + 1`) sets `needsResync`, and the client refetches the whole snapshot rather than attempting reconciliation — **"a live map that is subtly wrong is worse than one that blinks."**
- This is the classic snapshot + delta-log pattern with a reset-on-divergence recovery policy.

#### Conflation (event coalescing) + fixed-interval flush
- `coalescePositions()` (`live-map.ts:389`) keeps only the latest event per `assetKind:assetRefId`. 200 forklifts at 5 Hz is 1,000 msg/s; the browser simply drops them.
- `use-live-map.ts:180` buffers into a ref and flushes on a **150 ms interval** (~6–7 renders/s): a burst of 200 updates causes **one** React render, not 200.

#### Transport selection per data characteristic
`use-live-map.ts:15` documents three channels chosen on data shape, not convenience:

| Data | Transport | Why |
|---|---|---|
| Positions | Supabase **Presence** | Last-write-wins per key, expires on disconnect, never touches disk — exactly right for "where is everyone *now*". 200 workers at 1 Hz would be **17M rows/day** whose value expires in seconds. |
| Blockages, routes, alerts | **Broadcast**, sequenced | Needs gap detection and durability semantics. |
| Layout republish | **postgres_changes** on `layout_versions` | Small, rare, and tells every open map to refetch. |

#### Render loop decoupled from React
`live-map-canvas.tsx:297` — asset drawing runs on the **Pixi ticker**, reading from refs. Every frame asks "where should this asset be *now*", instead of waiting for the next message to move it. React state changes only redraw the *static* layer (`useEffect` at `:393`). This is what makes 60 fps motion out of a 150 ms message cadence.

---

### 1.6 Security, validation & authorisation

- **Capability-based RBAC with deliberately split gates.** `requireLayoutContext` demands `can_modify_locations`; `requireLiveMapContext` demands `can_view_metrics` to view and `can_assign_tasks` to report a blockage (`context.ts:126`). A shift supervisor who should see where everyone is has no business moving racking. The live-map gate is also flagged as the **privacy boundary** — individual worker location is regulated in the EU, so it sits behind an explicit permission rather than any login.
- **Multi-tenant scoping on every predicate.** Every query carries `warehouseId` / `organizationId`, plus explicit ownership checks (`hallBelongsToWarehouse`) before any write that references a foreign id.
- **Never trust client-derived values.** `buildFeatureInsert` (`actions.ts:108`) re-derives the envelope server-side, because the envelope is what spatial queries index and a wrong one silently breaks containment tests. Rotation is re-normalised, all mm values re-rounded.
- **Schema validation for `jsonb`.** `validateAttrs()` (`feature-kinds.ts:432`) is the *only* gate — "Postgres will not enforce any of this for a jsonb column." Unknown keys are **dropped, not rejected**, so an older client sending a removed attribute doesn't fail the whole save (tolerant reader / Postel's law).
- **Partial-patch merge before recompute** (`actions.ts:474`): a `FeaturePatch` is partial, but the envelope depends on every geometry field at once, so the current row is read back inside the transaction and merged before recomputing.
- **`kind` is intentionally absent from `FeaturePatch`** (`types.ts:229`) — kind determines the attribute schema, so changing it would strand attrs belonging to a different shape. Changing kind is delete + create.
- **Private storage bucket + short-lived signed URLs.** Underlays store an *object path*, never a public URL; reads go through a 4-hour signed URL minted server-side (`context.ts:39`, `page.tsx:507`). A floorplan is commercially sensitive. The service-role client is storage-only, and `context.ts:23` is explicit that authorisation happens in application code — RLS is neither relied upon nor quietly bypassed.
- **Idempotent bulk insert.** `bulkGenerateLocations` caps at 2,000 rows, pre-checks intra-batch code collisions, then uses `onConflictDoNothing` on `(warehouse_id, location_code)` so re-running a generator over the same range **skips** rather than failing the whole batch.

---

## 2. Trace-by-trace data flow

### TRACE A — Drag a rack, then "Save Map" (the draft engine + OCC publish)

**A1. Client trigger**
`layout-designer-canvas.tsx` — Pixi `FederatedPointerEvent`. Pointer-move mutates `node.loc` in a ref for live feedback (no React render during the drag). On `pointerup`, `commitSingleDrag()` (`:459`) fires. Note the **dual listener** design: `pointerup` on the node itself *and* a fallback on `app.stage` / `window`, both null-checking the ref, so a gesture ending anywhere still commits and double-firing is a harmless no-op.
Group gestures resolve through `resolveGroupIds()` (`:514`): a racking location expands to its whole aisle via `locationIdsInAisle`; everything else, including shelf/floor storage, selects only itself.

**A2. Client state update (no transport yet)**
`onGeometryChange` → `handlePatchLocation` → `dispatch({ type: "PATCH_LOCATION" })` → `draftReducer` → `pushHistory()` snapshots the previous `HallState` onto `past` and clears `future`.
Two side effects follow:
- `useEffect` at `:462` mirrors the whole `draftState` to `localStorage` under `stroom:layout-draft:{warehouseId}` with `version: 2`.
- `useEffect` at `:490` schedules the 1500 ms debounced server autosave → `saveHallDraft()` → `INSERT ... ON CONFLICT (hall_id, employee_id) DO UPDATE` on `layout_drafts`.

The canvas re-renders from `applyHallStateToLocations(locations, hallState)`. **Nothing has been published.**

**A3. Bridge / transport — "Save Map"**
`handleSaveMap()` (`:776`) collects every hall with `hallStateChangeCount > 0` and calls, inside a `useTransition`:
```ts
commitHallStates(warehouseId, statesToSave, currentVersionNumber)
```
Transport is a **Next.js Server Action** — an RPC over a POST to the same route, with the payload serialised by React's server-action serialiser. `currentVersionNumber` is the OCC token.

**A4. Server & business logic** — `actions.ts:183`
1. `requireLayoutContext(warehouseId)` → Supabase JWT claims → `employees ⋈ position_types` → assert `can_modify_locations`, assert warehouse ∈ organisation.
2. Bulk ownership check: every `hallId` in the payload must belong to this warehouse.
3. `db.transaction(async tx => { ... })` opens the boundary. **Everything below is one transaction.**
4. **OCC read-check:** `SELECT MAX(version_number) ... ORDER BY version_number DESC LIMIT 1` (with a `LEFT JOIN employees` so the conflict message can name the publisher). If `currentNumber !== baseVersionNumber` → `throw new LayoutVersionConflictError`.
5. Per hall, in **dependency order**: new locations → location patches → location deletes → new features (`buildFeatureInsert`, envelope re-derived, `validateAttrs`) → feature patches (read-back + merge + recompute envelope) → feature deletes → hall patch.

**A5. Database execution**
- Reads: `layout_versions` (OCC), `layout_features` (per-patch read-back).
- Writes: `locations`, `layout_features`, `halls` — all `INSERT`/`UPDATE`/`DELETE` scoped by `warehouseId` (and `hallId` for features) in the `WHERE`, so a forged id cannot escape the tenant.
- **The publish record:** `INSERT INTO layout_versions (version_number = base + 1, graph_epoch = current.graphEpoch + 1, change_count, published_by)`. Guarded by `unique("uq_layout_versions_wh_number")` — this constraint *is* the concurrency control. Same transaction as the writes, so **a layout change can never exist without a version marking it**.
- **Draft cleanup:** `DELETE FROM layout_drafts WHERE hall_id IN (...) AND employee_id = me`. Only *this* employee's — someone else's in-progress draft for the same hall is still their work to reconcile.
- FK behaviour worth noting: `nav_nodes.source_feature_id` / `nav_edges.source_feature_id` are `ON DELETE SET NULL`, and feature deletes are still **hard** deletes — flagged in-code (`actions.ts:575`) as needing to become soft deletes (`is_active = false`) once nav edges genuinely depend on them.

**A6. Return path & revalidation**
- Conflict → `{ conflict: {...} }`; `23505` → the same shape. Otherwise `{ success: true, versionNumber }`.
- `revalidateLayout(warehouseId)` → `revalidatePath('/warehouses/{id}/layout-designer')`.
- Client: on conflict, **the draft is preserved** and an amber banner offers "Reload layout". On success, `lastSavedRef.current = {}` and `dispatch({ type: "RESET_ALL" })` clears the store; the revalidated server component streams the new base data down as props.

---

### TRACE B — "Compile graph"

**B1. Client trigger** — `nav-graph-panel.tsx:49` `handleCompile()`, inside `useTransition`.
**B2. Transport** — Server Action `compileHallGraph(warehouseId, hallId, 1)`.
**B3. Server logic** — `graph-actions.ts:54`
1. `requireLayoutContext` + `hallBelongsToWarehouse`.
2. Load the hall, then **four parallel queries** (`Promise.all`): all `locations` in the hall, all active `layout_features`, all `mhe_types`, and the current `layout_versions` row.
3. Guard: if no MHE type has a `class_bit`, abort — every lane would be usable by nothing, so an empty graph would be a *silently* useless result.
4. Narrow varchar-with-check columns into TS unions (`parseLocationType`, `geometryKind as GeometryKind`), `sanitizePoints` the jsonb.
5. **Pure call:** `compileNavigationGraph({ hall, locations, features, vehicles, floorLevel })` → `{ nodes, edges, accessPoints, warnings, stats }`. No I/O inside.

**B4. Database execution** — one transaction:
- `SELECT node_id FROM nav_nodes WHERE hall_id AND floor_level AND is_generated = true` — capture the generated set.
- `DELETE FROM nav_edges WHERE hall_id AND is_generated = true` — **edges first**, they reference nodes.
- `DELETE FROM location_access_points WHERE node_id IN (...)` — explicit, though the FK would cascade; deleting it explicitly keeps the intent visible.
- `DELETE FROM nav_nodes WHERE node_id IN (...)`.
- **`is_generated = false` rows survive untouched** — a supervisor correcting the compiler's guess must not have that correction thrown away every time anyone presses the button.
- `INSERT INTO nav_nodes ... RETURNING node_id`, then `nodeIdByKey` is built by **index alignment** between the compiler's node array and the returned ids (`graph-actions.ts:256`) — this is the mechanism that maps the compiler's string keys onto real serial ids.
- `INSERT INTO nav_edges` (resolving `fromKey`/`toKey` through that map) and `INSERT INTO location_access_points`, all stamped with `layout_version`.
- Constraints in play: `chk_nav_edge_endpoints (from <> to)`, `chk_nav_edge_length >= 0`, `chk_nav_node_kind`, `uq_location_access_point (location_id, node_id)`.

**B5. Return path** — `{ success, stats, warnings, layoutVersion }` → `revalidateLayout` → `router.refresh()`. The panel renders warnings tone-coded by `WARNING_TONE` (unreachable/disconnected = error, narrow aisle/lane-through-obstacle = warn), and the canvas overlays the graph because `showNavGraph` defaults to `true` once a graph exists — the whole point is that you can *see* what the compiler inferred and judge it against the building.

---

### TRACE C — "Compute route" (A\* + TSP)

**C1. Client trigger** — canvas multi-select populates `selectedLocationIds` → `handleMultiSelect` (which also clears any existing route preview). `route-panel.tsx:55` `handleRoute()`: first selection is the origin, the rest are stops; `mheTypeId` selects the traveller (`"foot"` → `null`). Client-side guard `canRoute = hasGraph && selected.length >= 2`.

**C2. Transport** — Server Action `previewRoute(warehouseId, hallId, fromLocationId, toLocationIds[], { mheTypeId })`.

**C3. Server logic** — `routing-actions.ts:114`
1. `requireLayoutContext`; filter the origin out of the stop list.
2. Read `(versionNumber, graphEpoch)` — the cache key and the plan stamp.
3. **One join** fetches every access point plus location code: `location_access_points ⋈ locations WHERE warehouse_id AND location_id IN (...)`. First access point per location wins (double-deep racking legitimately has several; the primary is enough for a preview).
4. Build the `Traveller`: `classBit`, `heightMm`, `widthMm`, `turningRadiusMm`, `maxSpeedLadenMms` from `mhe_types`; default `{ classBit: 0 }` for on-foot.
5. `loadRoutingGraph(hallId, layoutVersion, graphEpoch)` — cache hit, or two parallel `SELECT`s on `nav_nodes`/`nav_edges` → `buildRoutingGraph()` (CSR).
6. **Branch:**
   - 1 stop → `findRoute()` — arc-state A\*.
   - N stops → `sequencePickPath()` — one `costsFrom()` Dijkstra per terminal, nearest-neighbour tour, 2-opt under a 250 ms budget → `routeThrough()` stitches the legs into one continuous polyline.
7. Map the visiting order back to location codes, **consuming** matches rather than reusing them (several bays can share one access node).
8. `handlingMs = Σ access_point.handling_time_ms` — computed separately from travel, because travel and handling are improved by completely different things (layout vs process).

**C4. Database execution**
- Read-only by default. `persist: false` for the designer preview: "a preview that nobody acts on is not worth a row."
- With `persist: true` → `INSERT INTO route_plans` with `edge_ids` (the integer array that makes blockage invalidation cheap), `stops` jsonb, `est_duration_ms = travel + handling`, and the `(layout_version, graph_epoch)` stamp.

**C5. Return path** — `RoutePreview` DTO → `setRoutePreview` in `layout-designer.tsx` → passed to the canvas as `routePoints` and drawn as a polyline. The panel shows distance, split travel/handling durations, segment count, the chosen visiting order, and — when `sequencingTruncated` — an honest "good, not proven optimal" note.

---

### TRACE D — Report a blockage (dynamic edge invalidation)

**D1. Client trigger** — `blockage-panel.tsx` "pick a point" → `isPicking` → Pixi `pointerdown` on the live canvas viewport (`live-map-canvas.tsx:287`) → `viewport.toWorld(e.global)` converts screen px to world mm → `onPointPicked`. Then reason, radius (m → mm), optional expiry. Panel is gated on `canReport`.
**D2. Transport** — Server Action `reportBlockage(warehouseId, hallId, { xMm, yMm, radiusMm, reason, expiresInMinutes })`.
**D3. Server logic** — `live-actions.ts:41`
1. `requireLiveMapContext` → **`canReportBlockages` (`can_assign_tasks`)**, not the layout permission — raising a blockage is directing floor work.
2. Load nodes + edges for the hall; for each edge compute `distanceToSegment(centre, from, to)`; keep those within the radius.
3. **Early reject** if nothing is covered: "this would block nothing — widen it or move it onto an aisle." Better an error than a no-op record.

**D4. Database execution** — one transaction:
- `INSERT INTO layout_blockages` with the resolved `edge_ids` array, origin/radius (for drawing), reason, `reported_by`, optional `expires_at`.
- `bumpGraphEpoch(tx, warehouseId)` — read the newest `layout_versions` row, `UPDATE ... SET graph_epoch = graph_epoch + 1`. **This one write invalidates every cached route and every in-process CSR graph**, because both are keyed on the pair.
- `findRoutesCrossing()` — `SELECT route_plan_id FROM route_plans WHERE warehouse_id AND superseded_by IS NULL AND graph_epoch = currentEpoch - 1 AND edge_ids && ARRAY[...]`. The epoch predicate limits it to plans that were valid a moment ago; the `&&` array overlap is the whole point of denormalising `edge_ids`.

**D5. Return path** — `{ blockageId, blockedEdgeIds, invalidatedRoutePlanIds, graphEpoch }` → `revalidateLiveMap` + `router.refresh()`. The panel reports the operationally meaningful number: not how many segments were blocked, but **how many people are currently routed through them**. `clearBlockage` is symmetric — it also bumps the epoch, because a route planned the long way round is now needlessly long.

---

### TRACE E — A position report becomes a moving dot

**E1. Source (write side)** — `reportAssetPosition()` (`live-actions.ts:255`):
- `INSERT ... ON CONFLICT (asset_kind, asset_ref_id) DO UPDATE` on `asset_positions` — **one row per asset, upserted, never an append log**.
- `asset_position_history` is appended **only when the asset actually moved > 500 mm**. That threshold is what keeps the trail useful for heatmaps without it becoming a firehose, and the two tables are deliberately separate so retention can be short on identified traces without losing the current snapshot (regulated data in the EU).
- `confidence` is clamped to `[0,1]` and stored as `numeric(3,2)`, matched by `chk_asset_position_confidence`.

**E2. Initial snapshot (server component)** — `live-map/page.tsx` runs **eight parallel queries**, including `asset_positions ⋈ employees` for labels and `layout_blockages` filtered by `is_active AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)` — expiry evaluated by the database, because an expired blockage is stale data, not an obstruction. This is what the map shows *before* the first live message lands.

**E3. Transport (live)** — `use-live-map.ts:121`. One channel `wh:{warehouseId}:hall:{hallId}` carrying:
- `presence.sync` → current occupants pushed into `pendingRef` (buffer).
- `broadcast "map"` → `advanceStream()` for gap detection; `POSITION` payloads buffer, `LAYOUT`/`BLOCKAGE` set `layoutChangedAt`.
- `subscribe(status)` → `live` / `reconnecting` / `idle`, surfaced as a coloured radio icon.

**E4. Client processing** — a 150 ms `setInterval` calls `flush()`: `coalescePositions()` reduces the burst to the latest per asset, one `setAssets` produces **one** React render, and anyone past `ASSET_EXPIRY_MS` is evicted so the map doesn't accumulate ghosts.
On `resyncRequestedAt` or `layoutChangedAt`, `live-map-view.tsx:120` calls `router.refresh()` inside a transition — **refetch, don't reconcile**.

**E5. Render** — `live-map-canvas.tsx:297`, on the Pixi ticker (every frame, reading refs, not React state):
```
renderAssetAt(asset, Date.now())
  → confidenceAt(age, source)        // exponential decay
  → nearestPointOnPolyline(route, fix)  // anchor
  → pointAlongPolyline(route, along + v·t)  // dead reckoning, clamped
```
Drawn as: a halo whose radius grows as confidence falls, a fill that goes translucent below `CONFIDENCE_STALE`, and a heading tick **only when interpolated**. Static geometry (racking, features, nav graph) redraws only when the published layout actually changes.

---

### TRACE F — Bulk location generation (deliberately outside the draft engine)

**F1. Client** — `bulk-generator-dialog.tsx`, a `<form>` posting `FormData`.
**F2. Transport** — Server Action `bulkGenerateLocations(formData)` — `FormData` rather than a typed object, because this is a real form submission.
**F3. Server logic** — `actions.ts:947`
- Auth + `hallBelongsToWarehouse`.
- `validateTemplate()` then one of three pure builders — `buildRackingLocations` (true 2-D grid, independent horizontal/vertical numbering direction), `buildFloorLineLocations` / `buildShelvingLocations` (single-axis, one `sequenceDirection` toggle). **Physical placement is always top-to-bottom/left-to-right; only the *numbers* reverse**, so "RTL" racking occupies the same footprint, numbered from the other end.
- `renderLocationTemplate()` expands `{Aisle:letter}-{Bay:number}-{Level:number}`.
- Guards: ≤ 2000 rows per batch; no empty codes; no intra-batch collisions.
**F4. Database** — a single multi-row `INSERT ... ON CONFLICT (warehouse_id, location_code) DO NOTHING RETURNING location_id`. `created = inserted.length`, `skipped = drafts.length - created`.
**F5. Return** — `{ created, skipped, total }` + `revalidateLayout`. If *nothing* was created it returns an error, because a silent 100 %-skip looks identical to success.

> **Why this one is outside the draft engine:** it is already a deliberate, reviewed, atomic operation, and staging hundreds of generated rows as drafts would add a lot of complexity for little benefit (documented at `actions.ts:676`).

---

## 3. Glossary for interviews

One-sentence pitches, each tied to what is actually in this codebase.

**Arc-state A\* / edge-based pathfinding**
> "I implemented A\* over a directed-arc state space rather than a node state space, because turn penalties are a function of the arc pair — a node-based search structurally cannot represent 'this reach truck pays 2.5 seconds for a 90° corner'."

**Admissible heuristic**
> "The heuristic is Euclidean distance divided by the *network's* fastest speed, not the traveller's — dividing by the traveller's speed over-estimates wherever the network is faster and quietly breaks optimality."

**Compressed Sparse Row (CSR)**
> "The routing graph compiles into flat typed arrays in CSR layout, so expansion is a sequential scan over `arcOffset[n]..arcOffset[n+1]` instead of chasing pointers through an object graph and thrashing cache."

**Deterministic tie-breaking**
> "The priority queue breaks ties on lower f, then higher g, then arc id — because symmetric racking produces exact cost ties, and a router that returns a different-but-equal path per poll makes the operator's screen flicker."

**Metaheuristic / anytime algorithm (TSP)**
> "Multi-stop pick ordering is an asymmetric TSP, so I approximate it: nearest-neighbour construction plus 2-opt local search under a 250 ms budget, and the API reports `truncated` when the budget bound rather than convergence ended the search."

**Pipeline compiler with a diagnostics channel**
> "The nav-graph builder is a compiler: it lowers authored geometry to inferred topology to persisted graph, and emits typed warnings — unreachable locations, disconnected components, aisles narrower than the fleet needs — instead of failing."

**Spatial hash grid**
> "Node deduplication uses a uniform spatial hash with cell size equal to the merge radius, so a 3×3 neighbourhood scan is provably sufficient — pure cell snapping has a boundary artifact where two points 200 mm apart land in different cells and a pick face becomes an isolated island."

**Union-Find with path compression**
> "Graph connectivity is validated with disjoint-set union at compile time, so an unreachable pick face is a design-time warning rather than a picker standing in front of a wall."

**Optimistic Concurrency Control**
> "Publishing carries the layout version it was based on; the transaction re-checks it, and a unique constraint on `(warehouse_id, version_number)` is the real enforcement — two supervisors racing to publish N+1 means the loser's whole transaction rolls back, and critically their draft is kept, not discarded."

**Command pattern + Memento (undo/redo)**
> "The designer is a reducer over immutable `HallState` snapshots with past/present/future stacks — every gesture is a typed command, and nothing reaches the database until an explicit commit."

**Unit of Work**
> "One server action is the single write path: it opens a transaction, resolves temp ids to real ids in dependency order, applies every staged create/patch/delete, and records the version — so a layout change can never exist without a version marking it."

**Write-behind cache / debounced autosave**
> "Drafts autosave to the server on a 1.5 s debounce with dirty-set tracking and an idempotent upsert, with localStorage as the offline fallback and the server copy as the authority."

**Epoch-based cache invalidation**
> "Routes are stamped with `(layout_version, graph_epoch)`; a republish moves the version and a blockage moves the epoch, so any mismatch means recompute — and I deliberately did *not* add a 'stale' flag, because a second source of truth can disagree with the stamp."

**Denormalisation for query shape**
> "Route plans store their ordered `edge_ids` as a Postgres array specifically so blockage invalidation is a single `&&` array-overlap predicate instead of a spatial query joined against every stored route."

**Dead reckoning / local state interpolation**
> "Most warehouses have no RTLS, so a barcode scan is a hard fix and everything between scans is interpolated forward along the assigned route at nominal speed, clamped to the route's end — arriving early and waiting is a much smaller lie than sailing through a wall."

**Exponential confidence decay**
> "Position certainty decays on a 45-second half-life — four times longer for continuous telemetry, because silence from a telemetry feed means 'not moving' while silence from a scanner means 'we lost them' — and the UI draws the uncertainty as a growing halo rather than hiding it."

**Map matching**
> "Live positions are snapped to their nearest graph edge within a 3 m tolerance, which is what turns a dot into a countable traversal and makes congestion measurable."

**Damped feedback control**
> "Congestion feeds back into edge impedance, but capped at 3× and only above 75 % occupancy — naive congestion routing oscillates, because everyone reroutes onto the empty aisle which promptly becomes the congested one."

**Snapshot + delta stream with gap detection**
> "Events carry a server-assigned monotonic sequence number — never a timestamp, because device clocks in a warehouse are minutes out — and a detected gap triggers a full snapshot refetch rather than reconciliation, since a subtly wrong live map is worse than one that blinks."

**Event conflation / backpressure**
> "Incoming positions are buffered and coalesced to the latest per asset, then flushed every 150 ms, so a burst of 200 updates is one React render — and the render loop itself runs on the Pixi ticker, decoupled from React entirely."

**Transport selection by data characteristic**
> "Positions ride a Presence channel because they're last-write-wins and ephemeral — persisting 200 workers at 1 Hz would be 17 million rows a day of data whose value expires in seconds — while durable events ride a sequenced broadcast channel."

**Functional core / imperative shell**
> "All the geometry, compilation, routing and estimation logic is pure and framework-free, so the same `computeEnvelope` runs on the canvas and in the server commit — which is what makes 'never trust the client's derived values' cheap instead of a duplicated implementation."

**Defence in depth / tolerant reader**
> "`jsonb` enforces nothing, so a hand-written validator is the only gate on feature attributes; it rounds and range-checks known keys and silently drops unknown ones, so an older client sending a removed attribute doesn't fail the whole save."

**Capability-based authorisation as a privacy boundary**
> "Viewing the live map requires `can_view_metrics` and reporting a blockage requires `can_assign_tasks` — separate from the layout-edit permission, because individual worker location is regulated in the EU and a supervisor who should see where people are has no business moving racking."

---

## 4. Honest trade-offs and known limitations

Worth being able to name these — they are the follow-up questions.

1. **`graphCache` is per-process** (`routing-actions.ts:50`). Correct (the epoch key makes serving a stale graph impossible) but not shared across instances, and it has no eviction policy — it grows with the number of halls touched by that process.
2. **2-opt is O(n³) per sweep** because `tourCost()` is recomputed per candidate rather than evaluated as a delta. Safe only because of the deadline guard; an incremental delta evaluation would raise the stop count that converges within budget.
3. **Cross-aisle connector inference is O(E²)** over corridor endpoints (`graph-compiler.ts:732`), as is `splitAtIntersections` over all segments. Fine at hall scale; a sweep-line or R-tree would be needed if hall counts grow by an order of magnitude.
4. **`nodeIdByKey` relies on `RETURNING` preserving insert order** (`graph-actions.ts:256`). True in practice for a multi-row `VALUES` insert, and the code documents the assumption, but it is an assumption rather than a guarantee.
5. **Feature deletes are hard deletes** (`actions.ts:575`), flagged in-code as needing to become soft deletes once nav edges genuinely depend on them. Today the FKs are `ON DELETE SET NULL`, so a delete silently orphans the provenance link on generated edges.
6. **Congestion is computed but not yet wired into routing.** `computeCongestion` / `congestionImpedance` exist and are correct, but `arcImpedance` is populated from the stored `nav_edges.impedance` column at build time — closing that loop is the remaining step for genuinely dynamic re-routing.
7. **`previewRoute` uses the first access point per location.** Documented as sufficient for a preview; double-deep and back-to-back racking reachable from two aisles at different costs would need the cheapest-access-point choice folded into the search.
