// Fills the local dev database with the seed data: `npm run db:seed` (reads .env like the app).
// Prints only counts, never booking data, names, IBANs, amounts or the password.
import { readFileSync } from "node:fs";
import { accounts } from "@/app/_lib/accounts";
import { auth } from "@/app/_lib/auth";
import { households } from "@/app/_lib/households";
import { imports } from "@/app/_lib/imports";
import { rules } from "@/app/_lib/rules";
import { SEED_USERS, seedAuthFrom, seedDevData } from "@/app/_lib/seed";
import { transactions } from "@/app/_lib/transactions";
import { householdMembers, transfers } from "@/app/_lib/transfers";

const testFile = (name: string) => new Uint8Array(readFileSync(new URL(`../test-data/${name}`, import.meta.url)));

async function main() {
  const result = await seedDevData({
    auth: seedAuthFrom(auth),
    households,
    accounts,
    transactions,
    imports,
    rules,
    transfers,
    householdMembers,
    files: {
      ing: testFile("ing_testdaten.csv"),
      tradeRepublic: testFile("traderepublic_testdaten.csv"),
      shared: testFile("ing_gemeinschaftskonto_testdaten.csv"),
      erika: testFile("ing_erika_testdaten.csv"),
    },
  });
  const emails = Object.values(SEED_USERS).map((user) => user.email).join(", ");
  if (!result.ok) {
    console.error(
      `Not seeded: a user with one of the seed emails (${emails}) already exists. Nothing was changed.\n` +
        "To seed again, delete those users or reset the local database (README, \"Test data\").",
    );
    return 1;
  }
  const { ing, tradeRepublic, shared, erika } = result.imports;
  console.log(`Seeded users ${emails} (password: see README, "Test data").`);
  console.log(`ING Giro: ${ing.newCount} bookings imported, balance check ok.`);
  console.log(`Trade Republic: ${tradeRepublic.newCount} bookings imported, ${tradeRepublic.linked} transfers linked.`);
  console.log(`ING Gemeinschaftskonto: ${shared.newCount} bookings imported, ${shared.linked} transfers linked.`);
  console.log(`Erika ING Giro: ${erika.newCount} bookings imported, ${erika.linked} transfers linked.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    // The error messages of the seed name only steps and codes, no booking data.
    console.error("Seeding failed:", error instanceof Error ? error.message : "unknown error");
    console.error("The seed users may exist now; delete them or reset the local database before running it again.");
    process.exit(1);
  },
);
