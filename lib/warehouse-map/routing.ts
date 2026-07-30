// Routing over a compiled navigation graph.
//
//   1. Cost is TIME, not distance. Shortest distance is the wrong answer the
//      moment a lane has a speed limit, a lift has a cycle time, or a turn
//      costs a reach truck three seconds.
//
//   2. The search state is a DIRECTED ARC, not a node. Turn cost depends on
//      the edge you arrived on, so a node-state search physically cannot
//      express it. The arc you just traversed *is* the state.

import type { Point } from "./geometry";

// --- Tuning ---------------------------------------------------------------

/** Cost of a square turn for a nominal vehicle. Scaled by angle, and by how
 *  unwieldy the vehicle is (its turning radius). */
export const TURN_BASE_MS = 2500;
/** Turns shallower than this are free -- drifting round a gentle bend is not
 *  a manoeuvre. */
export const TURN_FREE_DEG = 25;
/** Extra cost for reversing direction on the spot. Allowed, because a
 *  dead-end aisle leaves no alternative, but never chosen casually. */
export const U_TURN_EXTRA_MS = 6000;
/** Fallback speed when neither the edge nor the vehicle states one. */
export const DEFAULT_SPEED_MMS = 1200;

// --- Graph ----------------------------------------------------------------

export type RoutingNode = {
  nodeId: number;
  xMm: number;
  yMm: number;
  floorLevel: number;
};

export type RoutingEdge = {
  edgeId: number;
  fromNodeId: number;
  toNodeId: number;
  traversal: "BIDIRECTIONAL" | "FORWARD_ONLY" | "REVERSE_ONLY";
  lengthMm: number;
  maxSpeedMms: number | null;
  minClearanceMm: number | null;
  maxWeightKg: number | null;
  maxVehicleWidthMm: number | null;
  allowedVehicleMask: number;
  impedance: number;
  fixedDelayMs: number;
};

/**
 * Flat typed-array adjacency (compressed sparse row).
 *
 * Object graphs allocate on every expansion and thrash the cache; typed
 * arrays keep the whole thing resident in a few hundred KB. Built once per
 * (warehouse, layout_version) and cached.
 */
export type CompiledRoutingGraph = {
  nodeCount: number;
  arcCount: number;
  /** nodeId -> dense index. */
  indexByNodeId: Map<number, number>;
  nodeId: Int32Array;
  nodeX: Int32Array;
  nodeY: Int32Array;
  nodeFloor: Int8Array;
  /** arcs of node n are arcOffset[n] .. arcOffset[n+1]-1 */
  arcOffset: Int32Array;
  arcTarget: Int32Array;
  arcSource: Int32Array;
  arcEdgeId: Int32Array;
  arcLength: Float64Array;
  arcSpeed: Float64Array;
  arcMask: Int32Array;
  arcClearance: Int32Array;
  arcWeight: Int32Array;
  arcWidth: Int32Array;
  arcImpedance: Float64Array;
  arcFixedDelay: Float64Array;
  /** Heading of each arc in radians, for turn penalties. */
  arcHeading: Float64Array;
  /** Fastest speed anywhere in the network -- the heuristic divisor. */
  maxSpeedMms: number;
};

