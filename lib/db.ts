import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/drizzle/schema";
import * as relations from "@/drizzle/relations";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set.");
}

// Declare a type-safe global reference to persist the client across Next.js HMR reloads
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

// Configure postgres.js client options for Next.js & Supabase Pooler
const client =
  globalForDb.conn ??
  postgres(connectionString, {
    prepare: false,      // Required for Supabase Transaction Pooler (Port 6543)
    connect_timeout: 10, // Prevents hanging on network timeouts
    idle_timeout: 15,    // Closes idle sockets cleanly
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.conn = client;
}

export const db = drizzle(client, { schema: { ...schema, ...relations } });