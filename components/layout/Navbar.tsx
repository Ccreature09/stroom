import Link from "next/link";

const navItems = [
  { href: "#platform", label: "Platform" },
  { href: "#workflows", label: "Workflows" },
  { href: "#why-stroom", label: "Why Stroom" },
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-lg">
      <nav className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 sm:px-8" aria-label="Main navigation">
        <Link href="/" className="flex items-center gap-2.5 text-slate-950" aria-label="Stroom home">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-600 shadow-sm shadow-teal-600/30">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-white" strokeWidth="2.4" aria-hidden="true">
              <path d="M4 7h16M4 12h11M4 17h7" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-lg font-bold tracking-[-0.04em]">stroom</span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <Link key={item.href} href={`/${item.href}`} className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-950">
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link href="/sign-in" className="hidden text-sm font-semibold text-slate-700 transition-colors hover:text-slate-950 sm:block">
            Sign in
          </Link>
          <Link href="/onboarding" className="rounded-lg bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 sm:px-4">
            Get started
          </Link>
        </div>
      </nav>
    </header>
  );
}