export function buildRoutingGraph(
  nodes: RoutingNode[],
  edges: RoutingEdge[],
): CompiledRoutingGraph {
  const nodeCount = nodes.length;
  const indexByNodeId = new Map<number, number>();
  nodes.forEach((node, index) => indexByNodeId.set(node.nodeId, index));

  const nodeId = new Int32Array(nodeCount);
  const nodeX = new Int32Array(nodeCount);
  const nodeY = new Int32Array(nodeCount);
  const nodeFloor = new Int8Array(nodeCount);
  nodes.forEach((node, index) => {
    nodeId[index] = node.nodeId;
    nodeX[index] = node.xMm;
    nodeY[index] = node.yMm;
    nodeFloor[index] = node.floorLevel;
  });

  // Expand each stored edge into its directed arcs. Edges are stored once per
  // physical connection; direction is a property, not two rows.
  type RawArc = { from: number; to: number; edge: RoutingEdge };
  const raw: RawArc[] = [];
  for (const edge of edges) {
    const from = indexByNodeId.get(edge.fromNodeId);
    const to = indexByNodeId.get(edge.toNodeId);
    if (from === undefined || to === undefined) continue;
    if (edge.traversal !== "REVERSE_ONLY") raw.push({ from, to, edge });
    if (edge.traversal !== "FORWARD_ONLY") raw.push({ from: to, to: from, edge });
  }

  // Counting sort into CSR order.
  const arcCount = raw.length;
  const arcOffset = new Int32Array(nodeCount + 1);
  for (const arc of raw) arcOffset[arc.from + 1]++;
  for (let i = 0; i < nodeCount; i++) arcOffset[i + 1] += arcOffset[i];

  const cursor = Int32Array.from(arcOffset);
  const arcTarget = new Int32Array(arcCount);
  const arcSource = new Int32Array(arcCount);
  const arcEdgeId = new Int32Array(arcCount);
  const arcLength = new Float64Array(arcCount);
  const arcSpeed = new Float64Array(arcCount);
  const arcMask = new Int32Array(arcCount);
  const arcClearance = new Int32Array(arcCount);
  const arcWeight = new Int32Array(arcCount);
  const arcWidth = new Int32Array(arcCount);
  const arcImpedance = new Float64Array(arcCount);
  const arcFixedDelay = new Float64Array(arcCount);
  const arcHeading = new Float64Array(arcCount);

  let maxSpeed = DEFAULT_SPEED_MMS;
  for (const arc of raw) {
    const slot = cursor[arc.from]++;
    arcTarget[slot] = arc.to;
    arcSource[slot] = arc.from;
    arcEdgeId[slot] = arc.edge.edgeId;
    arcLength[slot] = arc.edge.lengthMm;
    const speed = arc.edge.maxSpeedMms ?? DEFAULT_SPEED_MMS;
    arcSpeed[slot] = speed;
    if (speed > maxSpeed) maxSpeed = speed;
    arcMask[slot] = arc.edge.allowedVehicleMask;
    arcClearance[slot] = arc.edge.minClearanceMm ?? 0;
    arcWeight[slot] = arc.edge.maxWeightKg ?? 0;
    arcWidth[slot] = arc.edge.maxVehicleWidthMm ?? 0;
    arcImpedance[slot] = arc.edge.impedance > 0 ? arc.edge.impedance : 1;
    arcFixedDelay[slot] = arc.edge.fixedDelayMs;
    arcHeading[slot] = Math.atan2(
      nodeY[arc.to] - nodeY[arc.from],
      nodeX[arc.to] - nodeX[arc.from],
    );
  }

  return {
    nodeCount,
    arcCount,
    indexByNodeId,
    nodeId,
    nodeX,
    nodeY,
    nodeFloor,
    arcOffset,
    arcTarget,
    arcSource,
    arcEdgeId,
    arcLength,
    arcSpeed,
    arcMask,
    arcClearance,
    arcWeight,
    arcWidth,
    arcImpedance,
    arcFixedDelay,
    arcHeading,
    maxSpeedMms: maxSpeed,
  };
}

/**
 * Returns a graph whose arc impedances are scaled by a per-edge multiplier.
 *
 * Only `arcImpedance` is copied; every other typed array is shared with the
 * source graph (they are read-only from here on), so this is an O(arcCount)
 * operation, not a deep clone. This is how live traffic conditions reach the
 * router without `CompiledRoutingGraph` itself knowing anything about the
 * database or about congestion -- the base graph stays a pure function of
 * layout, and "what it currently costs to use" is layered on top of it by
 * whoever is asking.
 */
