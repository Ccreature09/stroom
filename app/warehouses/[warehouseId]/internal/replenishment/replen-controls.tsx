"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  assignReplenishmentTask,
  cancelReplenishmentTask,
  createReplenishmentTask,
  startReplenishmentTask,
} from "./actions";

import { DepartmentPicker, type DepartmentOption } from "../../task-routing";

export type EmployeeOption = {
  employeeId: number;
  firstName: string | null;
  lastName: string | null;
};

export type SuggestedPick = {
  locationId: number;
  locationCode: string;
  batchNumber: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
  quantity: number;
};

export type SuggestedNeed = {
  itemId: number;
  sku: string;
  itemName: string;
  pickFaceQuantity: number;
  minStockLevel: number;
  deficit: number;
  destinationLocationId: number;
  destinationLocationCode: string;
  shortfall: number;
  picks: SuggestedPick[];
};

const selectClassName =
  "rounded-lg border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function employeeLabel(e: EmployeeOption) {
  return [e.firstName, e.lastName].filter(Boolean).join(" ") || `#${e.employeeId}`;
}

export function ReplenishmentSuggestions({
  warehouseId,
  needs,
  canReplenish,
  employeeOptions,
  departmentOptions,
}: {
  warehouseId: number;
  needs: SuggestedNeed[];
  canReplenish: boolean;
  employeeOptions: EmployeeOption[];
  departmentOptions: DepartmentOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState("");
  const [departmentIds, setDepartmentIds] = useState<number[]>([]);
  const [raised, setRaised] = useState<string[]>([]);

  function raise(need: SuggestedNeed, pick: SuggestedPick) {
    const key = `${need.itemId}:${pick.locationId}:${pick.batchNumber ?? ""}:${pick.lotNumber ?? ""}`;
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("itemId", String(need.itemId));
    formData.append("sourceLocationId", String(pick.locationId));
    formData.append("destinationLocationId", String(need.destinationLocationId));
    formData.append("quantity", String(pick.quantity));
    if (pick.batchNumber) formData.append("batchNumber", pick.batchNumber);
    if (pick.lotNumber) formData.append("lotNumber", pick.lotNumber);
    if (assignee) formData.append("assignedEmployeeId", assignee);
    formData.append("departmentIds", departmentIds.join(","));

    startTransition(async () => {
      const res = await createReplenishmentTask(formData);
      if (res?.error) setError(res.error);
      else setRaised((prev) => [...prev, key]);
    });
  }

  if (needs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
        Every pick face is at or above its minimum. Nothing to replenish.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
      ) : null}

      {canReplenish ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
          {employeeOptions.length > 0 ? (
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span>Assign raised moves to:</span>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className={`${selectClassName} h-7`}
              >
                <option value="">Leave unassigned</option>
                {employeeOptions.map((e) => (
                  <option key={e.employeeId} value={e.employeeId}>
                    {employeeLabel(e)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <DepartmentPicker
            options={departmentOptions}
            value={departmentIds}
            onChange={setDepartmentIds}
            label="Route raised moves to"
          />
        </div>
      ) : null}

      {needs.map((need) => (
        <div
          key={need.itemId}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="font-mono text-sm font-bold text-slate-900">{need.sku}</span>
              <span className="ml-2 text-xs text-slate-500">{need.itemName}</span>
            </div>
            <div className="text-xs">
              <span className="font-semibold text-amber-700">
                {need.pickFaceQuantity} / {need.minStockLevel}
              </span>
              <span className="text-slate-500">
                {" "}
                at {need.destinationLocationCode} · short {need.deficit}
              </span>
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            {need.picks.map((pick) => {
              const key = `${need.itemId}:${pick.locationId}:${pick.batchNumber ?? ""}:${pick.lotNumber ?? ""}`;
              const done = raised.includes(key);
              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-mono font-semibold text-slate-800">
                      {pick.locationCode}
                    </span>
                    <span className="text-slate-500">
                      {" "}
                      → {need.destinationLocationCode} · move {pick.quantity}
                    </span>
                    {pick.batchNumber || pick.lotNumber ? (
                      <span className="ml-1 font-mono text-slate-400">
                        ({pick.batchNumber ?? "-"}
                        {pick.lotNumber ? ` / ${pick.lotNumber}` : ""}
                        {pick.expiryDate ? ` exp ${pick.expiryDate}` : ""})
                      </span>
                    ) : null}
                  </div>
                  {canReplenish ? (
                    <Button
                      size="sm"
                      variant={done ? "secondary" : "outline"}
                      disabled={done || isPending}
                      onClick={() => raise(need, pick)}
                      className="h-7 shrink-0 text-[11px]"
                    >
                      {done ? "Raised" : "Raise move"}
                    </Button>
                  ) : null}
                </div>
              );
            })}

            {need.picks.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <PackageOpen className="h-3.5 w-3.5 shrink-0" />
                No reserve stock available to top this face up.
              </div>
            ) : null}

            {need.shortfall > 0 && need.picks.length > 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Reserve covers only part of it -- still {need.shortfall} short after
                these moves.
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReplenishmentTaskActions({
  warehouseId,
  taskId,
  statusCode,
  canReplenish,
  canAssign,
  employeeOptions,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  canReplenish: boolean;
  canAssign: boolean;
  employeeOptions: EmployeeOption[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");

  function run(action: (formData: FormData) => Promise<{ error?: string }>) {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("taskId", taskId);
    startTransition(async () => {
      const res = await action(formData);
      if (res?.error) setError(res.error);
    });
  }

  function handleAssign() {
    if (!assigneeId) return;
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("taskId", taskId);
    formData.append("assignedEmployeeId", assigneeId);
    startTransition(async () => {
      const res = await assignReplenishmentTask(formData);
      if (res?.error) setError(res.error);
      else setAssignOpen(false);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {error ? <span className="text-xs font-medium text-red-600">{error}</span> : null}
      <div className="flex items-center justify-end gap-1.5">
        {canAssign && employeeOptions.length > 0 && !assignOpen ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setAssignOpen(true)}
          >
            Assign
          </Button>
        ) : null}
        {assignOpen ? (
          <>
            <select
              className={`${selectClassName} h-7 w-32`}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Select...</option>
              {employeeOptions.map((e) => (
                <option key={e.employeeId} value={e.employeeId}>
                  {employeeLabel(e)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={isPending || !assigneeId}
              onClick={handleAssign}
              className="h-7 bg-teal-700 text-xs hover:bg-teal-800"
            >
              Set
            </Button>
          </>
        ) : null}
        {statusCode === "PENDING" && canReplenish ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => run(startReplenishmentTask)}
            className="h-7 bg-teal-700 text-xs hover:bg-teal-800"
          >
            Start
          </Button>
        ) : null}
        {canAssign ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => run(cancelReplenishmentTask)}
            className="h-7 text-xs text-destructive hover:text-destructive"
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
