"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createOnboardingSubmission } from "@/app/onboarding/actions";
import { initialOnboardingState } from "@/lib/onboarding/state";
import {
  hasErrors,
  ADMIN_ACCOUNT_ERROR_KEYS,
  ORGANIZATION_ERROR_KEYS,
  WAREHOUSE_CONFIG_ERROR_KEYS,
  WAREHOUSE_ERROR_KEYS,
  validateOrganizationStep,
  validateAdminAccountStep,
  validateWarehouseConfigStep,
  validateWarehouseStep,
  type AdminAccountFieldErrors,
  type AdminAccountStepValues,
  type OrganizationFieldErrors,
  type OrganizationStepValues,
  type WarehouseConfigFieldErrors,
  type WarehouseConfigStepValues,
  type WarehouseFieldErrors,
  type WarehouseStepValues,
} from "@/lib/onboarding/validation";
import Stepper from "./Stepper";
import OrganizationStep from "./OrganizationStep";
import WarehouseConfigStep from "./WarehouseConfigStep";
import WarehouseStep from "./WarehouseStep";
import AdminAccountStep from "./AdminAccountStep";

const STEP_LABELS = ["Organization", "Warehouse Config", "Warehouse", "Admin Account"] as const;

export default function RegistrationWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [organization, setOrganization] = useState<OrganizationStepValues>({
    name: "",
    isActive: true,
  });
  const [config, setConfig] = useState<WarehouseConfigStepValues>({
    requireStagingBeforePutaway: true,
    allowMixedSkuPerLocation: false,
    allowMixedLpnPerLocation: true,
    defaultPutawayStrategy: "NEAREST_EMPTY",
    cycleCountFrequencyDays: "",
  });
  const [warehouse, setWarehouse] = useState<WarehouseStepValues>({
    name: "",
    street: "",
    city: "",
    postalCode: "",
    country: "",
    timezone: "",
    isActive: true,
  });
  const [adminAccount, setAdminAccount] = useState<AdminAccountStepValues>({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [organizationErrors, setOrganizationErrors] = useState<OrganizationFieldErrors>({});
  const [configErrors, setConfigErrors] = useState<WarehouseConfigFieldErrors>({});
  const [warehouseErrors, setWarehouseErrors] = useState<WarehouseFieldErrors>({});
  const [adminAccountErrors, setAdminAccountErrors] = useState<AdminAccountFieldErrors>({});

  const [state, formAction, isPending] = useActionState(
    createOnboardingSubmission,
    initialOnboardingState
  );

  // Merge authoritative server-side field errors back into the right step
  // and jump the user to the earliest step that failed.
  useEffect(() => {
    if (state.status !== "error" || !state.fieldErrors) return;

    const errors = state.fieldErrors;
    const nextOrgErrors: OrganizationFieldErrors = {};
    const nextConfigErrors: WarehouseConfigFieldErrors = {};
    const nextWarehouseErrors: WarehouseFieldErrors = {};
    const nextAdminAccountErrors: AdminAccountFieldErrors = {};

    for (const key of ORGANIZATION_ERROR_KEYS) {
      if (errors[key]) nextOrgErrors[key] = errors[key];
    }
    for (const key of WAREHOUSE_CONFIG_ERROR_KEYS) {
      if (errors[key]) nextConfigErrors[key] = errors[key];
    }
    for (const key of WAREHOUSE_ERROR_KEYS) {
      if (errors[key]) nextWarehouseErrors[key] = errors[key];
    }
    for (const key of ADMIN_ACCOUNT_ERROR_KEYS) {
      if (errors[key]) nextAdminAccountErrors[key] = errors[key];
    }

    startTransition(() => {
      setOrganizationErrors(nextOrgErrors);
      setConfigErrors(nextConfigErrors);
      setWarehouseErrors(nextWarehouseErrors);
      setAdminAccountErrors(nextAdminAccountErrors);

      if (hasErrors(nextOrgErrors)) setStep(0);
      else if (hasErrors(nextConfigErrors)) setStep(1);
      else if (hasErrors(nextWarehouseErrors)) setStep(2);
      else if (hasErrors(nextAdminAccountErrors)) setStep(3);
    });
  }, [state]);

  useEffect(() => {
    if (state.status !== "success") return;

    router.replace("/dashboard/warehouses?status=success&message=Setup+complete");
    router.refresh();
  }, [router, state.status]);

  function goNext() {
    if (step === 0) {
      const errors = validateOrganizationStep(organization);
      setOrganizationErrors(errors);
      if (hasErrors(errors)) return;
    }

    if (step === 1) {
      const errors = validateWarehouseConfigStep(config);
      setConfigErrors(errors);
      if (hasErrors(errors)) return;
    }

    if (step === 2) {
      const errors = validateWarehouseStep(warehouse);
      setWarehouseErrors(errors);
      if (hasErrors(errors)) return;
    }

    if (step === 3) {
      const errors = validateAdminAccountStep(adminAccount);
      setAdminAccountErrors(errors);
      if (hasErrors(errors)) return;
    }

    setStep((current) => Math.min(current + 1, STEP_LABELS.length - 1));
  }

  function goBack() {
    setStep((current) => Math.max(current - 1, 0));
  }

  if (state.status === "success") {
    return (
      <div className="mx-auto w-full max-w-2xl rounded-lg border border-green-200 bg-green-50 p-8 text-center dark:border-green-900 dark:bg-green-950">
        <h2 className="text-lg font-semibold text-green-800 dark:text-green-300">Setup complete</h2>
        <p className="mt-2 text-sm text-green-700 dark:text-green-400">Redirecting to your warehouses dashboard...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Stepper steps={STEP_LABELS} currentStep={step} />

      <form action={formAction} className="mt-8 space-y-8">
        <div className={step === 0 ? "block" : "hidden"}>
          <OrganizationStep
            values={organization}
            errors={organizationErrors}
            onChange={setOrganization}
          />
        </div>

        <div className={step === 1 ? "block" : "hidden"}>
          <WarehouseConfigStep values={config} errors={configErrors} onChange={setConfig} />
        </div>

        <div className={step === 2 ? "block" : "hidden"}>
          <WarehouseStep values={warehouse} errors={warehouseErrors} onChange={setWarehouse} />
        </div>

        <div className={step === 3 ? "block" : "hidden"}>
          <AdminAccountStep
            values={adminAccount}
            errors={adminAccountErrors}
            onChange={setAdminAccount}
          />
        </div>

        {state.status === "error" && state.message && (
          <p className="text-sm text-red-600" role="alert">
            {state.message}
          </p>
        )}

        <div className="flex items-center justify-between border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0 || isPending}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Back
          </button>

          {/*
            Both buttons stay mounted at all times and are only toggled via
            `hidden`. Swapping a single button's `type` between "button" and
            "submit" at the same tree position (e.g. via a ternary) makes
            React mutate the existing DOM node in place, and the browser can
            resolve the in-flight click's default action against the new
            "submit" type — submitting the form early. Keeping them as two
            distinct, always-mounted nodes avoids that entirely.
          */}
          <button
            type="button"
            onClick={goNext}
            hidden={step >= STEP_LABELS.length - 1}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
          >
            Next
          </button>
          <button
            type="submit"
            disabled={isPending}
            hidden={step < STEP_LABELS.length - 1}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Creating..." : "Create Organization"}
          </button>
        </div>
      </form>
    </div>
  );
}