export function withImpedanceOverrides(
  graph: CompiledRoutingGraph,
  multiplierByEdgeId: Map<number, number>,
): CompiledRoutingGraph {
  if (multiplierByEdgeId.size === 0) return graph;

  const arcImpedance = Float64Array.from(graph.arcImpedance);
  let touched = false;
  for (let arc = 0; arc < graph.arcCount; arc++) {
    const multiplier = multiplierByEdgeId.get(graph.arcEdgeId[arc]);
    if (multiplier === undefined || multiplier === 1) continue;
    arcImpedance[arc] *= multiplier;
    touched = true;
  }
  if (!touched) return graph;

  return { ...graph, arcImpedance };
}

// --- Traveller ------------------------------------------------------------

export type Traveller = {
  /** Bit position of this vehicle's class in the edge masks. */
  classBit: number;
  /** Overall height, checked against edge clearance. */
  heightMm?: number | null;
  widthMm?: number | null;
  weightKg?: number | null;
  turningRadiusMm?: number | null;
  maxSpeedMms?: number | null;
};

function arcPassable(
  graph: CompiledRoutingGraph,
  arc: number,
  traveller: Traveller,
): boolean {
  if ((graph.arcMask[arc] & (1 << traveller.classBit)) === 0) return false;

  const clearance = graph.arcClearance[arc];
  if (clearance > 0 && traveller.heightMm && traveller.heightMm > clearance) {
    return false;
  }
  const maxWidth = graph.arcWidth[arc];
  if (maxWidth > 0 && traveller.widthMm && traveller.widthMm > maxWidth) {
    return false;
  }
  const maxWeight = graph.arcWeight[arc];
  if (maxWeight > 0 && traveller.weightKg && traveller.weightKg > maxWeight) {
    return false;
  }
  return true;
}

function arcBaseCostMs(
  graph: CompiledRoutingGraph,
  arc: number,
  traveller: Traveller,
): number {
  const speed = Math.min(
    graph.arcSpeed[arc],
    traveller.maxSpeedMms ?? Number.POSITIVE_INFINITY,
  );
  const effective = speed > 0 ? speed : DEFAULT_SPEED_MMS;
  return (
    (graph.arcLength[arc] / effective) * 1000 * graph.arcImpedance[arc] +
    graph.arcFixedDelay[arc]
  );
}

/**
 * Cost of swinging from one arc onto the next.
 *
 * This is the reason the search state is an arc: the penalty is a function of
 * the pair, and a node-state search has no way to know where you came from.
 */
export function turnPenaltyMs(
  graph: CompiledRoutingGraph,
  fromArc: number,
  toArc: number,
  traveller: Traveller,
): number {
  let delta = graph.arcHeading[toArc] - graph.arcHeading[fromArc];
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const degrees = Math.abs((delta * 180) / Math.PI);
  if (degrees <= TURN_FREE_DEG) return 0;

  // A long-wheelbase truck pays more for the same corner than a pallet jack.
  const agility = traveller.turningRadiusMm
    ? 1 + traveller.turningRadiusMm / 2000
    : 1;
  const base = ((degrees - TURN_FREE_DEG) / 90) * TURN_BASE_MS * agility;
  return degrees > 150 ? base + U_TURN_EXTRA_MS * agility : base;
}

// --- Binary heap ----------------------------------------------------------

/**
 * Min-heap over arc states. Ties break on lower f, then higher g, then lower
 * arc id -- deterministic all the way down.
 *
 * Determinism is not a nicety here: with symmetric racking, many paths tie
 * exactly, and a router that returns a different-but-equal path on each poll
 * makes the picker's screen flicker and destroys their trust in it.
 */
class ArcHeap {
  private arcs: number[] = [];
  private fs: number[] = [];
  private gs: number[] = [];

  get size() {
    return this.arcs.length;
  }

  private less(i: number, j: number): boolean {
    if (this.fs[i] !== this.fs[j]) return this.fs[i] < this.fs[j];
    if (this.gs[i] !== this.gs[j]) return this.gs[i] > this.gs[j];
    return this.arcs[i] < this.arcs[j];
  }

  private swap(i: number, j: number) {
    [this.arcs[i], this.arcs[j]] = [this.arcs[j], this.arcs[i]];
    [this.fs[i], this.fs[j]] = [this.fs[j], this.fs[i]];
    [this.gs[i], this.gs[j]] = [this.gs[j], this.gs[i]];
  }

