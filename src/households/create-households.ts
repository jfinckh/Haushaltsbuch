import { and, asc, count, eq, gte, lt, sql } from "drizzle-orm";
import { withSession, type Caller, type RlsDatabase, type RlsTransaction } from "@/shared/rls";
import { household, householdInviteUse, householdMember } from "./schema";
import { createHouseholdSchema, renameHouseholdSchema } from "./validation";

export type HouseholdsOptions = {
  db: RlsDatabase;
  /**
   * Whether a household holds data that must not be given up silently (other parts' data, e.g.
   * shared accounts). Runs on the owner connection inside the switch transaction. Without it, a
   * household with no other members is always given up when its member joins another one.
   */
  householdHoldsData?: (tx: RlsTransaction, householdId: string) => Promise<boolean>;
};

export type Membership = { householdId: string };

export type Household = {
  id: string;
  name: string;
  currency: string;
  memberCount: number;
};

export type Member = { userId: string; joinedAt: Date };

export type CreateHouseholdResult =
  | { ok: true; household: Household }
  | { ok: false; reason: "invalid-input" | "already-member" };

export type RenameHouseholdResult =
  | { ok: true; household: Household }
  | { ok: false; reason: "invalid-input" | "no-household" };

export type LeaveHouseholdResult = { left: boolean; householdDeleted: boolean };

/** The invite a user accepted most recently, as auth records it. */
export type AcceptedInvite = {
  inviterId: string;
  /** When the user accepted it. A later time means a newer invite. */
  invitedAt: Date;
};

export type JoinResult = {
  membership: Membership | null;
  /** The user was invited but stays in their own household (see keptReason). */
  keptOwnHousehold: boolean;
  /** Why the own household was kept: it has other members, or it holds data. */
  keptReason: "other-members" | "holds-data" | null;
};

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

/**
 * The households part: who belongs to which household. Every call is about the caller only; the
 * caller's user id always comes from the database (withSession), never from arguments.
 */
