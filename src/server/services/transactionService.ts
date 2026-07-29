import { prisma } from "@/lib/prisma";
import { requireCommunityMembership } from "@/server/services/listingService";
import type { TransactionConfirmationState, TransactionPaymentPath } from "@prisma/client";

interface TransactionRecord {
  id: string;
  listingId: string;
  listingTitle: string;
  paymentPath: TransactionPaymentPath;
  confirmationState: TransactionConfirmationState;
  createdAt: Date;
  confirmedAt: Date | null;
}

interface TransactionRow extends TransactionRecord {
  recorderId: string;
  counterpartId: string;
}

function toRecord(row: TransactionRow): TransactionRecord {
  return {
    id: row.id,
    listingId: row.listingId,
    listingTitle: row.listingTitle,
    paymentPath: row.paymentPath,
    confirmationState: row.confirmationState,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  };
}

export type RecordTransactionResult =
  | { ok: true; transaction: TransactionRecord & { counterpartDisplayName: string | null } }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_a_participant" }
  | { ok: false; reason: "community_not_active" }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "counterpart_not_a_member" };

export interface RecordTransactionInput {
  communityId: string;
  threadId: string;
  recorderAccountId: string;
}

/**
 * FR-001, FR-002, FR-004, FR-008, FR-009, FR-013. The counterpart and listing
 * are always derived from threadId — never accepted as separate input
 * (research.md #2) — so a caller can never name an arbitrary co-member, only
 * the other participant of a thread they are themselves already part of.
 * Gate order mirrors messageService.ts's sendMessageToListingOwner(): a
 * tolerant membership check first (so a SUSPENDED community doesn't collapse
 * into not_a_member below), then thread validity, then participant
 * derivation, then the ACTIVE-community gate (creation-only, research.md
 * #4), then the derived counterpart's own current membership (FR-002).
 */
export async function recordTransaction(input: RecordTransactionInput): Promise<RecordTransactionResult> {
  const { communityId, threadId, recorderAccountId } = input;

  if (!(await requireCommunityMembership(recorderAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const community = await prisma.community.findUniqueOrThrow({ where: { id: communityId } });

  const thread = await prisma.messageThread.findUnique({
    where: { id: threadId },
    include: { listing: { select: { id: true, title: true, communityId: true, ownerId: true } } },
  });
  if (!thread || thread.listing.communityId !== communityId || thread.operationalEpoch !== community.operationalEpoch) {
    return { ok: false, reason: "not_found" };
  }

  const isOwner = thread.listing.ownerId === recorderAccountId;
  const isBuyer = thread.buyerId === recorderAccountId;
  if (!isOwner && !isBuyer) {
    return { ok: false, reason: "not_a_participant" };
  }
  const counterpartId = isOwner ? thread.buyerId : thread.listing.ownerId;

  if (community.status !== "ACTIVE") {
    return { ok: false, reason: "community_not_active" };
  }

  if (!(await requireCommunityMembership(counterpartId, communityId))) {
    return { ok: false, reason: "counterpart_not_a_member" };
  }

  const [created, counterpart] = await Promise.all([
    prisma.transaction.create({
      data: {
        communityId,
        recorderId: recorderAccountId,
        counterpartId,
        listingId: thread.listing.id,
        listingTitle: thread.listing.title,
        operationalEpoch: community.operationalEpoch,
      },
    }),
    prisma.account.findUnique({ where: { id: counterpartId }, select: { displayName: true } }),
  ]);

  return { ok: true, transaction: { ...toRecord(created), counterpartDisplayName: counterpart?.displayName ?? null } };
}

export type ConfirmTransactionResult =
  | { ok: true; transaction: TransactionRecord }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_a_counterpart" }
  | { ok: false; reason: "not_a_member" };

export interface ConfirmTransactionInput {
  communityId: string;
  transactionId: string;
  callerAccountId: string;
}

/**
 * FR-003, FR-005. Tolerates a SUSPENDED community (research.md #4 — unlike
 * creation, confirming something already underway is not a growth action).
 * Idempotent (data-model.md gate 4): the `updateMany` only ever touches a row
 * still UNCONFIRMED, so re-confirming an already-CONFIRMED log is a no-op
 * rather than a second `confirmedAt` write, resolved by re-reading the row's
 * current state afterward instead of a separate read-then-branch race.
 */
export async function confirmTransaction(input: ConfirmTransactionInput): Promise<ConfirmTransactionResult> {
  const { communityId, transactionId, callerAccountId } = input;

  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction || transaction.communityId !== communityId) {
    return { ok: false, reason: "not_found" };
  }
  if (transaction.counterpartId !== callerAccountId) {
    return { ok: false, reason: "not_a_counterpart" };
  }

  await prisma.transaction.updateMany({
    where: { id: transactionId, confirmationState: "UNCONFIRMED" },
    data: { confirmationState: "CONFIRMED", confirmedAt: new Date() },
  });

  const final = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  return { ok: true, transaction: toRecord(final) };
}

export type GetTransactionResult =
  | { ok: true; transaction: TransactionRecord & { role: "recorder" | "counterpart"; counterpartDisplayName: string | null } }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_a_party" };

export interface GetTransactionInput {
  communityId: string;
  transactionId: string;
  callerAccountId: string;
}

/** FR-016, FR-017: reachable by either party regardless of the source thread/listing's fate. */
export async function getTransaction(input: GetTransactionInput): Promise<GetTransactionResult> {
  const { communityId, transactionId, callerAccountId } = input;

  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const row = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      recorder: { select: { displayName: true } },
      counterpart: { select: { displayName: true } },
    },
  });
  if (!row || row.communityId !== communityId) {
    return { ok: false, reason: "not_found" };
  }

  const isRecorder = row.recorderId === callerAccountId;
  const isCounterpart = row.counterpartId === callerAccountId;
  if (!isRecorder && !isCounterpart) {
    return { ok: false, reason: "not_a_party" };
  }

  return {
    ok: true,
    transaction: {
      ...toRecord(row),
      role: isRecorder ? "recorder" : "counterpart",
      counterpartDisplayName: isRecorder ? row.counterpart.displayName : row.recorder.displayName,
    },
  };
}