  push(arc: number, f: number, g: number) {
    this.arcs.push(arc);
    this.fs.push(f);
    this.gs.push(g);
    let i = this.arcs.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { arc: number; f: number; g: number } | null {
    if (this.arcs.length === 0) return null;
    const top = { arc: this.arcs[0], f: this.fs[0], g: this.gs[0] };
    const last = this.arcs.length - 1;
    this.swap(0, last);
    this.arcs.pop();
    this.fs.pop();
    this.gs.pop();

    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < this.arcs.length && this.less(left, smallest)) smallest = left;
      if (right < this.arcs.length && this.less(right, smallest)) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
    return top;
  }
}

// --- A* -------------------------------------------------------------------

export type RouteResult = {
  found: boolean;
  /** Ordered stored-edge ids, deduplicated of direction. */
  edgeIds: number[];
  /** Ordered node ids, starting at the origin. */
  nodeIds: number[];
  /** Polyline of the route in world mm, for rendering. */
  points: Point[];
  durationMs: number;
  distanceMm: number;
  /** Arc states expanded -- useful for spotting a heuristic that has gone bad. */
  expanded: number;
};

const EMPTY_ROUTE: RouteResult = {
  found: false,
  edgeIds: [],
  nodeIds: [],
  points: [],
  durationMs: 0,
  distanceMm: 0,
  expanded: 0,
};

/**
 * A* from one node to another, searching over directed arcs.
 *
 * The heuristic is straight-line distance divided by the *network's* fastest
 * speed. Dividing by the traveller's own speed would over-estimate wherever
 * the network is faster than the traveller, making the heuristic inadmissible
 * and quietly returning non-optimal routes.
 */
export function findRoute(
  graph: CompiledRoutingGraph,
  fromNodeId: number,
  toNodeId: number,
  traveller: Traveller,
): RouteResult {
  const start = graph.indexByNodeId.get(fromNodeId);
  const goal = graph.indexByNodeId.get(toNodeId);
  if (start === undefined || goal === undefined) return EMPTY_ROUTE;

  if (start === goal) {
    return {
      found: true,
      edgeIds: [],
      nodeIds: [fromNodeId],
      points: [{ x: graph.nodeX[start], y: graph.nodeY[start] }],
      durationMs: 0,
      distanceMm: 0,
      expanded: 0,
    };
  }

  const goalX = graph.nodeX[goal];
  const goalY = graph.nodeY[goal];
  const divisor = graph.maxSpeedMms > 0 ? graph.maxSpeedMms : DEFAULT_SPEED_MMS;
  const heuristic = (nodeIndex: number) =>
    (Math.hypot(graph.nodeX[nodeIndex] - goalX, graph.nodeY[nodeIndex] - goalY) /
      divisor) *
    1000;

  const bestG = new Float64Array(graph.arcCount).fill(Infinity);
  const cameFrom = new Int32Array(graph.arcCount).fill(-1);
  const closed = new Uint8Array(graph.arcCount);
  const heap = new ArcHeap();

  for (let arc = graph.arcOffset[start]; arc < graph.arcOffset[start + 1]; arc++) {
    if (!arcPassable(graph, arc, traveller)) continue;
    const g = arcBaseCostMs(graph, arc, traveller);
    bestG[arc] = g;
    heap.push(arc, g + heuristic(graph.arcTarget[arc]), g);
  }

  let expanded = 0;
  let goalArc = -1;

  while (heap.size > 0) {
    const top = heap.pop()!;
    const arc = top.arc;
    if (closed[arc]) continue;
    // A stale heap entry for an arc we have since improved.
    if (top.g > bestG[arc]) continue;
    closed[arc] = 1;
    expanded++;

    const head = graph.arcTarget[arc];
    if (head === goal) {
      goalArc = arc;
      break;
    }

    for (let next = graph.arcOffset[head]; next < graph.arcOffset[head + 1]; next++) {
      if (closed[next]) continue;
      if (!arcPassable(graph, next, traveller)) continue;

      const g =
        bestG[arc] +
        arcBaseCostMs(graph, next, traveller) +
        turnPenaltyMs(graph, arc, next, traveller);

      if (g < bestG[next]) {
        bestG[next] = g;
        cameFrom[next] = arc;
        heap.push(next, g + heuristic(graph.arcTarget[next]), g);
      }
    }
  }

  if (goalArc < 0) return { ...EMPTY_ROUTE, expanded };

  // Walk the parent chain back to the origin.
  const arcs: number[] = [];
  for (let arc = goalArc; arc !== -1; arc = cameFrom[arc]) arcs.push(arc);
  arcs.reverse();

  const edgeIds: number[] = [];
  const nodeIds: number[] = [graph.nodeId[start]];
  const points: Point[] = [{ x: graph.nodeX[start], y: graph.nodeY[start] }];
  let distanceMm = 0;

  for (const arc of arcs) {
    edgeIds.push(graph.arcEdgeId[arc]);
    const head = graph.arcTarget[arc];
    nodeIds.push(graph.nodeId[head]);
    points.push({ x: graph.nodeX[head], y: graph.nodeY[head] });
    distanceMm += graph.arcLength[arc];
  }

  return {
    found: true,
    edgeIds,
    nodeIds,
    points,
    durationMs: Math.round(bestG[goalArc]),
    distanceMm: Math.round(distanceMm),
    expanded,
  };
}

