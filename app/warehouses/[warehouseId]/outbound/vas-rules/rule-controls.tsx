"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createVasRule,
  deleteVasRule,
  setVasEnabled,
  setVasRuleActive,
} from "./actions";

export type CustomerOption = { customerId: number; name: string };
export type ItemOption = { itemId: number; sku: string; name: string };

const selectClassName =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function VasEnableToggle({
  warehouseId,
  isEnabled,
  autoCreate,
  canEdit,
}: {
  warehouseId: number;
  isEnabled: boolean;
  autoCreate: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(isEnabled);
  const [auto, setAuto] = useState(autoCreate);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty = enabled !== isEnabled || auto !== autoCreate;

  function save() {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("isEnabled", String(enabled));
    formData.append("autoCreate", String(auto));
    startTransition(async () => {
      const res = await setVasEnabled(formData);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Power
          className={`h-4 w-4 ${enabled ? "text-teal-700" : "text-slate-400"}`}
        />
        <span className="text-sm font-bold text-slate-900">
          {enabled ? "Value-added services are on" : "Value-added services are off"}
        </span>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <Checkbox
            checked={enabled}
            disabled={!canEdit}
            onCheckedChange={(c) => setEnabled(c === true)}
            className="mt-0.5"
          />
          <span>
            Use VAS in this warehouse
            <span className="block text-xs text-slate-500">
              Off means orders go straight from picked to shipped -- the right
              setting if you only send full pallets.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <Checkbox
            checked={auto}
            disabled={!canEdit || !enabled}
            onCheckedChange={(c) => setAuto(c === true)}
            className="mt-0.5"
          />
          <span>
            Raise tasks automatically
            <span className="block text-xs text-slate-500">
              When an order finishes picking, create its VAS task from whatever
              standing rules match. Leave off to raise them by hand only.
            </span>
          </span>
        </label>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {canEdit ? (
        <Button
          size="sm"
          disabled={isPending || !dirty}
          onClick={save}
          className="bg-teal-700 hover:bg-teal-800"
        >
          {isPending ? "Saving..." : "Save"}
        </Button>
      ) : null}
    </div>
  );
}

export function CreateVasRuleDialog({
  warehouseId,
  customerOptions,
  itemOptions,
  disabled,
}: {
  warehouseId: number;
  customerOptions: CustomerOption[];
  itemOptions: ItemOption[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [appliesTo, setAppliesTo] = useState("ALL");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await createVasRule(formData);
      if (res?.success) {
        setOpen(false);
        setAppliesTo("ALL");
        router.refresh();
      } else {
        setError(res?.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800" disabled={disabled}>
          <Plus className="mr-2 h-4 w-4" /> New Rule
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New VAS Rule</DialogTitle>
            <DialogDescription>
              Which orders need value-added work, and what the worker is asked
              to do. Instructions are yours to word — the system just makes
              sure each one gets ticked off.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rule-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="rule-name"
                name="name"
                required
                placeholder="e.g. Retail pack"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rule-desc">Description</Label>
              <Input id="rule-desc" name="description" placeholder="Optional note" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rule-scope">Applies to</Label>
              <select
                id="rule-scope"
                name="appliesTo"
                value={appliesTo}
                onChange={(e) => setAppliesTo(e.target.value)}
                className={selectClassName}
              >
                <option value="ALL">Every order</option>
                <option value="CUSTOMER">A specific customer</option>
                <option value="ITEM">Orders containing an item</option>
              </select>
            </div>

            {appliesTo === "CUSTOMER" ? (
              <div className="space-y-2">
                <Label htmlFor="rule-customer">
                  Customer <span className="text-destructive">*</span>
                </Label>
                <select id="rule-customer" name="customerId" className={selectClassName}>
                  <option value="">Select a customer...</option>
                  {customerOptions.map((c) => (
                    <option key={c.customerId} value={c.customerId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {appliesTo === "ITEM" ? (
              <div className="space-y-2">
                <Label htmlFor="rule-item">
                  Item <span className="text-destructive">*</span>
                </Label>
                <select id="rule-item" name="itemId" className={selectClassName}>
                  <option value="">Select an item...</option>
                  {itemOptions.map((i) => (
                    <option key={i.itemId} value={i.itemId}>
                      {i.sku} — {i.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="rule-steps">
                Instructions <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="rule-steps"
                name="instructions"
                rows={5}
                required
                placeholder={"Apply company logo to the short face\nUse a yellow outer box\nInclude the returns slip"}
              />
              <p className="text-[11px] text-muted-foreground">
                One per line. Each becomes a checkbox the worker ticks off.
              </p>
            </div>

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
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
              {isPending ? "Creating..." : "Create Rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VasRuleActions({
  warehouseId,
  ruleId,
  isActive,
}: {
  warehouseId: number;
  ruleId: number;
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: (fd: FormData) => Promise<{ error?: string }>, extra?: Record<string, string>) {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("ruleId", String(ruleId));
    for (const [k, v] of Object.entries(extra ?? {})) formData.append(k, v);
    startTransition(async () => {
      const res = await action(formData);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {error ? <span className="text-xs font-medium text-red-600">{error}</span> : null}
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => run(setVasRuleActive, { isActive: String(!isActive) })}
        className="h-7 text-xs"
      >
        {isActive ? "Deactivate" : "Activate"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={isPending}
        onClick={() => run(deleteVasRule)}
        className="h-7 text-xs text-destructive hover:text-destructive"
      >
        Delete
      </Button>
    </div>
  );
}
