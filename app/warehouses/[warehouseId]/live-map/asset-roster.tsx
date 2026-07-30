"use client";

import { useEffect, useState } from "react";
import {
  CONFIDENCE_STALE,
  confidenceAt,
  type LiveAsset,
} from "@/lib/warehouse-map/live-map";

import { Label } from "@/components/ui/label";
import { Forklift, User } from "lucide-react";

function formatAge(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

const STATUS_LABEL: Record<string, string> = {
  IDLE: "Idle",
  TRAVELLING: "Travelling",
  PICKING: "Picking",
  PUTAWAY: "Putaway",
  CHARGING: "Charging",
  BREAK: "Break",
  OFFLINE: "Offline",
};

/**
 * Who is on the floor, and how much we actually know about where.
 *
 * The age column is the honest part: a position derived from a scan five
 * minutes ago is still the last thing we know, and the roster says so rather
 * than presenting it as current.
 */
export default function AssetRoster({ assets }: { assets: LiveAsset[] }) {
  // Ages advance with the clock, not with incoming messages, so the list has
  // to re-render on its own or a silent asset would look permanently fresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);

  const sorted = [...assets].sort((a, b) => b.fixedAt - a.fixedAt);

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        On the floor ({assets.length})
      </Label>

      {sorted.length === 0 ? (
        <p className="px-1 text-[11px] leading-snug text-muted-foreground">
          No tracked activity. Positions appear here as scans, telemetry, or
          task events arrive.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {sorted.map((asset) => {
            const ageMs = Math.max(0, now - asset.fixedAt);
            const confidence = confidenceAt(ageMs, asset.source);
            const isStale = confidence < CONFIDENCE_STALE;
            return (
              <div
                key={`${asset.assetKind}:${asset.assetRefId}`}
                className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-[11px]"
              >
                {asset.assetKind === "MHE" ? (
                  <Forklift className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                ) : (
                  <User className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">
                    {asset.label}
                  </p>
                  <p className="text-muted-foreground">
                    {STATUS_LABEL[asset.status] ?? asset.status} ·{" "}
                    {formatAge(ageMs)}
                  </p>
                </div>
                <span
                  className={
                    isStale
                      ? "shrink-0 text-muted-foreground"
                      : "shrink-0 text-emerald-600"
                  }
                  title={`${Math.round(confidence * 100)}% confidence, source ${asset.source}`}
                >
                  {Math.round(confidence * 100)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
