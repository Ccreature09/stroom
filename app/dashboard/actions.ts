// app/dashboard/actions.ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/"); // Change this from "/sign-in" to "/"
}