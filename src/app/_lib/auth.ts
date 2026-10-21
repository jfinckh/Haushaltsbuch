import "server-only";
import { createAuth } from "@/auth/server";
import { db } from "@/db/server";
import { requireEnv } from "./env";

export const auth = createAuth({
  db,
  secret: requireEnv("BETTER_AUTH_SECRET"),
  baseURL: requireEnv("BETTER_AUTH_URL"),
  invitePath: "/invite",
});
