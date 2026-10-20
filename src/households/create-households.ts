import { count, eq } from "drizzle-orm";
import { household, householdMember } from "./schema";
import { asUser, type HouseholdsDatabase } from "./scoped";
import { createHouseholdSchema } from "./validation";

export type HouseholdsOptions = {
  db: HouseholdsDatabase;
};

export type Membership = { householdId: string };

export type Household = {
  id: string;
  name: string;
  currency: string;
  memberCount: number;
};

export type CreateHouseholdResult =
  | { ok: true; household: Household }
  | { ok: false; reason: "invalid-input" | "already-member" };

/** Thrown by requireMembership when the user belongs to no household. */
export class NoHouseholdError extends Error {
  constructor() {
    super("User belongs to no household");
    this.name = "NoHouseholdError";
  }
}

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  for (let e = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
  }
  return false;
}

/** The households part: who belongs to which household. Every call is about one user only. */
export function createHouseholds({ db }: HouseholdsOptions) {
  // Owner connection, bypasses row-level security. Only for the checked bootstrap writes.
  async function findMembership(userId: string): Promise<Membership | null> {
    const [row] = await db
      .select({ householdId: householdMember.householdId })
      .from(householdMember)
      .where(eq(householdMember.userId, userId));
    return row ?? null;
  }

  async function getMembership(userId: string): Promise<Membership | null> {
    return asUser(db, userId, async (tx) => {
      const [row] = await tx
        .select({ householdId: householdMember.householdId })
        .from(householdMember)
        .where(eq(householdMember.userId, userId));
      return row ?? null;
    });
  }

  async function getHousehold(userId: string): Promise<Household | null> {
    return asUser(db, userId, async (tx) => {
      const [membership] = await tx
        .select({ householdId: householdMember.householdId })
        .from(householdMember)
        .where(eq(householdMember.userId, userId));
      if (!membership) return null;
      const [row] = await tx
        .select({ id: household.id, name: household.name, currency: household.currency })
        .from(household)
        .where(eq(household.id, membership.householdId));
      if (!row) return null;
      const [members] = await tx
        .select({ value: count() })
        .from(householdMember)
        .where(eq(householdMember.householdId, row.id));
      return { ...row, memberCount: members.value };
    });
  }

  return {
    getMembership,
    getHousehold,

    /** The user's membership; throws NoHouseholdError if there is none. */
    async requireMembership(userId: string): Promise<Membership> {
      const membership = await getMembership(userId);
      if (!membership) throw new NoHouseholdError();
      return membership;
    },

    /** Creates a household with the user as its first member. A user can have only one. */
    async createHousehold(userId: string, input: unknown): Promise<CreateHouseholdResult> {
      const parsed = createHouseholdSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      if (await findMembership(userId)) return { ok: false, reason: "already-member" };

      const id = crypto.randomUUID();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(household).values({ id, name: parsed.data.name, createdByUserId: userId });
          await tx.insert(householdMember).values({ householdId: id, userId });
        });
      } catch (error) {
        if (isUniqueViolation(error)) return { ok: false, reason: "already-member" };
        throw error;
      }
      const created = await getHousehold(userId);
      if (!created) throw new Error("Household not found after creating it");
      return { ok: true, household: created };
    },

    /**
     * Adds the user to the household of the person who invited them. `inviterId` must come
     * from auth's invite record, never from request input. Does nothing if the user already
     * has a household or the inviter has none. Returns the user's membership, if any.
     */
    async joinInvitersHousehold(userId: string, inviterId: string | null): Promise<Membership | null> {
      const existing = await findMembership(userId);
      if (existing || !inviterId || inviterId === userId) return existing;
      const inviters = await findMembership(inviterId);
      if (!inviters) return null;
      await db
        .insert(householdMember)
        .values({ householdId: inviters.householdId, userId, invitedByUserId: inviterId })
        .onConflictDoNothing();
      return findMembership(userId);
    },
  };
}

export type Households = ReturnType<typeof createHouseholds>;
