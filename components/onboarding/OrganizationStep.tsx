"use client";

import type { OrganizationFieldErrors, OrganizationStepValues } from "@/lib/onboarding/validation";

interface OrganizationStepProps {
  values: OrganizationStepValues;
  errors: OrganizationFieldErrors;
  onChange: (values: OrganizationStepValues) => void;
}

export default function OrganizationStep({ values, errors, onChange }: OrganizationStepProps) {
  return (
    <fieldset className="space-y-6">
      <legend className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Organization details
      </legend>

      <div>
        <label
          htmlFor="organizationName"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Organization name <span className="text-red-500">*</span>
        </label>
        <input
          id="organizationName"
          name="organizationName"
          type="text"
          required
          maxLength={100}
          value={values.name}
          onChange={(event) => onChange({ ...values, name: event.target.value })}
          aria-invalid={Boolean(errors.organizationName)}
          aria-describedby={errors.organizationName ? "organizationName-error" : undefined}
          placeholder="Acme Logistics"
          className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-zinc-900 dark:text-zinc-50 ${
            errors.organizationName
              ? "border-red-500"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        />
        {errors.organizationName && (
          <p id="organizationName-error" className="mt-1 text-sm text-red-600">
            {errors.organizationName}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          id="organizationIsActive"
          name="organizationIsActive"
          type="checkbox"
          checked={values.isActive}
          onChange={(event) => onChange({ ...values, isActive: event.target.checked })}
          className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label htmlFor="organizationIsActive" className="text-sm text-zinc-700 dark:text-zinc-300">
          Organization is active
        </label>
      </div>
    </fieldset>
  );
}
