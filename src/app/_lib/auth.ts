import "server-only";
import { createAuth } from "@/auth/server";
import { db } from "@/db/server";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const auth = createAuth({
  db,
  secret: requireEnv("BETTER_AUTH_SECRET"),
  baseURL: requireEnv("BETTER_AUTH_URL"),
  invitePath: "/invite",
});
