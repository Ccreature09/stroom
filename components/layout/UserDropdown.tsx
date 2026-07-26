"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/client"; // Adjust path if your browser client helper is located elsewhere
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, LogOut, LayoutDashboard, Settings } from "lucide-react";

interface UserDropdownProps {
  email: string;
}

export default function UserDropdown({ email }: UserDropdownProps) {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();
  const initial = email.charAt(0).toUpperCase();

  const handleSignOut = async (e: Event) => {
    e.preventDefault(); // Keep dropdown open while signing out
    setIsPending(true);

    try {
      const supabase = createClient();
      await supabase.auth.signOut();

      router.push("/sign-in");
      router.refresh();
    } catch (error) {
      console.error("Error signing out:", error);
      setIsPending(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white">
            {initial}
          </span>
          <span className="max-w-[120px] truncate sm:max-w-[180px]">
            {email}
          </span>
          <ChevronDown className="h-4 w-4 text-slate-400 transition-transform" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-56 rounded-2xl border-slate-200 p-1 shadow-lg"
      >
        <DropdownMenuLabel className="px-3 py-2 font-normal text-xs text-slate-500">
          Signed in as <br />
          <span className="font-semibold text-slate-900 truncate block">
            {email}
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator className="bg-slate-100" />

        <DropdownMenuGroup>
          <DropdownMenuItem
            asChild
            className="rounded-xl px-3 py-2 cursor-pointer text-slate-700 focus:bg-slate-100"
          >
            <Link href="/dashboard" className="flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4 text-slate-500" />
              <span>Dashboard</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            asChild
            className="rounded-xl px-3 py-2 cursor-pointer text-slate-700 focus:bg-slate-100"
          >
            <Link href="/settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-slate-500" />
              <span>Settings</span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="bg-slate-100" />

        <DropdownMenuItem
          disabled={isPending}
          onSelect={handleSignOut}
          className="cursor-pointer rounded-xl px-3 py-2 font-medium text-rose-600 focus:bg-rose-50 focus:text-rose-600 disabled:opacity-50"
        >
          <LogOut className="mr-2 h-4 w-4 text-rose-600" />
          <span>{isPending ? "Signing out..." : "Sign out"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
