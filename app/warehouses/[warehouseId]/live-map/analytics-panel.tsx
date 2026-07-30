"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BottleneckDTO } from "./traffic-actions";
import { runTrafficRollup } from "./traffic-actions";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Flame, RefreshCw } from "lucide-react";

/**
 * Traffic analysis: the rollup trigger, the bottleneck list, and the heatmap
 * toggle. This is read/aggregate-only -- unlike the blockage panel, nothing
 * here directs anyone, so it needs no extra permission beyond viewing the
 * live map at all.
 */
export default function AnalyticsPanel({
  warehouseId,
  hallId,
  bottlenecks,
  showHeatmap,
  onToggleHeatmap,
  onRefreshed,
}: {
  warehouseId: number;
  hallId: number;
  bottlenecks: BottleneckDTO[];
  showHeatmap: boolean;
  onToggleHeatmap: (next: boolean) => void;
  onRefreshed: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);

  function handleRollup() {
    setError(null);
    startTransition(async () => {
      const result = await runTrafficRollup(warehouseId, hallId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setLastRun(
        `${result.traversalsWritten} traversal(s), ${result.bucketsUpdated} bucket(s) updated.`,
      );
      onRefreshed();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Traffic Analysis
      </Label>

      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={handleRollup}
        className="w-full justify-start text-xs"
      >
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        {isPending ? "Analysing…" : "Refresh traffic analysis"}
      </Button>
      {lastRun && (
        <p className="px-1 text-[11px] text-muted-foreground">{lastRun}</p>
      )}

      <div className="flex items-center space-x-2">
        <Checkbox
          id="show-heatmap"
          checked={showHeatmap}
          onCheckedChange={(checked) => onToggleHeatmap(checked === true)}
        />
        <Label
          htmlFor="show-heatmap"
          className="flex cursor-pointer items-center gap-1 text-xs font-medium leading-none"
        >
          <Flame className="h-3.5 w-3.5 text-amber-600" />
          Traffic density heatmap
        </Label>
      </div>

      <div className="space-y-1.5 border-t pt-2">
        <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Bottlenecks ({bottlenecks.length})
        </Label>
        {bottlenecks.length === 0 ? (
          <p className="px-1 text-[11px] leading-snug text-muted-foreground">
            None flagged. A bottleneck is an edge whose slow trips take much
            longer than its typical trip -- high variance, not just high
            traffic.
          </p>
        ) : (
          bottlenecks.map((b) => (
            <div
              key={b.edgeId}
              className="flex items-start gap-1.5 rounded-md border border-purple-300 bg-purple-50 p-2 text-[11px] leading-relaxed text-purple-900"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Edge #{b.edgeId}: p95 is {b.ratio.toFixed(1)}x the typical
                trip over {b.traversalCount} traversals ({(b.p50DurationMs / 1000).toFixed(0)}s
                typical vs {(b.p95DurationMs / 1000).toFixed(0)}s slow).
              </span>
            </div>
          ))
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="py-2 text-xs">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
