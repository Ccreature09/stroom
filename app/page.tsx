import { createClient } from "@/lib/server";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

const capabilities = [
  [
    "Inbound, without the bottleneck",
    "Receive, book, and put away inventory with clear next actions for every dock and operator.",
  ],
  [
    "Confident fulfilment",
    "Turn orders into efficient pick, pack, and load workflows that keep customers in the loop.",
  ],
  [
    "One operational picture",
    "See inventory, people, and work in motion across every warehouse—without chasing spreadsheets.",
  ],
];

const activity = [
  ["Inbound", "18 pallets received", "Dock 04", "bg-teal-500"],
  ["Pick wave", "42 orders ready", "Zone B", "bg-blue-500"],
  ["Cycle count", "Aisle 12 in progress", "98% complete", "bg-amber-400"],
];

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);

  return (
    <main className="overflow-hidden bg-[#f8faf9] text-slate-950">
      <section className="relative isolate border-b border-slate-200/80">
        <div className="absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(ellipse_at_top,_#c8f0e8_0%,_#eef8f5_38%,_transparent_70%)]" />
        <div className="mx-auto max-w-7xl px-5 pb-20 pt-18 sm:px-8 sm:pb-28 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-teal-800 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />{" "}
              Warehouse management, clarified
            </p>
            <h1 className="mt-7 text-balance text-5xl font-bold tracking-[-0.065em] text-slate-950 sm:text-7xl sm:leading-[0.98]">
              Keep every move in <span className="text-teal-700">flow.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-8 text-slate-600 sm:text-xl">
              Stroom gives warehouse teams one clear, connected way to receive,
              move, count, and ship inventory.
            </p>
            <div className="mt-10 flex items-center justify-center gap-4">
              {isAuthenticated ? (
                <Link
                  href="/warehouses"
                  className="rounded-xl bg-teal-700 px-6 py-3.5 text-sm font-bold text-white shadow-md hover:bg-teal-800 transition"
                >
                  Go to my warehouses →
                </Link>
              ) : (
                <>
                  <Link
                    href="/onboarding"
                    className="rounded-xl bg-slate-950 px-6 py-3.5 text-sm font-bold text-white shadow-md hover:bg-slate-800 transition"
                  >
                    Set up your warehouse
                  </Link>
                  <Link
                    href="#features"
                    className="rounded-xl border border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition"
                  >
                    Explore the platform
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Live Operations Card Preview */}
          <div className="mx-auto mt-16 max-w-5xl rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl shadow-teal-950/10 sm:p-5">
            <div className="rounded-xl bg-slate-950 p-5 sm:p-7">
              <div className="flex items-center justify-between border-b border-white/10 pb-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-teal-300">
                    Live operations
                  </p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    North hub · Today
                  </p>
                </div>
                <span className="rounded-full bg-teal-400/15 px-3 py-1 text-xs font-semibold text-teal-200">
                  All systems flowing
                </span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {activity.map(([label, value, detail, color]) => (
                  <Card
                    key={label}
                    className="border-white/10 bg-white/5 shadow-none"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                        <span className={`h-2 w-2 rounded-full ${color}`} />
                        {label}
                      </div>
                      <p className="mt-4 text-base font-semibold text-white">
                        {value}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">{detail}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities Section */}
      <section
        id="platform"
        className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28"
      >
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.15em] text-teal-700">
              Built for the warehouse floor
            </p>
            <h2 className="mt-4 text-balance text-3xl font-bold tracking-[-0.045em] sm:text-5xl">
              Operations feel simpler when the system understands the work.
            </h2>
          </div>
          <p className="max-w-2xl text-lg leading-8 text-slate-600">
            Designed around physical inventory and real people, Stroom brings
            the entire warehouse loop into one dependable workspace.
          </p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {capabilities.map(([title, body], index) => (
            <Card
              key={title}
              className="border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
            >
              <CardContent className="p-6">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-teal-50 text-sm font-bold text-teal-700">
                  0{index + 1}
                </span>
                <h3 className="mt-6 text-xl font-bold tracking-[-0.03em] text-slate-950">
                  {title}
                </h3>
                <p className="mt-3 leading-7 text-slate-600">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Workflows Section */}
      <section
        id="workflows"
        className="bg-slate-950 px-5 py-20 text-white sm:px-8 sm:py-28"
      >
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.15em] text-teal-300">
              Every movement, connected
            </p>
            <h2 className="mt-4 text-balance text-3xl font-bold tracking-[-0.045em] sm:text-5xl">
              From the dock door to the delivery truck.
            </h2>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              Guide each step of inbound, internal, and outbound operations with
              the context your team needs to do it right the first time.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {["Receive & book", "Put away", "Pick & pack", "Load & ship"].map(
              (workflow, index) => (
                <Card
                  key={workflow}
                  className="border-white/10 bg-white/5 shadow-none"
                >
                  <CardContent className="p-5">
                    <span className="text-sm font-semibold text-teal-300">
                      0{index + 1}
                    </span>
                    <p className="mt-7 text-lg font-semibold text-white">
                      {workflow}
                    </p>
                  </CardContent>
                </Card>
              ),
            )}
          </div>
        </div>
      </section>

      {/* Call to Action Section */}
      <section
        id="why-stroom"
        className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28"
      >
        <Card className="rounded-3xl bg-teal-700 border-none text-white shadow-xl">
          <CardContent className="px-6 py-14 text-center sm:px-14 sm:py-20">
            <p className="text-sm font-bold uppercase tracking-[0.15em] text-teal-100">
              Ready when you are
            </p>
            <h2 className="mx-auto mt-4 max-w-2xl text-balance text-3xl font-bold tracking-[-0.045em] sm:text-5xl">
              Start your warehouse with a clearer flow.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-teal-50">
              Create your organization, warehouse, and first administrator in a
              few guided steps.
            </p>
            <Link
              href="/onboarding"
              className="mt-8 inline-flex rounded-lg bg-white px-5 py-3 text-sm font-bold text-teal-800 shadow-lg transition hover:-translate-y-0.5 hover:bg-teal-50"
            >
              Get started with Stroom
            </Link>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
