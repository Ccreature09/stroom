import type { OnboardingFieldErrors } from "@/lib/onboarding/validation";

export interface OnboardingActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: OnboardingFieldErrors;
  organizationId?: number;
  warehouseId?: number;
  employeeId?: number;
}

export const initialOnboardingState: OnboardingActionState = {
  status: "idle",
};
