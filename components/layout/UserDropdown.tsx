// components/UserDropdown.tsx
"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

interface UserDropdownProps {
  email: string;
  signOutAction: () => Promise<void>;
}

export default function UserDropdown({ email, signOutAction }: UserDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const initial = email.charAt(0).toUpperCase();

  const handleSignOut = () => {
    setIsOpen(false);
    startTransition(async () => {
      await signOutAction();
      router.refresh(); // Forces Next.js to re-render Navbar & clear stale user data
    });
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 transition"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
          {initial}
        </span>
        <span className="max-w-[120px] truncate sm:max-w-[180px]">{email}</span>
        <svg
          className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 origin-top-right rounded-2xl border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5 z-50">
          <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
            Signed in as <br />
            <span className="font-semibold text-slate-900 truncate block">{email}</span>
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={handleSignOut}
            className="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 font-medium transition disabled:opacity-50"
          >
            {isPending ? "Signing out..." : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}