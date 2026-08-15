"use client";

import { useState, useTransition } from "react";
import { Check, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { updateTaskDepartments } from "./task-routing-actions";

export type DepartmentOption = { departmentId: number; departmentName: string };

/**
 * Department picker used both at task-creation time (uncontrolled, writes a
 * comma-separated hidden field the create actions parse) and on an existing
 * task (controlled, saves immediately).
 */
export function DepartmentPicker({
  name = "departmentIds",
  options,
  value,
  onChange,
  label = "Route to departments",
  hint = "Leave empty to make it available to anyone with the right permission.",
}: {
  name?: string;
  options: DepartmentOption[];
  value: number[];
  onChange: (next: number[]) => void;
  label?: string;
  hint?: string;
}) {
  if (options.length === 0) return null;

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((d) => {
          const on = value.includes(d.departmentId);
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
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
      {/* The create actions read this one field rather than repeated
          checkbox entries -- see parseDepartmentIds. */}
      <input type="hidden" name={name} value={value.join(",")} />
    </div>
  );
}

/** Read-only chips plus an inline editor, for manager task queues. */
export function TaskRouting({
  warehouseId,
  taskId,
  departments,
  options,
  canEdit,
}: {
  warehouseId: number;
  taskId: string;
  departments: DepartmentOption[];
  options: DepartmentOption[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>(
    departments.map((d) => d.departmentId),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("taskId", taskId);
    formData.append("departmentIds", selected.join(","));
    startTransition(async () => {
      const res = await updateTaskDepartments(formData);
      if (res?.error) setError(res.error);
      else setOpen(false);
    });
  }

  const chips =
    departments.length === 0 ? (
      <span className="text-[11px] text-slate-400">Anyone</span>
    ) : (
      <span className="flex flex-wrap gap-1">
        {departments.map((d) => (
          <span
            key={d.departmentId}
            className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
          >
            {d.departmentName}
          </span>
        ))}
      </span>
    );

  if (!canEdit || options.length === 0) return chips;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-slate-100"
          title="Change routing"
        >
          {chips}
          <Users className="h-3 w-3 shrink-0 text-slate-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3">
        <DepartmentPicker
          options={options}
          value={selected}
          onChange={setSelected}
          label="Route to"
          hint="Empty = anyone with the permission."
        />
        {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelected(departments.map((d) => d.departmentId));
              setOpen(false);
            }}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={isPending}
            onClick={save}
            className="flex-1 bg-teal-700 hover:bg-teal-800"
          >
            {isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
