// components/layout/Navbar.tsx
import Link from "next/link";
import { createClient } from "@/lib/server";
import UserDropdown from "./UserDropdown";
import { signOut } from "@/app/dashboard/actions";

export default async function Navbar() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200">
      <Link href="/" className="text-xl font-bold tracking-tight text-slate-900">
        stroom
      </Link>

      <nav className="flex items-center gap-4">
        {user ? (
          /* 2. Pass signOutAction prop here */
          <UserDropdown 
            email={user.email ?? "User"} 
            signOutAction={signOut} 
          />
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