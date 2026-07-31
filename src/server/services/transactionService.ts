import { prisma } from "@/lib/prisma";
import { requireCommunityMembership } from "@/server/services/listingService";
import type { TransactionPaymentPath, TransactionState } from "@prisma/client";

/**
 * The single, permanent, traceable record of a purchase — evolved from
 * 010-transaction-logging's `Transaction` in place (013-purchase-flow-stock,
 * research.md #1), not a second entity. 012-profiles-reputation reads this
 * same shape (FR-029, FR-030).
 */
interface TransactionRecord {
  id: string;
  listingId: string;
  listingTitle: string;
  paymentPath: TransactionPaymentPath;
  createdAt: Date;
  quantity: number;
  totalCents: number;
  state: TransactionState;
  resolvedAt: Date | null;
}

function toRecord(row: {
  id: string;
  listingId: string;
  listingTitle: string;
  paymentPath: TransactionPaymentPath;
  createdAt: Date;
  quantity: number;
  totalCents: number;
  state: TransactionState;
  resolvedAt: Date | null;
}): TransactionRecord {
  return {
    id: row.id,
    listingId: row.listingId,
    listingTitle: row.listingTitle,
    paymentPath: row.paymentPath,
    createdAt: row.createdAt,
    quantity: row.quantity,
    totalCents: row.totalCents,
    state: row.state,
    resolvedAt: row.resolvedAt,
  };
}

type PartyRole = "buyer" | "seller";

/** research.md #2: resolves the caller's role and the other party's id/displayName. */
function deriveParty(
  row: {
    buyerId: string;
    sellerId: string;
    buyer: { displayName: string | null };
    seller: { displayName: string | null };
  },
  callerAccountId: string,
): { ok: true; role: PartyRole; counterpartId: string; counterpartDisplayName: string | null } | { ok: false } {
  const isBuyer = row.buyerId === callerAccountId;
  const isSeller = row.sellerId === callerAccountId;
  if (!isBuyer && !isSeller) return { ok: false };
  return {
    ok: true,
    role: isBuyer ? "buyer" : "seller",
    counterpartId: isBuyer ? row.sellerId : row.buyerId,
    counterpartDisplayName: (isBuyer ? row.seller : row.buyer).displayName ?? null,
  };
}

const PARTY_INCLUDE = {
  buyer: { select: { displayName: true } },
  seller: { select: { displayName: true } },
} as const;

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export type ProposePurchaseResult =
  | { ok: true; transaction: TransactionRecord & { sellerDisplayName: string | null } }
  | { ok: false; reason: "invalid_input" }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "listing_not_active" }
  | { ok: false; reason: "stock_not_specified" }
  | { ok: false; reason: "exceeds_stock" }
  | { ok: false; reason: "self_purchase" }
  | { ok: false; reason: "seller_not_a_member" };

export interface ProposePurchaseInput {
  communityId: string;
  listingId: string;
  buyerAccountId: string;
  quantity: number;
  totalCents: number;
}

/**
 * FR-003, FR-004, FR-007-FR-012, FR-023, FR-024, FR-027. Gate order per
 * data-model.md's creation gates (research.md #4): quantity/total shape (no DB
 * access) -> buyer's ACTIVE-community membership (a new proposal is growth
 * activity, research.md #4a) -> the listing exists, is in this community, and
 * is FOR_SALE (a WANTED post reads as not_found, research.md #7) -> the
 * listing is ACTIVE (FR-009) -> stock has been declared (research.md #8) ->
 * quantity does not exceed it (FR-008) -> buyer is not the listing's own
 * owner (FR-010) -> the derived seller (listing.ownerId) currently holds
 * membership too (FR-007). No message thread is consulted anywhere (FR-027) —
 * the seller is derived directly from the listing (research.md #3).
 */
export async function proposePurchase(input: ProposePurchaseInput): Promise<ProposePurchaseResult> {
  const { communityId, listingId, buyerAccountId, quantity, totalCents } = input;

  if (!isPositiveInteger(quantity) || !isPositiveInteger(totalCents)) {
    return { ok: false, reason: "invalid_input" };
  }

  if (!(await requireCommunityMembership(buyerAccountId, communityId))) {
    return { ok: false, reason: "not_a_member" };
  }

  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing || listing.communityId !== communityId || listing.kind !== "FOR_SALE") {
    return { ok: false, reason: "not_found" };
  }

  if (listing.status !== "ACTIVE") {
    return { ok: false, reason: "listing_not_active" };
  }

  if (listing.stockQuantity === null) {
    return { ok: false, reason: "stock_not_specified" };
  }
  if (quantity > listing.stockQuantity) {
    return { ok: false, reason: "exceeds_stock" };
  }

  if (buyerAccountId === listing.ownerId) {
    return { ok: false, reason: "self_purchase" };
  }

  if (!(await requireCommunityMembership(listing.ownerId, communityId))) {
    return { ok: false, reason: "seller_not_a_member" };
  }

  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { operationalEpoch: true },
  });

  const [created, seller] = await Promise.all([
    prisma.transaction.create({
      data: {
        communityId,
        buyerId: buyerAccountId,
        sellerId: listing.ownerId,
        listingId: listing.id,
        listingTitle: listing.title,
        quantity,
        totalCents,
        state: "PENDING",
        operationalEpoch: community?.operationalEpoch ?? 1,
      },
    }),
    prisma.account.findUnique({ where: { id: listing.ownerId }, select: { displayName: true } }),
  ]);

  return { ok: true, transaction: { ...toRecord(created), sellerDisplayName: seller?.displayName ?? null } };
}