export type ListTransactionsResult =
  | {
      ok: true;
      transactions: (TransactionRecord & { role: "recorder" | "counterpart"; counterpartDisplayName: string | null })[];
    }
  | { ok: false; reason: "not_a_member" };

/** FR-016: every log in communityId where the caller is either party, newest first. */
export async function listTransactions(communityId: string, callerAccountId: string): Promise<ListTransactionsResult> {
  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const rows = await prisma.transaction.findMany({
    where: { communityId, OR: [{ recorderId: callerAccountId }, { counterpartId: callerAccountId }] },
    orderBy: { createdAt: "desc" },
    include: {
      recorder: { select: { displayName: true } },
      counterpart: { select: { displayName: true } },
    },
  });

  return {
    ok: true,
    transactions: rows.map((row) => {
      const isRecorder = row.recorderId === callerAccountId;
      return {
        ...toRecord(row),
        role: isRecorder ? ("recorder" as const) : ("counterpart" as const),
        counterpartDisplayName: isRecorder ? row.counterpart.displayName : row.recorder.displayName,
      };
    }),
  };
}

export type ListTransactionsForThreadResult =
  | {
      ok: true;
      transactions: (TransactionRecord & { role: "recorder" | "counterpart"; counterpartDisplayName: string | null })[];
    }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_a_participant" };

export interface ListTransactionsForThreadInput {
  communityId: string;
  threadId: string;
  callerAccountId: string;
}

/**
 * Supports the thread page's inline transaction display (research.md #7).
 * `Transaction` has no `threadId` column (research.md #1), so this derives
 * the same (listingId, other-party) pair `recordTransaction()` itself
 * derives from the thread, then filters by those raw account ids — not by
 * display name, which is not guaranteed unique.
 */
export async function listTransactionsForThread(
  input: ListTransactionsForThreadInput,
): Promise<ListTransactionsForThreadResult> {
  const { communityId, threadId, callerAccountId } = input;

  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const community = await prisma.community.findUniqueOrThrow({ where: { id: communityId } });
  const thread = await prisma.messageThread.findUnique({
    where: { id: threadId },
    include: { listing: { select: { id: true, communityId: true, ownerId: true } } },
  });
  if (!thread || thread.listing.communityId !== communityId || thread.operationalEpoch !== community.operationalEpoch) {
    return { ok: false, reason: "not_found" };
  }

  const isOwner = thread.listing.ownerId === callerAccountId;
  const isBuyer = thread.buyerId === callerAccountId;
  if (!isOwner && !isBuyer) {
    return { ok: false, reason: "not_a_participant" };
  }
  const otherPartyId = isOwner ? thread.buyerId : thread.listing.ownerId;

  const rows = await prisma.transaction.findMany({
    where: {
      communityId,
      listingId: thread.listing.id,
      OR: [
        { recorderId: callerAccountId, counterpartId: otherPartyId },
        { recorderId: otherPartyId, counterpartId: callerAccountId },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      recorder: { select: { displayName: true } },
      counterpart: { select: { displayName: true } },
    },
  });

  return {
    ok: true,
    transactions: rows.map((row) => {
      const isRecorder = row.recorderId === callerAccountId;
      return {
        ...toRecord(row),
        role: isRecorder ? ("recorder" as const) : ("counterpart" as const),
        counterpartDisplayName: isRecorder ? row.counterpart.displayName : row.recorder.displayName,
      };
    }),
  };
}
