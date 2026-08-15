"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adjustEntry } from "./actions";

/** The stored value is a naive "YYYY-MM-DD HH:mm:ss"; the input wants
 *  "YYYY-MM-DDTHH:mm". No timezone conversion in either direction, which is
 *  the point -- shifting these through a browser timezone would move
 *  everyone's recorded hours. */
function toInputValue(ts: string | null): string {
  if (!ts) return "";
  return ts.replace(" ", "T").slice(0, 16);
}

export function EditEntryButton({
  warehouseId,
  entry,
}: {
  warehouseId: number;
  entry: {
    timeClockId: number;
    clockInAt: string;
    clockOutAt: string | null;
    breakMinutes: number;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));
    formData.append("timeClockId", String(entry.timeClockId));

    startTransition(async () => {
      const res = await adjustEntry(formData);
      if (res?.error) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-7 text-xs"
      >
        <Pencil className="mr-1 h-3 w-3" /> Edit
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Correct Timesheet Entry</DialogTitle>
              <DialogDescription>
                This records you as the editor, so a corrected entry is never
                mistaken for what was originally clocked.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor={`in-${entry.timeClockId}`}>
                  Clock in <span className="text-destructive">*</span>
                </Label>
                <Input
                  id={`in-${entry.timeClockId}`}
                  name="clockInAt"
                  type="datetime-local"
                  required
                  defaultValue={toInputValue(entry.clockInAt)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`out-${entry.timeClockId}`}>Clock out</Label>
                <Input
                  id={`out-${entry.timeClockId}`}
                  name="clockOutAt"
                  type="datetime-local"
                  defaultValue={toInputValue(entry.clockOutAt)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Leave empty to leave the shift open.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`brk-${entry.timeClockId}`}>Break (minutes)</Label>
                <Input
                  id={`brk-${entry.timeClockId}`}
                  name="breakMinutes"
                  type="number"
                  min={0}
                  defaultValue={entry.breakMinutes}
                />
              </div>

              {error ? (
                <p className="text-sm font-medium text-red-600">{error}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                className="bg-teal-700 hover:bg-teal-800"
              >
                {isPending ? "Saving..." : "Save Correction"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
