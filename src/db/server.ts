import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export type Database = NodePgDatabase;

// One pool per process; reused across hot reloads in development.
const globalForDb = globalThis as unknown as { pool?: Pool };

function getPool(): Pool {
  if (!globalForDb.pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalForDb.pool = new Pool({ connectionString });
  }
  return globalForDb.pool;
}

export const db: Database = drizzle({ client: getPool() });
