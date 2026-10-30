import { inArray, isNull, sql } from "drizzle-orm";
import { accountIsVisible } from "@/db-contract/server";
import type { FieldCrypto } from "@/shared/field-crypto";
import { rows, textArray, withSession, type Caller, type RlsDatabase, type RlsTransaction } from "@/shared/rls";
import type { BookingStore, TransactionView } from "@/transactions/server";
import type { RuleTransfer, Transfers } from "./contract";
import { transferBooking } from "./schema";
import { transferSignals, type Member } from "./signals";
import { proposalActionSchema, transferActionSchema } from "./validation";
import type {
  AccountTransfers,
  NoPartnerTarget,
  TransferBookingView,
  TransferDecision,
  TransferKind,
  TransferPairView,
  TransferStatus,
} from "./types";

export type TransfersOptions = {
  db: RlsDatabase;
  /** Makes the blind index of mentioned IBANs (same key and context as the accounts' IBAN index). */
  crypto: FieldCrypto;
  /** Reads bookings and changes their type. */
  transactions: Pick<BookingStore, "findBookings" | "setKind">;
  /** Today's date (YYYY-MM-DD) for the 14-day mark. Default: the local date. */
  today?: () => string;
};

/** accounts' blind index context for IBANs (accounts' database contract). */
const ACCOUNT_IBAN_CONTEXT = "account.iban";
/** Open transfers older than this many days are marked. */
const OVERDUE_DAYS = 14;
/** The manual candidate list looks this many days around the booking date. */
const CANDIDATE_DAYS = 14;

type PairRow = {
  transaction_id: string;
  pair_id: string;
  status: "linked" | "proposed";
  manual: boolean;
  partner_transaction_id: string | null;
  partner_owner_user_id: string | null;
};

type BookingRow = typeof transferBooking.$inferSelect;

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const toBookingView = ({ id, accountId, date, amountCents, kind, counterparty, reference }: TransactionView): TransferBookingView => ({
  id,
  accountId,
  date,
  amountCents,
  kind,
  counterparty,
  reference,
});

const isTransferKind = (kind: TransferKind) => kind === "transfer" || kind === "saving";

/** Does the decision rule out a partner? */
const blocks = (row: BookingRow | undefined) =>
  row?.decision === "no-partner" || (row?.decision === "kind" && (row.decidedKind === "expense" || row.decidedKind === "income"));

/** The manual decision; the target account's id only while the caller may still see that account. */
function decisionOf(row: BookingRow | undefined, targetVisible: boolean): TransferDecision | null {
  if (row?.decision === "kind" && row.decidedKind) return { type: "kind", kind: row.decidedKind };
  if (row?.decision === "no-partner") {
    return row.target === "account"
      ? { type: "no-partner", target: "account", accountId: targetVisible ? row.targetAccountId : null }
      : { type: "no-partner", target: "external" };
  }
  return null;
}

/**
 * The transfers part. Every call is about the caller's own view; their user id comes from the
 * database. Pairs are only reached through the transfers_* database functions
 * (drizzle/0016_transfers_functions.sql, 0020_transfers_owner_consent.sql), which never reveal
 * another member's private booking and never change it without that member's OK: a likely partner on
 * another member's private account becomes a proposal only its owner sees and decides on.
 */
