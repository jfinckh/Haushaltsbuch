/**
 * This app's auth setup: which database, how emails go out, who may register.
 * Everything reusable lives in src/auth; only app decisions belong here.
 */
import "server-only";
import { Pool } from "pg";
import { createAuth, createAuthServer, renderAuthEmail, type SignUpMode } from "@/auth/server";

const appName = "Haushaltsbuch";

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { authPool?: Pool };
const pool = (globalForDb.authPool ??= new Pool({ connectionString: process.env.DATABASE_URL }));

export const auth = createAuth({
  appName,
  database: pool,
  sendEmail: async (email) => {
    const message = renderAuthEmail(email, { appName, locale: "de" });
    if (process.env.NODE_ENV !== "production") {
      // No mail server in development: print the link instead.
      console.info(`\n[auth] Email to ${message.to}: ${message.subject}\n${email.url}\n`);
      return;
    }
    // TODO: send via SMTP (e.g. nodemailer) once the server is set up.
    throw new Error("No email transport configured");
  },
  signUp: {
    mode: (process.env.AUTH_SIGN_UP_MODE as SignUpMode | undefined) ?? "invite-only",
    // Household invite links will plug in here (src/households). Until then
    // only the first user can register; an admin creates everyone else.
    canSignUp: async () => false,
  },
  passkey: {
    rpID: process.env.AUTH_PASSKEY_RP_ID,
    origin: process.env.BETTER_AUTH_URL,
  },
});

export const authServer = createAuthServer(auth);
