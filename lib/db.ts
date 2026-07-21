import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/drizzle/schema";
import * as relations from "@/drizzle/relations";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set.");
}

// 1. Declare a type-safe global object reference to persist the client in development
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

// 2. Reuse the existing connection if it exists, otherwise create a new one
const client = globalForDb.conn ?? postgres(process.env.DATABASE_URL, { prepare: false });

// 3. Keep a reference to the connection in development mode to bypass module reloads
if (process.env.NODE_ENV !== "production") {
  globalForDb.conn = client;
}

export const db = drizzle(client, { schema: { ...schema, ...relations } });