"use client";

import type { WarehouseFieldErrors, WarehouseStepValues } from "@/lib/onboarding/validation";

interface WarehouseStepProps {
  values: WarehouseStepValues;
  errors: WarehouseFieldErrors;
  onChange: (values: WarehouseStepValues) => void;
}

const FIELDS: {
  key: keyof Omit<WarehouseStepValues, "isActive">;
  formName: string;
  errorKey: keyof WarehouseFieldErrors;
  label: string;
  maxLength: number;
  wide?: boolean;
}[] = [
  { key: "name", formName: "warehouseName", errorKey: "warehouseName", label: "Warehouse name", maxLength: 100, wide: true },
  { key: "street", formName: "street", errorKey: "street", label: "Street", maxLength: 100, wide: true },
  { key: "city", formName: "city", errorKey: "city", label: "City", maxLength: 50 },
  { key: "postalCode", formName: "postalCode", errorKey: "postalCode", label: "Postal code", maxLength: 20 },
  { key: "country", formName: "country", errorKey: "country", label: "Country", maxLength: 50 },
  { key: "timezone", formName: "timezone", errorKey: "timezone", label: "Timezone", maxLength: 50 },
];

export default function WarehouseStep({ values, errors, onChange }: WarehouseStepProps) {
  return (
    <fieldset className="space-y-6">
      <legend className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Warehouse details
      </legend>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map(({ key, formName, errorKey, label, maxLength, wide }) => {
          const error = errors[errorKey];
          return (
            <div key={key} className={wide ? "sm:col-span-2" : ""}>
              <label
                htmlFor={formName}
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                {label}
              </label>
              <input
                id={formName}
                name={formName}
                type="text"
                maxLength={maxLength}
                value={values[key]}
                onChange={(event) => onChange({ ...values, [key]: event.target.value })}
                aria-invalid={Boolean(error)}
                className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-zinc-900 dark:text-zinc-50 ${
                  error ? "border-red-500" : "border-zinc-300 dark:border-zinc-700"
                }`}
              />
              {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <input
          id="warehouseIsActive"
          name="warehouseIsActive"
          type="checkbox"
          checked={values.isActive}
          onChange={(event) => onChange({ ...values, isActive: event.target.checked })}
          className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label htmlFor="warehouseIsActive" className="text-sm text-zinc-700 dark:text-zinc-300">
          Warehouse is active
        </label>
      </div>
    </fieldset>
  );
}
