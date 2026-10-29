import { and, asc, count, eq, gte, lt, sql } from "drizzle-orm";
import { withSession, type Caller, type RlsDatabase, type RlsTransaction } from "@/shared/rls";
import type {
  AcceptedInvite,
  CreateHouseholdResult,
  Household,
  Households,
  JoinResult,
  KeptReason,
  LeaveHouseholdResult,
  Member,
  Membership,
  PendingInvite,
  RenameHouseholdResult,
} from "./contract";
import { household, householdInviteUse, householdMember } from "./schema";
import { createHouseholdSchema, renameHouseholdSchema } from "./validation";

export type HouseholdsOptions = {
  db: RlsDatabase;
  /**
   * Whether a household holds data that must not be given up silently (other parts' data, e.g.
   * shared accounts). Runs as households_admin inside the switch transaction, so it can only use
   * SQL functions granted to that role (e.g. accounts_household_has_accounts). Without it, a
   * household with no other members is always given up when its member joins another one.
   */
  householdHoldsData?: (tx: RlsTransaction, householdId: string) => Promise<boolean>;
};

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
export function createHouseholds({ db, householdHoldsData }: HouseholdsOptions): Households {
  // The caller's user id, as the database finds it for their session.
  async function sessionUserId(caller: Caller): Promise<string> {
    return withSession(db, caller, async (_tx, userId) => userId);
  }

  /**
   * Runs `fn` in a transaction as households_admin (drizzle/0026_runtime_roles.sql): sees every row
   * of the three household tables and nothing else. Only for the checked bootstrap writes, which
   * touch rows the caller cannot see yet (the inviter's household). The app's own database login
   * has no rights on these tables without it.
   */
  async function asHouseholdsAdmin<T>(fn: (tx: RlsTransaction) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE households_admin`);
      return fn(tx);
    });
  }

  // As households_admin. Only for the checked bootstrap writes.
  async function findMembership(userId: string): Promise<Membership | null> {
    return asHouseholdsAdmin(async (tx) => {
      const [row] = await tx
        .select({ householdId: householdMember.householdId })
        .from(householdMember)
        .where(eq(householdMember.userId, userId));
      return row ?? null;
    });
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

  // As households_admin. Records that households acted on the user's invite; false if it already
  // acted on this or a newer one.
  async function claimInvite(tx: RlsTransaction, userId: string, invite: AcceptedInvite) {
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

  // As households_admin. Whether households already acted on this invite or a newer one.
  async function inviteUsed(userId: string, invite: AcceptedInvite) {
    return asHouseholdsAdmin(async (tx) => {
      const [used] = await tx
        .select({ userId: householdInviteUse.userId })
        .from(householdInviteUse)
        .where(and(eq(householdInviteUse.userId, userId), gte(householdInviteUse.invitedAt, invite.invitedAt)));
      return Boolean(used);
    });
  }

  type InviteState =
    | { kind: "none"; own: Membership | null }
    | { kind: "same-household"; own: Membership }
    | { kind: "open"; own: Membership | null; inviters: Membership };

  /** Where an invite stands for `userId`, without changing anything. */
  async function inviteState(userId: string, invite: AcceptedInvite | null): Promise<InviteState> {
    const own = await findMembership(userId);
    if (!invite || invite.inviterId === userId) return { kind: "none", own };
    const inviters = await findMembership(invite.inviterId);
    if (!inviters) return { kind: "none", own };
    if (own?.householdId === inviters.householdId) return { kind: "same-household", own };
    if (await inviteUsed(userId, invite)) return { kind: "none", own };
    return { kind: "open", own, inviters };
  }

  /**
   * As households_admin. Why the own household must be kept when joining another: it has other
   * members, or other parts keep data in it; null if it may be given up. `lock` locks it first.
   */
  async function keptReasonFor(tx: RlsTransaction, own: Membership | null, lock: boolean): Promise<KeptReason | null> {
    if (!own) return null;
    if (lock) await tx.select({ id: household.id }).from(household).where(eq(household.id, own.householdId)).for("update");
    const [members] = await tx.select({ value: count() }).from(householdMember).where(eq(householdMember.householdId, own.householdId));
    if (members.value > 1) return "other-members";
    if (householdHoldsData && (await householdHoldsData(tx, own.householdId))) return "holds-data";
    return null;
  }

  return {
    getMembership,
    getHousehold,

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

    async createHousehold(caller: Caller, input: unknown): Promise<CreateHouseholdResult> {
      const parsed = createHouseholdSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const userId = await sessionUserId(caller);
      if (await findMembership(userId)) return { ok: false, reason: "already-member" };

      const id = crypto.randomUUID();
      try {
        await asHouseholdsAdmin(async (tx) => {
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

    async pendingInvite(caller: Caller, invite: AcceptedInvite | null): Promise<PendingInvite | null> {
      const state = await inviteState(await sessionUserId(caller), invite);
      if (state.kind !== "open") return null;
      const keptReason = await asHouseholdsAdmin((tx) => keptReasonFor(tx, state.own, false));
      return keptReason ? { canJoin: false, keptReason } : { canJoin: true };
    },

    async joinInvitersHousehold(caller: Caller, invite: AcceptedInvite | null): Promise<JoinResult> {
      const userId = await sessionUserId(caller);
      const state = await inviteState(userId, invite);
      const unchanged: JoinResult = { membership: state.own, keptOwnHousehold: false, keptReason: null };
      if (state.kind === "none" || !invite) return unchanged;
      if (state.kind === "same-household") {
        await asHouseholdsAdmin((tx) => claimInvite(tx, userId, invite));
        return unchanged;
      }
      const { own, inviters } = state;

      // As households_admin: crosses households, checked above and again under the lock below.
      const keptReason = await asHouseholdsAdmin(async (tx): Promise<KeptReason | null> => {
        // Only an empty household is given up: no other members, and no data other parts keep in it.
        const kept = await keptReasonFor(tx, own, true);
        if (kept) return kept;
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

