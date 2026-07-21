/**
 * Shared onboarding validation.
 *
 * Field requirements are derived directly from the Drizzle schema
 * (`drizzle/schema.ts`):
 *   - organizations.name       -> varchar(100) NOT NULL  -> required
 *   - organizations.isActive   -> boolean, has DEFAULT    -> optional
 *   - warehouseConfigs.*       -> all nullable / have DEFAULT -> optional
 *   - warehouses.organizationId-> NOT NULL but server-assigned, not user input
 *   - warehouses.* (name/street/city/postalCode/country/timezone/isActive)
 *                              -> all nullable -> optional
 *   - employees.workEmail      -> varchar(150) NOT NULL -> required
 *   - employees.firstName/lastName -> varchar(50) -> optional
 *
 * This module is imported by both the client wizard (for instant
 * "Next" button validation) and the Server Action (for authoritative,
 * non-bypassable validation).
 */

export const PUTAWAY_STRATEGIES = [
  "NEAREST_EMPTY",
  "FIXED_SLOT",
  "ZONE_BALANCED",
] as const;

export type PutawayStrategy = (typeof PUTAWAY_STRATEGIES)[number];

export interface OrganizationStepValues {
  name: string;
  isActive: boolean;
}

export interface WarehouseConfigStepValues {
  requireStagingBeforePutaway: boolean;
  allowMixedSkuPerLocation: boolean;
  allowMixedLpnPerLocation: boolean;
  defaultPutawayStrategy: string;
  cycleCountFrequencyDays: string;
}

export interface WarehouseStepValues {
  name: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  timezone: string;
  isActive: boolean;
}

export interface AdminAccountStepValues {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export type OrganizationFieldErrors = Partial<{
  organizationName: string;
}>;

export type WarehouseConfigFieldErrors = Partial<{
  defaultPutawayStrategy: string;
  cycleCountFrequencyDays: string;
}>;

export type WarehouseFieldErrors = Partial<{
  warehouseName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  timezone: string;
}>;

export type AdminAccountFieldErrors = Partial<{
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminPassword: string;
  adminConfirmPassword: string;
}>;

export type OnboardingFieldErrors = OrganizationFieldErrors &
  WarehouseConfigFieldErrors &
  WarehouseFieldErrors &
  AdminAccountFieldErrors;

export function validateOrganizationStep(
  values: OrganizationStepValues
): OrganizationFieldErrors {
  const errors: OrganizationFieldErrors = {};

  const name = values.name.trim();
  if (!name) {
    errors.organizationName = "Organization name is required.";
  } else if (name.length > 100) {
    errors.organizationName = "Organization name must be 100 characters or fewer.";
  }

  return errors;
}

export function validateWarehouseConfigStep(
  values: WarehouseConfigStepValues
): WarehouseConfigFieldErrors {
  const errors: WarehouseConfigFieldErrors = {};

  if (
    values.defaultPutawayStrategy &&
    !PUTAWAY_STRATEGIES.includes(values.defaultPutawayStrategy as PutawayStrategy)
  ) {
    errors.defaultPutawayStrategy = "Select a valid putaway strategy.";
  }

  if (values.cycleCountFrequencyDays.trim() !== "") {
    const parsed = Number(values.cycleCountFrequencyDays);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.cycleCountFrequencyDays =
        "Cycle count frequency must be a positive whole number of days.";
    }
  }

  return errors;
}

export function validateWarehouseStep(
  values: WarehouseStepValues
): WarehouseFieldErrors {
  const errors: WarehouseFieldErrors = {};

  const checks: [keyof WarehouseStepValues, keyof WarehouseFieldErrors, number][] = [
    ["name", "warehouseName", 100],
    ["street", "street", 100],
    ["city", "city", 50],
    ["postalCode", "postalCode", 20],
    ["country", "country", 50],
    ["timezone", "timezone", 50],
  ];

  for (const [field, errorKey, max] of checks) {
    const value = values[field];
    if (typeof value === "string" && value.length > max) {
      errors[errorKey] = `Must be ${max} characters or fewer.`;
    }
  }

  return errors;
}

export function validateAdminAccountStep(
  values: AdminAccountStepValues
): AdminAccountFieldErrors {
  const errors: AdminAccountFieldErrors = {};

  if (values.firstName.trim().length > 50) {
    errors.adminFirstName = "First name must be 50 characters or fewer.";
  }
  if (values.lastName.trim().length > 50) {
    errors.adminLastName = "Last name must be 50 characters or fewer.";
  }

  const email = values.email.trim();
  if (!email) {
    errors.adminEmail = "Email address is required.";
  } else if (email.length > 150) {
    errors.adminEmail = "Email address must be 150 characters or fewer.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.adminEmail = "Enter a valid email address.";
  }

  if (values.password.length < 8) {
    errors.adminPassword = "Password must be at least 8 characters.";
  }
  if (values.password !== values.confirmPassword) {
    errors.adminConfirmPassword = "Passwords do not match.";
  }

  return errors;
}

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((message) => Boolean(message));
}

export const ORGANIZATION_ERROR_KEYS: (keyof OrganizationFieldErrors)[] = [
  "organizationName",
];

export const WAREHOUSE_CONFIG_ERROR_KEYS: (keyof WarehouseConfigFieldErrors)[] = [
  "defaultPutawayStrategy",
  "cycleCountFrequencyDays",
];

export const WAREHOUSE_ERROR_KEYS: (keyof WarehouseFieldErrors)[] = [
  "warehouseName",
  "street",
  "city",
  "postalCode",
  "country",
  "timezone",
];

export const ADMIN_ACCOUNT_ERROR_KEYS: (keyof AdminAccountFieldErrors)[] = [
  "adminFirstName",
  "adminLastName",
  "adminEmail",
  "adminPassword",
  "adminConfirmPassword",
];
