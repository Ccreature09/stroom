import type { Metadata } from "next";
import RegistrationWizard from "@/components/onboarding/RegistrationWizard";

export const metadata: Metadata = {
  title: "Onboarding — Create Organization",
};

export default function OnboardingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="mb-10 text-center">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Set up your organization
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Create your organization, configure warehouse operating rules, add your first
          warehouse, and set up its administrator.
        </p>
      </div>
      <RegistrationWizard />
    </main>
  );
}
