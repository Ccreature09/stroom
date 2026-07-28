"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Draft-committing field primitives -- local input state mirrors the current
// (merged draft) value and resyncs whenever that value changes from outside
// the field (a canvas drag, undo/redo, switching selection); edits commit
// into the draft store on blur rather than firing a network request. This is
// the "adjust state during render" pattern React recommends for resetting
// controlled-input state from a prop, not a useEffect.

export function DraftTextField({
  id,
  label,
  value,
  onCommit,
  required = false,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onCommit: (value: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const [input, setInput] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setInput(value);
  }

  function commit() {
    const trimmed = input.trim();
    if (trimmed === value) return;
    if (required && !trimmed) return;
    onCommit(trimmed);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={input}
        placeholder={placeholder}
        onChange={(e) => setInput(e.target.value)}
        onBlur={commit}
      />
    </div>
  );
}

export function DraftNumberField({
  id,
  label,
  value,
  onCommit,
  nullable = false,
  min,
  max,
}: {
  id: string;
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  nullable?: boolean;
  min?: number;
  max?: number;
}) {
  const [input, setInput] = useState(value === null ? "" : String(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setInput(value === null ? "" : String(value));
  }

  function commit() {
    if (input.trim() === "") {
      if (nullable && value !== null) onCommit(null);
      return;
    }
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return;
    const rounded = Math.round(parsed);
    if (rounded === value) return;
    onCommit(rounded);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onBlur={commit}
      />
    </div>
  );
}
