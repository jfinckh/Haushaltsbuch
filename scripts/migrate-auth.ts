// Creates or updates the auth tables. Run with: npm run auth:migrate
import { migrateAuthSchema } from "@/auth/server";
import { auth } from "@/config/auth";

async function main() {
  const result = await migrateAuthSchema(auth);
  console.log("Auth schema up to date.", result);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
