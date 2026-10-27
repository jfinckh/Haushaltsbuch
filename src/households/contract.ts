import type { Result } from "@/shared/result";
import type { Caller } from "@/shared/rls";

// The contract of the households part. createHouseholds implements it.

export type Membership = { householdId: string };

export type Household = {
  id: string;
  name: string;
  currency: string;
  memberCount: number;
};

export type Member = { userId: string; joinedAt: Date };

export type CreateHouseholdResult = Result<{ household: Household }, "invalid-input" | "already-member">;

export type RenameHouseholdResult = Result<{ household: Household }, "invalid-input" | "no-household">;

export type LeaveHouseholdResult = { left: boolean; householdDeleted: boolean };

/** The invite a user accepted most recently, as auth records it. */
export type AcceptedInvite = {
  inviterId: string;
  /** When the user accepted it. A later time means a newer invite. */
  invitedAt: Date;
};

/** Why the own household is kept when joining another: it has other members, or it holds data. */
export type KeptReason = "other-members" | "holds-data";

export type JoinResult = {
  membership: Membership | null;
  /** The user was invited but stays in their own household (see keptReason). */
  keptOwnHousehold: boolean;
  keptReason: KeptReason | null;
};

/** An invite the user has not acted on yet: whether joining would move them now, or why not. */
export type PendingInvite = { canJoin: true } | { canJoin: false; keptReason: KeptReason };

/** Households. Every call is about the caller's own household only. */
export interface Households {
  /** The caller's membership, or null without a household. */
  getMembership(caller: Caller): Promise<Membership | null>;

  /** The caller's household with its member count, or null without one. */
  getHousehold(caller: Caller): Promise<Household | null>;

  /** Members of the user's own household, oldest first. Empty without a household. */
  listMembers(caller: Caller): Promise<Member[]>;

  /** Renames the user's own household. Any member may do this. */
  renameHousehold(caller: Caller, input: unknown): Promise<RenameHouseholdResult>;

  /**
   * Removes the user from their household. The last member to leave deletes the household
   * (memberships cascade; later parts that hang data on a household must cascade too).
   */
  leaveHousehold(caller: Caller): Promise<LeaveHouseholdResult>;

  /** Creates a household with the user as its first member. A user can have only one. */
  createHousehold(caller: Caller, input: unknown): Promise<CreateHouseholdResult>;

  /**
   * What joinInvitersHousehold would do with `invite`, without doing it: null if nothing would
   * change (no invite, an own one, the inviter has no household, already in it, or this invite was
   * acted on). Changes nothing, so pages may call it.
   */
  pendingInvite(caller: Caller, invite: AcceptedInvite | null): Promise<PendingInvite | null>;

  /**
   * Moves the user into the household of the person who invited them most recently. `invite`
   * must come from auth's invite record, never from request input. Acts on each invite only
   * once, so a user who later leaves is not put back by the same invite; a newer invite is
   * acted on again. A user whose own household is empty (no other members, no data per
   * householdHoldsData) switches and the empty household is deleted; otherwise they keep it, and
   * the invite stays open until they leave. Does nothing if the inviter has no household yet. Returns
   * the user's membership afterwards.
   */
  joinInvitersHousehold(caller: Caller, invite: AcceptedInvite | null): Promise<JoinResult>;
}