export type AcceptProposalResult =
  | { ok: true; transaction: TransactionRecord }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_a_seller" }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_pending" }
  | { ok: false; reason: "exceeds_stock" };

export interface ResolveProposalInput {
  communityId: string;
  transactionId: string;
  callerAccountId: string;
}

/**
 * FR-013, FR-014, FR-015, research.md #5, #6. Re-verifies both parties'
 * current membership (SUSPENDED tolerated — resolving something already
 * underway is not growth activity, unlike creation) and the proposal's
 * quantity against the listing's *current* stock, then performs the stock
 * decrement and the PENDING -> ACCEPTED transition atomically in a single
 * `$transaction`, using guarded conditional updates so a race between two
 * accept attempts (or an accept racing a stock edit) can never double-decrement
 * or drive stock negative: each `updateMany`'s affected-row count is checked,
 * and if either is 0 the whole transaction rolls back. The listing's
 * ACTIVE/PAUSED status is deliberately never re-checked here (FR-009, FR-014) —
 * pausing a listing after a proposal was submitted does not retroactively
 * block accepting it.
 */
export async function acceptProposal(input: ResolveProposalInput): Promise<AcceptProposalResult> {
  const { communityId, transactionId, callerAccountId } = input;

  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction || transaction.communityId !== communityId) {
    return { ok: false, reason: "not_found" };
  }
  if (transaction.sellerId !== callerAccountId) {
    return { ok: false, reason: "not_a_seller" };
  }
  if (transaction.state !== "PENDING") {
    return { ok: false, reason: "not_pending" };
  }
  if (!(await requireCommunityMembership(transaction.buyerId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const stockUpdate = await tx.listing.updateMany({
      where: { id: transaction.listingId, stockQuantity: { gte: transaction.quantity } },
      data: { stockQuantity: { decrement: transaction.quantity } },
    });
    if (stockUpdate.count === 0) {
      return { ok: false as const, reason: "exceeds_stock" as const };
    }

    const stateUpdate = await tx.transaction.updateMany({
      where: { id: transactionId, state: "PENDING" },
      data: { state: "ACCEPTED", resolvedAt: new Date() },
    });
    if (stateUpdate.count === 0) {
      return { ok: false as const, reason: "not_pending" as const };
    }

    return { ok: true as const };
  });

  if (!outcome.ok) {
    return { ok: false, reason: outcome.reason };
  }

  const final = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  return { ok: true, transaction: toRecord(final) };
}

export type RejectProposalResult =
  | { ok: true; transaction: TransactionRecord }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_a_seller" }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_pending" };

/** FR-016: no stock change, no history record — a single guarded update, mirroring the original 010 confirmTransaction() idempotency pattern. */
export async function rejectProposal(input: ResolveProposalInput): Promise<RejectProposalResult> {
  const { communityId, transactionId, callerAccountId } = input;

  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction || transaction.communityId !== communityId) {
    return { ok: false, reason: "not_found" };
  }
  if (transaction.sellerId !== callerAccountId) {
    return { ok: false, reason: "not_a_seller" };
  }

  const updated = await prisma.transaction.updateMany({
    where: { id: transactionId, state: "PENDING" },
    data: { state: "REJECTED", resolvedAt: new Date() },
  });
  if (updated.count === 0) {
    return { ok: false, reason: "not_pending" };
  }

  const final = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  return { ok: true, transaction: toRecord(final) };
}

export type CancelProposalResult =
  | { ok: true; transaction: TransactionRecord }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_a_buyer" }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_pending" };

/** FR-018: the buyer may withdraw a proposal the seller hasn't yet resolved. No stock change, no history record. */
export async function cancelProposal(input: ResolveProposalInput): Promise<CancelProposalResult> {
  const { communityId, transactionId, callerAccountId } = input;

  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction || transaction.communityId !== communityId) {
    return { ok: false, reason: "not_found" };
  }
  if (transaction.buyerId !== callerAccountId) {
    return { ok: false, reason: "not_a_buyer" };
  }

  const updated = await prisma.transaction.updateMany({
    where: { id: transactionId, state: "PENDING" },
    data: { state: "CANCELLED", resolvedAt: new Date() },
  });
  if (updated.count === 0) {
    return { ok: false, reason: "not_pending" };
  }

  const final = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  return { ok: true, transaction: toRecord(final) };
}