export function createTransfers({ db, crypto: fieldCrypto, transactions, today = localToday }: TransfersOptions): Transfers {
  const pairsOf = (tx: RlsTransaction, ids: string[]) =>
    ids.length === 0 ? Promise.resolve([]) : rows<PairRow>(tx, sql`SELECT * FROM transfers_pairs_of(${textArray(ids)})`);

  async function bookingRows(tx: RlsTransaction, ids: string[]): Promise<Map<string, BookingRow>> {
    if (ids.length === 0) return new Map();
    const found = await tx.select().from(transferBooking).where(inArray(transferBooking.transactionId, ids));
    return new Map(found.map((row) => [row.transactionId, row]));
  }

  /**
   * The pair views of the given rows, with the visible partners' bookings. A hidden partner gets its
   * owner's name from `members` (the caller's household), never the user id.
   */
  async function pairViews(
    tx: RlsTransaction,
    userId: string,
    pairRows: PairRow[],
    members: readonly Member[],
  ): Promise<Map<string, TransferPairView[]>> {
    const names = new Map(members.map((member) => [member.userId, member.name]));
    const partnerIds = pairRows.map((row) => row.partner_transaction_id).filter((id): id is string => id !== null);
    const partners = new Map(
      (await transactions.findBookings(tx, userId, { ids: partnerIds })).map((view) => [view.id, toBookingView(view)]),
    );
    const views = new Map<string, TransferPairView[]>();
    for (const row of pairRows) {
      const partner = row.partner_transaction_id && partners.get(row.partner_transaction_id);
      const view: TransferPairView = {
        pairId: row.pair_id,
        status: row.status,
        manual: row.manual,
        partner: partner
          ? { visible: true, booking: partner }
          : { visible: false, ownerName: (row.partner_owner_user_id && names.get(row.partner_owner_user_id)) || null },
      };
      views.set(row.transaction_id, [...(views.get(row.transaction_id) ?? []), view]);
    }
    return views;
  }

  /** Waits for a partner: a rule's external own account does not (but may still be linked). */
  const isOpen = (row: BookingRow | undefined, linked: boolean) =>
    Boolean(row?.expectsPartner) && !linked && !blocks(row) && !row?.ruleTarget;
  const isOverdue = (date: string) => date < addDays(today(), -OVERDUE_DAYS);

  async function findOne(tx: RlsTransaction, userId: string, id: string) {
    const [booking] = await transactions.findBookings(tx, userId, { ids: [id] });
    return booking ?? null;
  }

  /** Dissolves the booking's link and rejects its proposals (manual decision). */
  async function rejectAll(tx: RlsTransaction, id: string) {
    for (const pair of await pairsOf(tx, [id])) {
      await tx.execute(sql`SELECT transfers_reject(${pair.pair_id})`);
    }
  }

  async function decide(tx: RlsTransaction, userId: string, id: string, values: Partial<BookingRow>) {
    const decided = {
      decision: null,
      decidedKind: null,
      target: null,
      targetAccountId: null,
      ruleTarget: null,
      ...values,
      decidedByUserId: userId,
      decidedAt: new Date(),
    };
    await tx
      .insert(transferBooking)
      .values({ transactionId: id, ...decided })
      .onConflictDoUpdate({ target: transferBooking.transactionId, set: decided });
  }

  const api: Transfers = {
    async matchAfterImport(
      caller: Caller,
      {
        bookingIds,
        members,
        ruleTransfers = [],
      }: { bookingIds: string[]; members: readonly Member[]; ruleTransfers?: readonly RuleTransfer[] },
    ): Promise<{ linked: number; proposed: number }> {
      if (bookingIds.length === 0) return { linked: 0, proposed: 0 };
      return withSession(db, caller, async (tx, userId) => {
        const bookings = await transactions.findBookings(tx, userId, { ids: bookingIds });
        const byRule = new Map(ruleTransfers.map((item) => [item.id, item.target]));
        const hinted = bookings.flatMap((booking) => {
          const signals = transferSignals(booking, members, (iban) => fieldCrypto.blindIndex(iban, ACCOUNT_IBAN_CONTEXT));
          return signals && !byRule.has(booking.id) ? [{ transactionId: booking.id, ...signals }] : [];
        });
        if (hinted.length > 0) await tx.insert(transferBooking).values(hinted).onConflictDoNothing();
        for (const booking of bookings.filter((b) => byRule.has(b.id))) {
          const signals = transferSignals(booking, members, (iban) => fieldCrypto.blindIndex(iban, ACCOUNT_IBAN_CONTEXT));
          const ruleTarget = byRule.get(booking.id) ?? null;
          await tx
            .insert(transferBooking)
            .values({ transactionId: booking.id, ...signals, expectsPartner: true, ruleTarget })
            .onConflictDoUpdate({
              target: transferBooking.transactionId,
              set: { expectsPartner: true, ruleTarget },
              setWhere: isNull(transferBooking.decision),
            });
        }
        const [result] = await rows<{ linked: number; proposed: number }>(
          tx,
          sql`SELECT * FROM transfers_match(${textArray(bookings.map((b) => b.id))})`,
        );
        return { linked: Number(result?.linked ?? 0), proposed: Number(result?.proposed ?? 0) };
      });
    },

    async statusOf(caller: Caller, id: string, members: readonly Member[] = []): Promise<TransferStatus | null> {
      return withSession(db, caller, async (tx, userId) => {
        const booking = await findOne(tx, userId, id);
        if (!booking) return null;
        const row = (await bookingRows(tx, [id])).get(id);
        const pairs = (await pairViews(tx, userId, await pairsOf(tx, [id]), members)).get(id) ?? [];
        const targetVisible = Boolean(row?.targetAccountId && (await accountIsVisible(tx, row.targetAccountId)));
        const link = pairs.find((pair) => pair.status === "linked") ?? null;
        const proposals = pairs.filter((pair) => pair.status === "proposed");

        let candidates: TransferBookingView[] = [];
        if (!link) {
          const opposite = (
            await transactions.findBookings(tx, userId, {
              amountCents: -booking.amountCents,
              from: addDays(booking.date, -CANDIDATE_DAYS),
              to: addDays(booking.date, CANDIDATE_DAYS),
            })
          ).filter((view) => view.accountId !== booking.accountId);
          const linked = new Set(
            (await pairsOf(tx, opposite.map((view) => view.id))).filter((p) => p.status === "linked").map((p) => p.transaction_id),
          );
          candidates = opposite.filter((view) => !linked.has(view.id)).map(toBookingView);
        }
        const open = isOpen(row, link !== null);
        return {
          booking: toBookingView(booking),
          isTransfer: isTransferKind(booking.kind),
          link,
          proposals,
          decision: decisionOf(row, targetVisible),
          ruleTarget: row?.ruleTarget ?? null,
          open,
          overdue: open && isOverdue(booking.date),
          candidates,
        };
      });
    },

    async accountOverview(caller: Caller, accountId: string, members: readonly Member[] = []): Promise<AccountTransfers | null> {
      return withSession(db, caller, async (tx, userId) => {
        if (!(await accountIsVisible(tx, accountId))) return null;
        const bookings = await transactions.findBookings(tx, userId, { accountId });
        const ids = bookings.map((b) => b.id);
        const facts = await bookingRows(tx, ids);
        const pairRows = await pairsOf(tx, ids);
        const linked = new Set(pairRows.filter((p) => p.status === "linked").map((p) => p.transaction_id));
        const proposalRows = pairRows.filter((p) => p.status === "proposed");
        const views = await pairViews(tx, userId, proposalRows, members);
        const byId = new Map(bookings.map((b) => [b.id, toBookingView(b)]));
        const open = bookings
          .filter((b) => isOpen(facts.get(b.id), linked.has(b.id)))
          .map((b) => ({ ...toBookingView(b), overdue: isOverdue(b.date) }))
          .reverse();
        const proposals = [...views].flatMap(([id, pairs]) => pairs.map((pair) => ({ ...pair, booking: byId.get(id)! })));
        return { open, proposals };
      });
    },

    async link(caller: Caller, id: string, partnerId: string): Promise<"ok" | "not-found" | "invalid"> {
      return withSession(db, caller, async (tx) => {
        const [result] = await rows<{ result: "ok" | "not-found" | "invalid" }>(tx, sql`SELECT transfers_link(${id}, ${partnerId}) AS result`);
        return result.result;
      });
    },

    async unlink(caller: Caller, id: string): Promise<boolean> {
      return withSession(db, caller, async (tx) => {
        const link = (await pairsOf(tx, [id])).find((pair) => pair.status === "linked");
        if (!link) return false;
        const [result] = await rows<{ result: boolean }>(tx, sql`SELECT transfers_reject(${link.pair_id}) AS result`);
        return result.result;
      });
    },

    async acceptProposal(caller: Caller, pairId: string): Promise<"ok" | "not-found" | "taken"> {
      return withSession(db, caller, async (tx) => {
        const [result] = await rows<{ result: "ok" | "not-found" | "taken" }>(tx, sql`SELECT transfers_accept(${pairId}) AS result`);
        return result.result;
      });
    },

    async rejectProposal(caller: Caller, pairId: string): Promise<boolean> {
      return withSession(db, caller, async (tx) => {
        const [result] = await rows<{ result: boolean }>(tx, sql`SELECT transfers_reject(${pairId}) AS result`);
        return result.result;
      });
    },

    async setKind(caller: Caller, id: string, kind: TransferKind): Promise<boolean> {
      return withSession(db, caller, async (tx, userId) => {
        const booking = await findOne(tx, userId, id);
        if (!booking) return false;
        const link = (await pairsOf(tx, [id])).find((pair) => pair.status === "linked");
        if (isTransferKind(kind) && link) {
          await tx.execute(sql`SELECT transfers_set_pair_kind(${link.pair_id}, ${kind})`);
          return true;
        }
        if (!isTransferKind(kind)) await rejectAll(tx, id);
        await decide(tx, userId, id, { decision: "kind", decidedKind: kind, expectsPartner: isTransferKind(kind) });
        await transactions.setKind(tx, [id], kind);
        return true;
      });
    },

    async markWithoutPartner(caller: Caller, id: string, target: NoPartnerTarget): Promise<"ok" | "not-found" | "invalid"> {
      return withSession(db, caller, async (tx, userId) => {
        const booking = await findOne(tx, userId, id);
        if (!booking) return "not-found";
        if (target.type === "account" && (target.accountId === booking.accountId || !(await accountIsVisible(tx, target.accountId)))) {
          return "invalid";
        }
        await rejectAll(tx, id);
        await decide(tx, userId, id, {
          decision: "no-partner",
          target: target.type,
          targetAccountId: target.type === "account" ? target.accountId : null,
          expectsPartner: true,
        });
        if (!isTransferKind(booking.kind)) await transactions.setKind(tx, [id], "transfer");
        return "ok";
      });
    },

    async applyAction(caller: Caller, id: string, input: unknown): Promise<"ok" | "not-found" | "invalid" | "invalid-input"> {
      const parsed = transferActionSchema.safeParse(input);
      if (!parsed.success) return "invalid-input";
      const action = parsed.data;
      switch (action.action) {
        case "link":
          return api.link(caller, id, action.partnerId);
        case "unlink":
          return (await api.unlink(caller, id)) ? "ok" : "not-found";
        case "set-kind":
          return (await api.setKind(caller, id, action.kind)) ? "ok" : "not-found";
        case "no-partner":
          return api.markWithoutPartner(caller, id, action.target);
      }
    },

    async decideProposal(caller: Caller, pairId: string, input: unknown): Promise<"ok" | "not-found" | "taken" | "invalid-input"> {
      const parsed = proposalActionSchema.safeParse(input);
      if (!parsed.success) return "invalid-input";
      if (parsed.data.action === "accept") return api.acceptProposal(caller, pairId);
      return (await api.rejectProposal(caller, pairId)) ? "ok" : "not-found";
    },
  };
  return api;
}

