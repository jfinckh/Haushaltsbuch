import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the environment.
}

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/auth/schema.ts", "./src/households/schema.ts", "./src/accounts/schema.ts", "./src/transactions/schema.ts", "./src/import/schema.ts", "./src/transfers/schema.ts", "./src/rules/schema.ts", "./src/budgets/schema.ts"],
  out: "./drizzle",
  // The owner: generate and migrate change roles and tables. The app's own login has no rights for that.
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "" },
});