// --- Dijkstra (for distance matrices) -------------------------------------

/**
 * Cheapest time from one node to every other, over the same arc state space
 * A* uses so the numbers agree. Used to build the distance matrix that
 * pick-path sequencing needs.
 */
export function costsFrom(
  graph: CompiledRoutingGraph,
  fromNodeId: number,
  traveller: Traveller,
): Float64Array {
  const start = graph.indexByNodeId.get(fromNodeId);
  const nodeCost = new Float64Array(graph.nodeCount).fill(Infinity);
  if (start === undefined) return nodeCost;
  nodeCost[start] = 0;

  const bestG = new Float64Array(graph.arcCount).fill(Infinity);
  const closed = new Uint8Array(graph.arcCount);
  const heap = new ArcHeap();

  for (let arc = graph.arcOffset[start]; arc < graph.arcOffset[start + 1]; arc++) {
    if (!arcPassable(graph, arc, traveller)) continue;
    const g = arcBaseCostMs(graph, arc, traveller);
    bestG[arc] = g;
    heap.push(arc, g, g);
  }

  while (heap.size > 0) {
    const top = heap.pop()!;
    const arc = top.arc;
    if (closed[arc]) continue;
    if (top.g > bestG[arc]) continue;
    closed[arc] = 1;

    const head = graph.arcTarget[arc];
    if (bestG[arc] < nodeCost[head]) nodeCost[head] = bestG[arc];

    for (let next = graph.arcOffset[head]; next < graph.arcOffset[head + 1]; next++) {
      if (closed[next]) continue;
      if (!arcPassable(graph, next, traveller)) continue;
      const g =
        bestG[arc] +
        arcBaseCostMs(graph, next, traveller) +
        turnPenaltyMs(graph, arc, next, traveller);
      if (g < bestG[next]) {
        bestG[next] = g;
        heap.push(next, g, g);
      }
    }
  }

  return nodeCost;
}

// --- Pick path sequencing -------------------------------------------------

export type SequencedPick = {
  /** Stop node ids in visiting order. */
  order: number[];
  totalMs: number;
  /** True when 2-opt ran out of its budget before converging. */
  truncated: boolean;
};

/**
 * Orders a multi-stop pick.
 *
 * This is a TSP over access points, so it is approximated, not solved:
 * nearest-neighbour for a starting tour then 2-opt to iron out the crossings,
 * under a time budget. On conventional racking that lands within a few
 * percent of optimal, and the picker is walking, not racing a clock.
 */
