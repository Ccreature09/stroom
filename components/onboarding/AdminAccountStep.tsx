"use client";

import type { AdminAccountFieldErrors, AdminAccountStepValues } from "@/lib/onboarding/validation";

interface AdminAccountStepProps {
  values: AdminAccountStepValues;
  errors: AdminAccountFieldErrors;
  onChange: (values: AdminAccountStepValues) => void;
}

const FIELDS: {
  key: keyof AdminAccountStepValues;
  label: string;
  type: "email" | "password" | "text";
  maxLength?: number;
  autoComplete: string;
  wide?: boolean;
}[] = [
  { key: "firstName", label: "First name", type: "text", maxLength: 50, autoComplete: "given-name" },
  { key: "lastName", label: "Last name", type: "text", maxLength: 50, autoComplete: "family-name" },
  { key: "email", label: "Work email", type: "email", maxLength: 150, autoComplete: "email", wide: true },
  { key: "password", label: "Password", type: "password", autoComplete: "new-password" },
  { key: "confirmPassword", label: "Confirm password", type: "password", autoComplete: "new-password" },
];

export default function AdminAccountStep({ values, errors, onChange }: AdminAccountStepProps) {
  return (
    <fieldset className="space-y-6">
      <div>
        <legend className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Administrator account
        </legend>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          This person will be the first administrator for the organization.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map(({ key, label, type, maxLength, autoComplete, wide }) => {
          const errorKey = `admin${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof AdminAccountFieldErrors;
          const error = errors[errorKey];
          const inputId = errorKey;

          return (
            <div key={key} className={wide ? "sm:col-span-2" : ""}>
              <label htmlFor={inputId} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {label} {(key === "email" || key === "password" || key === "confirmPassword") && <span className="text-red-500">*</span>}
              </label>
              <input
                id={inputId}
                name={inputId}
                type={type}
                maxLength={maxLength}
                required={key === "email" || key === "password" || key === "confirmPassword"}
                autoComplete={autoComplete}
                value={values[key]}
                onChange={(event) => onChange({ ...values, [key]: event.target.value })}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${inputId}-error` : undefined}
                className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-zinc-900 dark:text-zinc-50 ${
                  error ? "border-red-500" : "border-zinc-300 dark:border-zinc-700"
                }`}
              />
              {error && <p id={`${inputId}-error`} className="mt-1 text-sm text-red-600">{error}</p>}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
