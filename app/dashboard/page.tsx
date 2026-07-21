import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { employees, positionTypes } from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import { signOut } from "./actions";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");

  const [employee] = await db
    .select({
      firstName: employees.firstName,
      lastName: employees.lastName,
      roleTitle: positionTypes.title,
    })
    .from(employees)
    .innerJoin(positionTypes, eq(employees.positionId, positionTypes.positionId))
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!employee) redirect("/sign-in");
  const name = [employee.firstName, employee.lastName].filter(Boolean).join(" ") || "there";

  return (
    <main className="flex-1 bg-slate-50 px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-6 border-b border-slate-200 pb-8 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.15em] text-teal-700">{employee.roleTitle}</p>
            <h1 className="mt-3 text-3xl font-bold tracking-[-0.05em] text-slate-950 sm:text-5xl">Good to see you, {name}.</h1>
            <p className="mt-3 text-lg text-slate-600">Your workspace is built from the permissions in your assigned position.</p>
          </div>
          <form action={signOut}><button className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100">Sign out</button></form>
        </div>

        <section className="mt-10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold tracking-[-0.03em] text-slate-950">Your modules</h2>
              <p className="mt-1 text-sm text-slate-500">Open your warehouse workspace</p>
            </div>
            <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-bold text-teal-800">Core module</span>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <article className="min-h-44 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-teal-50 text-sm font-bold text-teal-700">01</span>
              <h3 className="mt-7 text-lg font-bold tracking-[-0.025em] text-slate-950">Warehouses</h3>
              <p className="mt-2 leading-6 text-slate-600">View all warehouses in your organization and open a warehouse dashboard.</p>
              <Link
                href="/dashboard/warehouses"
                className="mt-5 inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Open module
              </Link>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
