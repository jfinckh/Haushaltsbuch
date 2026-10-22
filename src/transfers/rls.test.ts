import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withSession } from "@/shared/rls";
import { transferBooking } from "./schema";
import { createTestDatabase, ING_IBAN, ING_ROWS, TR_ROWS } from "./test-utils";

// The database itself gives each member only their own side: app_user cannot reach transfer_pair or
// the internal helpers, and transfer_booking follows the booking's visibility.

type Setup = Awaited<ReturnType<typeof createTestDatabase>>;

let setup: Setup;
let maxIng: string[];

beforeEach(async () => {
  setup = await createTestDatabase();
  await setup.householdOf("home", "max", "erika");
  await setup.addAccount("ing", "max", { iban: ING_IBAN });
  await setup.addAccount("tr", "max", { bank: "trade_republic" });
  await setup.addAccount("erika-ing", "erika");
  maxIng = (await setup.importBookings("max", "ing", ING_ROWS)).ids;
  await setup.importBookings("max", "tr", TR_ROWS);
});

async function asUser<T>(userId: string, fn: Parameters<typeof withSession<T>>[2]) {
  return withSession(setup.db, await setup.as(userId), fn);
}

describe("transfer_pair", () => {
  it("is closed to app_user, even for the owner of both sides", async () => {
    await expect(asUser("max", (tx) => tx.execute(sql`SELECT * FROM transfer_pair`))).rejects.toThrow();
    await expect(
      asUser("max", (tx) => tx.execute(sql`UPDATE transfer_pair SET status = 'rejected'`)),
    ).rejects.toThrow();
  });

  it("keeps the internal helpers away from app_user", async () => {
    for (const call of [
      sql`SELECT * FROM transfers_candidates(${maxIng[1]})`,
      sql`SELECT transfers_do_link(${maxIng[1]}, ${maxIng[0]}, true, 'erika')`,
      sql`SELECT transfers_visible_booking(${maxIng[1]})`,
      sql`SELECT transfers_propose(${maxIng[1]}, -100000, ARRAY[]::text[], false)`,
    ]) {
      await expect(asUser("erika", (tx) => tx.execute(call))).rejects.toThrow();
    }
  });

  it("shows a proposal that waits for a member only to that member", async () => {
    const pairsOf = (userId: string, id: string) =>
      asUser(userId, async (tx) => {
        const result = (await tx.execute(sql`SELECT * FROM transfers_pairs_of(ARRAY[${id}]::text[])`)) as unknown as {
          rows: { pair_id: string; status: string; partner_transaction_id: string | null; partner_owner_user_id: string | null }[];
        };
        return result.rows;
      });
    // Erika pays Max the +150 € of his ING file: his side is private, so the proposal waits for him.
    const { ids, result } = await setup.importBookings("erika", "erika-ing", [
      { date: "2026-10-05", amountCents: -15000, counterparty: "Max Mustermann" },
    ]);
    expect(result).toEqual({ linked: 0, proposed: 0 });
    expect(await pairsOf("erika", ids[0])).toEqual([]);
    const [waiting] = await pairsOf("max", maxIng[2]);
    expect(waiting).toMatchObject({ status: "proposed", partner_transaction_id: null, partner_owner_user_id: "erika" });
    const decide = (userId: string, call: "accept" | "reject") =>
      asUser(userId, async (tx) => {
        const query = call === "accept" ? sql`SELECT transfers_accept(${waiting.pair_id}) AS r` : sql`SELECT transfers_reject(${waiting.pair_id}) AS r`;
        return ((await tx.execute(query)) as unknown as { rows: { r: unknown }[] }).rows[0].r;
      });
    expect(await decide("erika", "accept")).toBe("not-found");
    expect(await decide("erika", "reject")).toBe(false);
    expect(await decide("max", "accept")).toBe("ok");
    expect(await pairsOf("erika", ids[0])).toMatchObject([{ status: "linked", partner_owner_user_id: "max" }]);
  });

  it("gives another member no rows for private bookings", async () => {
    const rows = await asUser("erika", async (tx) => {
      const result = (await tx.execute(
        sql`SELECT * FROM transfers_pairs_of(ARRAY[${sql.join(maxIng.map((id) => sql`${id}`), sql`, `)}]::text[])`,
      )) as unknown as { rows: unknown[] };
      return result.rows;
    });
    expect(rows).toEqual([]);
    const own = await asUser("max", async (tx) => {
      const result = (await tx.execute(sql`SELECT * FROM transfers_pairs_of(ARRAY[${maxIng[1]}]::text[])`)) as unknown as {
        rows: unknown[];
      };
      return result.rows;
    });
    expect(own).toHaveLength(1);
  });

  it("does nothing without a session", async () => {
    const result = await setup.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      return (await tx.execute(sql`SELECT transfers_link(${maxIng[0]}, ${maxIng[1]}) AS r`)) as unknown as { rows: { r: string }[] };
    });
    expect(result.rows[0].r).toBe("not-found");
  });
});

describe("transfer_booking", () => {
  it("shows a booking's transfer facts only to who may see the booking", async () => {
    expect((await asUser("max", (tx) => tx.select().from(transferBooking))).length).toBeGreaterThan(0);
    expect(await asUser("erika", (tx) => tx.select().from(transferBooking))).toEqual([]);
  });

  it("lets nobody write facts for a booking they may not see", async () => {
    await expect(
      asUser("erika", (tx) => tx.insert(transferBooking).values({ transactionId: maxIng[3], expectsPartner: true })),
    ).rejects.toThrow();
    const updated = await asUser("erika", (tx) =>
      tx.update(transferBooking).set({ decision: "no-partner", target: "external" }).returning(),
    );
    expect(updated).toEqual([]);
  });

  it("refuses a target account the writer may not see", async () => {
    await expect(
      asUser("max", (tx) =>
        tx
          .update(transferBooking)
          .set({ decision: "no-partner", target: "account", targetAccountId: "erika-ing" })
          .where(sql`transaction_id = ${maxIng[0]}`),
      ),
    ).rejects.toThrow();
  });
});
