"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { HallDTO, NavGraphDTO } from "./types";
import { compileHallGraph, type CompileGraphResult } from "./graph-actions";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Route, Waypoints } from "lucide-react";

// Ordered worst-first: an unreachable pick face is a production incident
// waiting to happen, a narrow aisle is a purchasing mistake, and a lane
// through a column is usually a real column that needs designing around.
const WARNING_TONE: Record<string, "error" | "warn"> = {
  UNREACHABLE_LOCATIONS: "error",
  LOCATION_WITHOUT_ACCESS: "error",
  DISCONNECTED_GRAPH: "error",
  NO_CORRIDORS: "error",
  AISLE_TOO_NARROW: "warn",
  LANE_CROSSES_OBSTACLE: "warn",
  PORTAL_UNLINKED: "warn",
  NO_RACKING: "warn",
};

export default function NavGraphPanel({
  warehouseId,
  hall,
  navGraph,
  showNavGraph,
  onToggleShow,
  locked,
}: {
  warehouseId: number;
  hall: HallDTO;
  navGraph: NavGraphDTO;
  showNavGraph: boolean;
  onToggleShow: (next: boolean) => void;
  locked: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CompileGraphResult | null>(null);

  const hasGraph = navGraph.nodes.length > 0;

  function handleCompile() {
    setResult(null);
    startTransition(async () => {
      const next = await compileHallGraph(warehouseId, hall.hallId, 1);
      setResult(next);
      if (next.success) router.refresh();
    });
  }

  const warnings = result?.warnings ?? [];
  const busy = locked || isPending;

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Navigation Graph
      </Label>

      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={handleCompile}
        className="w-full justify-start text-xs"
      >
        <Route className="mr-1.5 h-3.5 w-3.5" />
        {isPending
          ? "Compiling…"
          : hasGraph
            ? "Recompile graph"
            : "Compile graph"}
      </Button>

      {hasGraph && (
        <>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="show-nav-graph"
              checked={showNavGraph}
              onCheckedChange={(checked) => onToggleShow(checked === true)}
            />
            <Label
              htmlFor="show-nav-graph"
              className="cursor-pointer text-xs font-medium leading-none"
            >
              Show on canvas
            </Label>
          </div>

          <div className="rounded-md border bg-card p-2 text-[11px] leading-relaxed text-muted-foreground">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Waypoints className="h-3.5 w-3.5" />
              {navGraph.nodes.length} nodes · {navGraph.edges.length} edges
            </div>
            <p className="mt-1">
              {navGraph.accessPointCount} pick faces linked to the network
              {navGraph.layoutVersion != null &&
                ` · compiled from layout v${navGraph.layoutVersion}`}
              .
            </p>
          </div>
        </>
      )}

      {result?.error && (
        <Alert variant="destructive" className="py-2 text-xs">
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      )}

      {result?.success && (
        <div className="space-y-1.5">
          {warnings.length === 0 ? (
            <div className="flex items-start gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-[11px] leading-relaxed text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Compiled cleanly. {result.stats?.rackRuns} rack run(s),{" "}
                {result.stats?.inferredCorridors} inferred aisle(s),{" "}
                {result.stats?.connectors} cross-aisle(s). All{" "}
                {result.stats?.reachableLocationCount} locations reachable.
              </span>
            </div>
          ) : (
            warnings.map((warning, index) => {
              const tone = WARNING_TONE[warning.code] ?? "warn";
              return (
                <div
                  key={`${warning.code}-${index}`}
                  className={
                    tone === "error"
                      ? "flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] leading-relaxed text-destructive"
                      : "flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-900"
                  }
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{warning.message}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      {!hasGraph && !result && (
        <p className="px-1 text-[11px] leading-snug text-muted-foreground">
          Infers aisles from the racking you have already drawn, links every
          pick face to them, and reports anything unreachable.
        </p>
      )}
    </div>
  );
}
