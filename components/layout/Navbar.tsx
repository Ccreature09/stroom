import Link from "next/link";
import { createClient } from "@/lib/server";
import UserDropdown from "./UserDropdown";
export default async function Navbar() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200">
      <Link
        href="/"
        className="text-xl font-bold tracking-tight text-[#06402B]"
      >
        stroom
      </Link>

      <nav className="flex items-center gap-4">
        {user ? (
          /* 2. Pass signOutAction prop here */
          <UserDropdown email={user.email ?? "User"} />
        ) : (
          <Link
            href="/sign-in"
            className="text-sm font-semibold text-slate-700 hover:text-slate-900"
          >
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
