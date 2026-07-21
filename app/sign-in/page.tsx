import type { Metadata } from "next";
import Link from "next/link";
import SignInForm from "@/components/auth/SignInForm";

export const metadata: Metadata = {
  title: "Sign in | Stroom",
  description: "Sign in to your Stroom warehouse workspace.",
};

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-[radial-gradient(ellipse_at_top,_#d5f4ed_0%,_#f8faf9_50%)] px-5 py-16">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-950/8 sm:p-9">
        <p className="text-sm font-bold uppercase tracking-[0.15em] text-teal-700">Welcome back</p>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.045em] text-slate-950">Your warehouse, in flow.</h1>
        <p className="mt-3 leading-7 text-slate-600">Sign in to open the workspace that matches your role.</p>
        <SignInForm />
        <p className="mt-7 border-t border-slate-100 pt-5 text-center text-sm text-slate-500">New to Stroom? <Link href="/onboarding" className="font-semibold text-teal-700 hover:text-teal-800">Set up your organization</Link></p>
      </section>
    </main>
  );
}