export function sequencePickPath(
  graph: CompiledRoutingGraph,
  startNodeId: number,
  stopNodeIds: number[],
  traveller: Traveller,
  options: { endNodeId?: number; budgetMs?: number } = {},
): SequencedPick {
  const stops = Array.from(new Set(stopNodeIds)).filter(
    (id) => id !== startNodeId,
  );
  if (stops.length === 0) {
    return { order: [], totalMs: 0, truncated: false };
  }

  const terminals = [startNodeId, ...stops];
  if (options.endNodeId !== undefined) terminals.push(options.endNodeId);

  // One Dijkstra per terminal gives every pairwise cost.
  const costRows = new Map<number, Float64Array>();
  for (const nodeId of terminals) {
    if (!costRows.has(nodeId)) {
      costRows.set(nodeId, costsFrom(graph, nodeId, traveller));
    }
  }

  const cost = (fromNodeId: number, toNodeId: number): number => {
    const row = costRows.get(fromNodeId);
    const target = graph.indexByNodeId.get(toNodeId);
    if (!row || target === undefined) return Infinity;
    return row[target];
  };

  // Nearest-neighbour construction.
  const remaining = new Set(stops);
  const order: number[] = [];
  let current = startNodeId;
  while (remaining.size > 0) {
    let best: number | null = null;
    let bestCost = Infinity;
    for (const candidate of remaining) {
      const c = cost(current, candidate);
      // Deterministic tie-break on node id, for the same reason A* has one.
      if (c < bestCost || (c === bestCost && best !== null && candidate < best)) {
        bestCost = c;
        best = candidate;
      }
    }
    if (best === null) break;
    order.push(best);
    remaining.delete(best);
    current = best;
  }
  // Anything unreachable keeps its place at the end rather than vanishing.
  for (const leftover of remaining) order.push(leftover);

  const tourCost = (sequence: number[]): number => {
    let total = 0;
    let node = startNodeId;
    for (const stop of sequence) {
      total += cost(node, stop);
      node = stop;
    }
    if (options.endNodeId !== undefined) total += cost(node, options.endNodeId);
    return total;
  };

  // 2-opt: reverse any segment that shortens the tour.
  const budget = options.budgetMs ?? 250;
  const deadline = Date.now() + budget;
  let truncated = false;
  let best = tourCost(order);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        if (Date.now() > deadline) {
          truncated = true;
          break;
        }
        const candidate = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        const candidateCost = tourCost(candidate);
        if (candidateCost < best - 1) {
          order.splice(0, order.length, ...candidate);
          best = candidateCost;
          improved = true;
        }
      }
      if (truncated) break;
    }
    if (truncated) break;
  }

  return {
    order,
    totalMs: Number.isFinite(best) ? Math.round(best) : Infinity,
    truncated,
  };
}

/** Stitches a sequenced pick into one continuous route for rendering. */
export function routeThrough(
  graph: CompiledRoutingGraph,
  startNodeId: number,
  orderedNodeIds: number[],
  traveller: Traveller,
): RouteResult {
  let durationMs = 0;
  let distanceMm = 0;
  const edgeIds: number[] = [];
  const nodeIds: number[] = [startNodeId];
  const points: Point[] = [];

  const startIndex = graph.indexByNodeId.get(startNodeId);
  if (startIndex !== undefined) {
    points.push({ x: graph.nodeX[startIndex], y: graph.nodeY[startIndex] });
  }

  let current = startNodeId;
  for (const stop of orderedNodeIds) {
    const leg = findRoute(graph, current, stop, traveller);
    if (!leg.found) return { ...EMPTY_ROUTE, expanded: 0 };
    durationMs += leg.durationMs;
    distanceMm += leg.distanceMm;
    edgeIds.push(...leg.edgeIds);
    nodeIds.push(...leg.nodeIds.slice(1));
    points.push(...leg.points.slice(1));
    current = stop;
  }

  return {
    found: true,
    edgeIds,
    nodeIds,
    points,
    durationMs,
    distanceMm,
    expanded: 0,
  };
}
