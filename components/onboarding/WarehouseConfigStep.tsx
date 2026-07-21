"use client";

import {
  PUTAWAY_STRATEGIES,
  type WarehouseConfigFieldErrors,
  type WarehouseConfigStepValues,
} from "@/lib/onboarding/validation";

interface WarehouseConfigStepProps {
  values: WarehouseConfigStepValues;
  errors: WarehouseConfigFieldErrors;
  onChange: (values: WarehouseConfigStepValues) => void;
}

export default function WarehouseConfigStep({
  values,
  errors,
  onChange,
}: WarehouseConfigStepProps) {
  return (
    <fieldset className="space-y-6">
      <legend className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Warehouse operating rules
      </legend>

      <div className="space-y-3">
        <CheckboxRow
          id="requireStagingBeforePutaway"
          label="Require staging before putaway"
          checked={values.requireStagingBeforePutaway}
          onChange={(checked) => onChange({ ...values, requireStagingBeforePutaway: checked })}
        />
        <CheckboxRow
          id="allowMixedSkuPerLocation"
          label="Allow mixed SKUs per location"
          checked={values.allowMixedSkuPerLocation}
          onChange={(checked) => onChange({ ...values, allowMixedSkuPerLocation: checked })}
        />
        <CheckboxRow
          id="allowMixedLpnPerLocation"
          label="Allow mixed LPNs per location"
          checked={values.allowMixedLpnPerLocation}
          onChange={(checked) => onChange({ ...values, allowMixedLpnPerLocation: checked })}
        />
      </div>

      <div>
        <label
          htmlFor="defaultPutawayStrategy"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Default putaway strategy
        </label>
        <select
          id="defaultPutawayStrategy"
          name="defaultPutawayStrategy"
          value={values.defaultPutawayStrategy}
          onChange={(event) => onChange({ ...values, defaultPutawayStrategy: event.target.value })}
          className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-zinc-900 dark:text-zinc-50 ${
            errors.defaultPutawayStrategy
              ? "border-red-500"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        >
          {PUTAWAY_STRATEGIES.map((strategy) => (
            <option key={strategy} value={strategy}>
              {strategy.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        {errors.defaultPutawayStrategy && (
          <p className="mt-1 text-sm text-red-600">{errors.defaultPutawayStrategy}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="cycleCountFrequencyDays"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Cycle count frequency (days)
        </label>
        <input
          id="cycleCountFrequencyDays"
          name="cycleCountFrequencyDays"
          type="number"
          min={1}
          step={1}
          value={values.cycleCountFrequencyDays}
          onChange={(event) =>
            onChange({ ...values, cycleCountFrequencyDays: event.target.value })
          }
          aria-invalid={Boolean(errors.cycleCountFrequencyDays)}
          placeholder="Optional — e.g. 30"
          className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-zinc-900 dark:text-zinc-50 ${
            errors.cycleCountFrequencyDays
              ? "border-red-500"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        />
        {errors.cycleCountFrequencyDays && (
          <p className="mt-1 text-sm text-red-600">{errors.cycleCountFrequencyDays}</p>
        )}
      </div>
    </fieldset>
  );
}

function CheckboxRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        name={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
      />
      <label htmlFor={id} className="text-sm text-zinc-700 dark:text-zinc-300">
        {label}
      </label>
    </div>
  );
}
