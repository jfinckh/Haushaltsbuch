import { getMigrations } from "better-auth/db/migration";
import type { Auth } from "./create-auth";

/**
 * Create or update the auth tables (user, session, account, verification,
 * twoFactor, passkey). Safe to run repeatedly; it only adds what is missing.
 */
export async function migrateAuthSchema(auth: Auth) {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  const changes = toBeCreated.length + toBeAdded.length;
  if (changes > 0) await runMigrations();
  return {
    createdTables: toBeCreated.map((t) => t.table),
    alteredTables: toBeAdded.map((t) => t.table),
  };
}
