"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BlockageDTO } from "@/lib/warehouse-map/types";
import type { Point } from "@/lib/warehouse-map/geometry";
import { clearBlockage, reportBlockage } from "./live-actions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Ban, Trash2 } from "lucide-react";

const REASONS = [
  { value: "SPILL", label: "Spill" },
  { value: "DROPPED_LOAD", label: "Dropped load" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "EQUIPMENT_FAILURE", label: "Equipment failure" },
  { value: "CONGESTION", label: "Congestion" },
  { value: "SAFETY", label: "Safety" },
  { value: "OTHER", label: "Other" },
];

export default function BlockagePanel({
  warehouseId,
  hallId,
  blockages,
  pickedPoint,
  isPicking,
  onStartPicking,
  onCancel,
  canReport,
}: {
  warehouseId: number;
  hallId: number;
  blockages: BlockageDTO[];
  pickedPoint: Point | null;
  isPicking: boolean;
  onStartPicking: () => void;
  onCancel: () => void;
  canReport: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [reason, setReason] = useState("SPILL");
  const [radiusM, setRadiusM] = useState("2");
  const [expiryMin, setExpiryMin] = useState("");

  function handleReport() {
    if (!pickedPoint) return;
    const radiusMm = Math.round(Number(radiusM) * 1000);
    if (!Number.isFinite(radiusMm) || radiusMm <= 0) {
      setError("Radius must be a positive number of metres.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const outcome = await reportBlockage(warehouseId, hallId, {
        xMm: pickedPoint.x,
        yMm: pickedPoint.y,
        radiusMm,
        reason,
        expiresInMinutes: expiryMin ? Number(expiryMin) : undefined,
      });
      if (outcome.error) {
        setError(outcome.error);
        return;
      }
      const affected = outcome.invalidatedRoutePlanIds?.length ?? 0;
      // The count that matters operationally is not how many segments were
      // blocked but how many people are currently routed through them.
      setResult(
        `${outcome.blockedEdgeIds?.length ?? 0} segment(s) blocked. ${
          affected > 0
            ? `${affected} in-flight route${affected === 1 ? "" : "s"} need recomputing.`
            : "Nothing in flight was routed through it."
        }`,
      );
      onCancel();
      router.refresh();
    });
  }

  function handleClear(blockageId: number) {
    startTransition(async () => {
      const outcome = await clearBlockage(warehouseId, blockageId);
      if (outcome.error) setError(outcome.error);
      else {
        setResult(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Blockages ({blockages.length})
      </Label>

      {canReport && (
        <>
          {!pickedPoint ? (
            <Button
              variant={isPicking ? "default" : "outline"}
              size="sm"
              disabled={isPending}
              onClick={isPicking ? onCancel : onStartPicking}
              className="w-full justify-start text-xs"
            >
              <Ban className="mr-1.5 h-3.5 w-3.5" />
              {isPicking ? "Cancel" : "Report a blockage"}
            </Button>
          ) : (
            <div className="space-y-1.5 rounded-md border bg-muted/40 p-2">
              <p className="text-[11px] text-muted-foreground">
                At ({Math.round(pickedPoint.x)}, {Math.round(pickedPoint.y)}).
              </p>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-1.5">
                <Input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={radiusM}
                  onChange={(e) => setRadiusM(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Radius m"
                />
                <Input
                  type="number"
                  min={1}
                  value={expiryMin}
                  onChange={(e) => setExpiryMin(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Expires min"
                />
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={handleReport}
                  className="h-8 flex-1 text-xs"
                >
                  Block
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={onCancel}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {blockages.length === 0 ? (
        <p className="px-1 text-[11px] text-muted-foreground">
          Nothing blocked.
        </p>
      ) : (
        blockages.map((blockage) => (
          <div
            key={blockage.blockageId}
            className="flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px]"
          >
            <div className="min-w-0">
              <p className="font-medium text-destructive">
                {REASONS.find((r) => r.value === blockage.reason)?.label ??
                  blockage.reason}
              </p>
              <p className="text-muted-foreground">
                {blockage.edgeIds.length} segment
                {blockage.edgeIds.length === 1 ? "" : "s"}
                {blockage.expiresAt
                  ? ` · expires ${new Date(blockage.expiresAt).toLocaleTimeString()}`
                  : ""}
              </p>
            </div>
            {canReport && (
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => handleClear(blockage.blockageId)}
                className="h-6 shrink-0 px-1.5"
                title="Clear"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))
      )}

      {result && (
        <p className="px-1 text-[11px] leading-snug text-muted-foreground">
          {result}
        </p>
      )}
      {error && (
        <Alert variant="destructive" className="py-2 text-xs">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
