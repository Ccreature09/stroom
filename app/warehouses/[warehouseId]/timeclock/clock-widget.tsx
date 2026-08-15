"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { elapsedMinutes, formatDuration } from "@/lib/timeclock/shift";
import { clockIn, clockOut } from "./actions";

/**
 * The first and last thing a worker touches in a shift, so it sits at the
 * top of My Tasks rather than behind a menu.
 *
 * The running total ticks locally off the clock-in time rather than being
 * re-fetched -- a number that only moves when the page happens to re-render
 * looks broken, and the arithmetic is the same either way.
 */
export function ClockWidget({
  warehouseId,
  openShift,
}: {
  warehouseId: number;
  openShift: { clockInAt: string; breakMinutes: number | null } | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingOut, setConfirmingOut] = useState(false);
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!openShift) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [openShift]);

  function run(action: (fd: FormData) => Promise<{ error?: string }>, extra?: Record<string, string>) {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    for (const [k, v] of Object.entries(extra ?? {})) formData.append(k, v);
    startTransition(async () => {
      const res = await action(formData);
      if (res?.error) setError(res.error);
      else {
        setConfirmingOut(false);
        setBreakMinutes("0");
        router.refresh();
      }
    });
  }

  if (!openShift) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(clockIn)}
          className="flex w-full items-center gap-3 rounded-2xl border-2 border-slate-300 bg-white px-5 py-4 text-slate-800 shadow-sm transition hover:border-teal-500 hover:bg-teal-50 disabled:opacity-60"
        >
          <LogIn className="h-6 w-6 shrink-0 text-teal-700" />
          <div className="text-left">
            <div className="text-base font-bold">
              {isPending ? "Clocking in…" : "Clock In"}
            </div>
            <div className="text-sm text-slate-500">You&apos;re not on shift</div>
          </div>
        </button>
        {error ? <ErrorNote text={error} /> : null}
      </div>
    );
  }

  const elapsed = elapsedMinutes(openShift, now);
  const startedAt = openShift.clockInAt.slice(11, 16);

  if (confirmingOut) {
    return (
      <div className="space-y-3 rounded-2xl border-2 border-teal-600 bg-teal-50 p-5">
        <div className="flex items-center gap-2 text-teal-900">
          <Clock className="h-5 w-5" />
          <span className="font-bold">On shift since {startedAt}</span>
        </div>
        <div className="space-y-1">
          <Label htmlFor="break-minutes" className="text-sm">
            Break taken (minutes)
          </Label>
          <Input
            id="break-minutes"
            type="number"
            min={0}
            autoFocus
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
            className="h-14 bg-white text-lg"
          />
        </div>
        {error ? <ErrorNote text={error} /> : null}
        <div className="flex gap-2">
          <Button
            size="lg"
            variant="outline"
            onClick={() => setConfirmingOut(false)}
            className="h-14 flex-1 bg-white text-base"
          >
            Back
          </Button>
          <Button
            size="lg"
            disabled={isPending}
            onClick={() => run(clockOut, { breakMinutes: String(Number(breakMinutes) || 0) })}
            className="h-14 flex-1 bg-teal-700 text-base hover:bg-teal-800"
          >
            {isPending ? "Clocking out…" : "Clock Out"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-teal-600 bg-teal-50 px-5 py-4">
        <div className="flex items-center gap-3">
          <Clock className="h-6 w-6 shrink-0 text-teal-700" />
          <div>
            <div className="text-base font-bold text-teal-900">
              On shift · {formatDuration(elapsed)}
            </div>
            <div className="text-sm text-teal-800">Since {startedAt}</div>
          </div>
        </div>
        <Button
          size="lg"
          onClick={() => setConfirmingOut(true)}
          className="h-12 shrink-0 bg-teal-700 text-base hover:bg-teal-800"
        >
          <LogOut className="mr-2 h-4 w-4" /> Clock Out
        </Button>
      </div>
      {error ? <ErrorNote text={error} /> : null}
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{text}</p>
  );
}