export function createHouseholds({ db, householdHoldsData }: HouseholdsOptions) {
  // The caller's user id, as the database finds it for their session.
  async function sessionUserId(caller: Caller): Promise<string> {
    return withSession(db, caller, async (_tx, userId) => userId);
  }

  // Owner connection, bypasses row-level security. Only for the checked bootstrap writes.
  async function findMembership(userId: string): Promise<Membership | null> {
    const [row] = await db
      .select({ householdId: householdMember.householdId })
      .from(householdMember)
      .where(eq(householdMember.userId, userId));
    return row ?? null;
  }

  async function getMembership(caller: Caller): Promise<Membership | null> {
    return withSession(db, caller, async (tx, userId) => {
      const [row] = await tx
        .select({ householdId: householdMember.householdId })
        .from(householdMember)
        .where(eq(householdMember.userId, userId));
      return row ?? null;
    });
  }

  async function getHousehold(caller: Caller): Promise<Household | null> {
    return withSession(db, caller, async (tx, userId) => {
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

  // Owner connection. Records that households acted on the user's invite; false if it already
  // acted on this or a newer one.
  async function claimInvite(tx: Pick<RlsDatabase, "insert">, userId: string, invite: AcceptedInvite) {
    const claimed = await tx
      .insert(householdInviteUse)
      .values({ userId, inviterUserId: invite.inviterId, invitedAt: invite.invitedAt })
      .onConflictDoUpdate({
        target: householdInviteUse.userId,
        set: { inviterUserId: invite.inviterId, invitedAt: invite.invitedAt, usedAt: sql`now()` },
        setWhere: lt(householdInviteUse.invitedAt, invite.invitedAt),
      })
      .returning({ userId: householdInviteUse.userId });
    return claimed.length === 1;
  }

  // Owner connection. Whether households already acted on this invite or a newer one.
  async function inviteUsed(userId: string, invite: AcceptedInvite) {
    const [used] = await db
      .select({ userId: householdInviteUse.userId })
      .from(householdInviteUse)
      .where(and(eq(householdInviteUse.userId, userId), gte(householdInviteUse.invitedAt, invite.invitedAt)));
    return Boolean(used);
  }

  return {
    getMembership,
    getHousehold,

    /** Members of the user's own household, oldest first. Empty without a household. */
    async listMembers(caller: Caller): Promise<Member[]> {
      return withSession(db, caller, async (tx, userId) => {
        const [membership] = await tx
          .select({ householdId: householdMember.householdId })
          .from(householdMember)
          .where(eq(householdMember.userId, userId));
        if (!membership) return [];
        return tx
          .select({ userId: householdMember.userId, joinedAt: householdMember.joinedAt })
          .from(householdMember)
          .where(eq(householdMember.householdId, membership.householdId))
          .orderBy(asc(householdMember.joinedAt), asc(householdMember.userId));
      });
    },

    /** Renames the user's own household. Any member may do this. */
    async renameHousehold(caller: Caller, input: unknown): Promise<RenameHouseholdResult> {
      const parsed = renameHouseholdSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const renamed = await withSession(db, caller, async (tx, userId) => {
        const [membership] = await tx
          .select({ householdId: householdMember.householdId })
          .from(householdMember)
          .where(eq(householdMember.userId, userId));
        if (!membership) return false;
        await tx.update(household).set({ name: parsed.data.name }).where(eq(household.id, membership.householdId));
        return true;
      });
      if (!renamed) return { ok: false, reason: "no-household" };
      const updated = await getHousehold(caller);
      if (!updated) return { ok: false, reason: "no-household" };
      return { ok: true, household: updated };
    },

    /**
     * Removes the user from their household. The last member to leave deletes the household
     * (memberships cascade; later parts that hang data on a household must cascade too).
     */
    async leaveHousehold(caller: Caller): Promise<LeaveHouseholdResult> {
      return withSession(db, caller, async (tx, userId) => {
        const [membership] = await tx
          .select({ householdId: householdMember.householdId })
          .from(householdMember)
          .where(eq(householdMember.userId, userId));
        if (!membership) return { left: false, householdDeleted: false };
        // Lock the household so two members leaving at once can't leave it empty.
        await tx.select({ id: household.id }).from(household).where(eq(household.id, membership.householdId)).for("update");
        const [members] = await tx
          .select({ value: count() })
          .from(householdMember)
          .where(eq(householdMember.householdId, membership.householdId));
        if (members.value <= 1) {
          await tx.delete(household).where(eq(household.id, membership.householdId));
          return { left: true, householdDeleted: true };
        }
        await tx
          .delete(householdMember)
          .where(and(eq(householdMember.householdId, membership.householdId), eq(householdMember.userId, userId)));
        return { left: true, householdDeleted: false };
      });
    },

    /** The user's membership; throws NoHouseholdError if there is none. */
    async requireMembership(caller: Caller): Promise<Membership> {
      const membership = await getMembership(caller);
      if (!membership) throw new NoHouseholdError();
      return membership;
    },

    /** Creates a household with the user as its first member. A user can have only one. */
    async createHousehold(caller: Caller, input: unknown): Promise<CreateHouseholdResult> {
      const parsed = createHouseholdSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const userId = await sessionUserId(caller);
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
      const created = await getHousehold(caller);
      if (!created) throw new Error("Household not found after creating it");
      return { ok: true, household: created };
    },

    /**
     * Moves the user into the household of the person who invited them most recently. `invite`
     * must come from auth's invite record, never from request input. Acts on each invite only
     * once, so a user who later leaves is not put back by the same invite; a newer invite is
     * acted on again. A user whose own household is empty (no other members, no data per
     * householdHoldsData) switches and the empty household is deleted; otherwise they keep it, and
     * the invite stays open until they leave. Does nothing if the inviter has no household yet. Returns
     * the user's membership afterwards.
     */
    async joinInvitersHousehold(caller: Caller, invite: AcceptedInvite | null): Promise<JoinResult> {
      const userId = await sessionUserId(caller);
      const own = await findMembership(userId);
      const unchanged: JoinResult = { membership: own, keptOwnHousehold: false, keptReason: null };
      if (!invite || invite.inviterId === userId) return unchanged;
      const inviters = await findMembership(invite.inviterId);
      if (!inviters) return unchanged;
      if (own?.householdId === inviters.householdId) {
        await claimInvite(db, userId, invite);
        return unchanged;
      }
      if (await inviteUsed(userId, invite)) return unchanged;

      // Owner connection: crosses households, checked above and again under the lock below.
      const keptReason = await db.transaction(async (tx): Promise<JoinResult["keptReason"]> => {
        if (own) {
          await tx.select({ id: household.id }).from(household).where(eq(household.id, own.householdId)).for("update");
          const [members] = await tx
            .select({ value: count() })
            .from(householdMember)
            .where(eq(householdMember.householdId, own.householdId));
          // Only an empty household is given up: no other members, and no data other parts keep in it.
          if (members.value > 1) return "other-members";
          if (householdHoldsData && (await householdHoldsData(tx, own.householdId))) return "holds-data";
        }
        if (!(await claimInvite(tx, userId, invite))) return null;
        if (own) await tx.delete(household).where(eq(household.id, own.householdId));
        await tx
          .insert(householdMember)
          .values({ householdId: inviters.householdId, userId, invitedByUserId: invite.inviterId })
          .onConflictDoNothing();
        return null;
      });
      return { membership: await findMembership(userId), keptOwnHousehold: keptReason !== null, keptReason };
    },
  };
}

export type Households = ReturnType<typeof createHouseholds>;