export type GetTransactionResult =
  | { ok: true; transaction: TransactionRecord & { role: PartyRole; counterpartId: string; counterpartDisplayName: string | null } }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_a_party" };

export interface GetTransactionInput {
  communityId: string;
  transactionId: string;
  callerAccountId: string;
}

/** FR-020, FR-025, FR-028: reachable by either party regardless of the source listing's fate. */
export async function getTransaction(input: GetTransactionInput): Promise<GetTransactionResult> {
  const { communityId, transactionId, callerAccountId } = input;

  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const row = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: PARTY_INCLUDE,
  });
  if (!row || row.communityId !== communityId) {
    return { ok: false, reason: "not_found" };
  }

  const party = deriveParty(row, callerAccountId);
  if (!party.ok) {
    return { ok: false, reason: "not_a_party" };
  }

  return {
    ok: true,
    transaction: { ...toRecord(row), ...party },
  };
}

export type ListMyTransactionsResult = {
  ok: true;
  transactions: (TransactionRecord & {
    communityId: string;
    communityName: string;
    role: PartyRole;
    counterpartId: string;
    counterpartDisplayName: string | null;
    /** The caller's own rating of the counterpart, if any — null when not ACCEPTED or not yet rated. */
    myRating: number | null;
  })[];
};

/**
 * Powers the top-level Transactions nav item (Buying/Selling views): every
 * transaction the caller is a party to, across every community, newest
 * first — mirrors listMyThreads()'s/listMyListings()'s own cross-community
 * shape. `myRating` is resolved with one batched Review lookup rather than
 * a query per row, and is the one bit of new state this view needs beyond
 * what getMyReview() already exposes per-transaction on the detail page.
 */
export async function listMyTransactions(callerAccountId: string): Promise<ListMyTransactionsResult> {
  const rows = await prisma.transaction.findMany({
    where: { OR: [{ buyerId: callerAccountId }, { sellerId: callerAccountId }] },
    orderBy: { createdAt: "desc" },
    include: { ...PARTY_INCLUDE, community: { select: { name: true } } },
  });

  const acceptedIds = rows.filter((row) => row.state === "ACCEPTED").map((row) => row.id);
  const myReviews = acceptedIds.length
    ? await prisma.review.findMany({
        where: { reviewerId: callerAccountId, transactionId: { in: acceptedIds } },
        select: { transactionId: true, rating: true },
      })
    : [];
  const myRatingByTransactionId = new Map(myReviews.map((review) => [review.transactionId, review.rating]));

  return {
    ok: true,
    // The `where` OR clause above already guarantees the caller is buyerId or sellerId,
    // so deriveParty() always succeeds here.
    transactions: rows.map((row) => {
      const party = deriveParty(row, callerAccountId);
      if (!party.ok) throw new Error("unreachable: row matched the party OR clause but deriveParty() rejected it");
      return {
        ...toRecord(row),
        communityId: row.communityId,
        communityName: row.community.name,
        ...party,
        myRating: myRatingByTransactionId.get(row.id) ?? null,
      };
    }),
  };
}

export type ListTransactionsResult =
  | {
      ok: true;
      transactions: (TransactionRecord & { role: PartyRole; counterpartId: string; counterpartDisplayName: string | null })[];
    }
  | { ok: false; reason: "not_a_member" };

export interface ListTransactionsOptions {
  /** FR-020: omitted returns every state; the buyer/seller history views (US5) filter to ACCEPTED. */
  state?: TransactionState;
}

/** FR-020, FR-025: every transaction in communityId where the caller is either party, newest first. */
export async function listTransactions(
  communityId: string,
  callerAccountId: string,
  options: ListTransactionsOptions = {},
): Promise<ListTransactionsResult> {
  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const rows = await prisma.transaction.findMany({
    where: {
      communityId,
      OR: [{ buyerId: callerAccountId }, { sellerId: callerAccountId }],
      ...(options.state !== undefined ? { state: options.state } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: PARTY_INCLUDE,
  });

  return {
    ok: true,
    // The `where` OR clause above already guarantees the caller is buyerId or sellerId,
    // so deriveParty() always succeeds here.
    transactions: rows.map((row) => {
      const party = deriveParty(row, callerAccountId);
      if (!party.ok) throw new Error("unreachable: row matched the party OR clause but deriveParty() rejected it");
      return { ...toRecord(row), ...party };
    }),
  };
}
