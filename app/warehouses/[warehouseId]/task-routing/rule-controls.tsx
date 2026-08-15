"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DepartmentOption } from "../task-routing";
import { setRoutingRule } from "./actions";

export function RoutingRuleRow({
  warehouseId,
  typeCode,
  typeLabel,
  options,
  initial,
}: {
  warehouseId: number;
  typeCode: string;
  typeLabel: string;
  options: DepartmentOption[];
  initial: number[];
}) {
  const [selected, setSelected] = useState<number[]>(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty =
    selected.length !== initial.length ||
    selected.some((id) => !initial.includes(id));

  function toggle(id: number) {
    setSaved(false);
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  }

  function save() {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("typeCode", typeCode);
    formData.append("departmentIds", selected.join(","));
    startTransition(async () => {
      const res = await setRoutingRule(formData);
      if (res?.error) setError(res.error);
      else setSaved(true);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="w-44 shrink-0">
        <div className="text-sm font-bold text-slate-900">{typeLabel}</div>
        <div className="font-mono text-[10px] text-slate-400">{typeCode}</div>
      </div>

      <div className="flex flex-1 flex-wrap gap-1.5">
        {options.map((d) => {
          const on = selected.includes(d.departmentId);
          return (
            <button
              key={d.departmentId}
              type="button"
              onClick={() => toggle(d.departmentId)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                on
                  ? "border-teal-600 bg-teal-50 text-teal-800"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {on ? <Check className="h-3 w-3" /> : null}
              {d.departmentName}
            </button>
          );
        })}
        {selected.length === 0 ? (
          <span className="self-center text-[11px] text-slate-400">
            Anyone with the permission
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {error ? <span className="text-xs font-medium text-red-600">{error}</span> : null}
        {saved && !dirty ? (
          <span className="text-xs font-medium text-emerald-700">Saved</span>
        ) : null}
        <Button
          size="sm"
          disabled={isPending || !dirty}
          onClick={save}
          className="bg-teal-700 hover:bg-teal-800"
        >
          {isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
