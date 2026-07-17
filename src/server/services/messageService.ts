import { prisma } from "@/lib/prisma";
import { requireCommunityMembership } from "@/server/services/listingService";
import type { PrismaClient, Prisma } from "@prisma/client";

const MAX_MESSAGE_LENGTH = 2000;

type MessageClient = PrismaClient | Prisma.TransactionClient;

type ValidateSendResult =
  | { ok: true; trimmed: string }
  | { ok: false; reason: "invalid_message" };

/**
 * research.md #5: the single point that validates a message body before any
 * persistence — shared by every path that ends in a Message row, so the
 * guarantee holds regardless of which public function was called.
 */
function validateMessageBody(body: string): ValidateSendResult {
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, reason: "invalid_message" };
  }
  return { ok: true, trimmed };
}

interface MessageRecord {
  id: string;
  body: string;
  createdAt: Date;
}

/**
 * 2026-07-17 amendment: also bumps the parent thread's `lastMessageAt` to
 * this message's own `createdAt`, on the same client (so it joins the
 * surrounding transaction when one exists) — the single point that keeps
 * `MessageThread.lastMessageAt` truthful, letting every ordering-by-recency
 * query (`listThreads()`, `listMyThreads()`) sort at the database level.
 */
async function insertMessage(
  client: MessageClient,
  threadId: string,
  senderId: string,
  trimmedBody: string,
): Promise<MessageRecord> {
  const message = await client.message.create({
    data: { threadId, senderId, body: trimmedBody },
  });
  await client.messageThread.update({
    where: { id: threadId },
    data: { lastMessageAt: message.createdAt },
  });
  return { id: message.id, body: message.body, createdAt: message.createdAt };
}

type CreateMessageResult =
  | { ok: true; message: MessageRecord }
  | { ok: false; reason: "invalid_message" }
  | { ok: false; reason: "display_name_required" };

/**
 * FR-010, research.md #5: the account sending a message MUST already have a
 * displayName — checked once, here, and shared by every path that ends in a
 * Message row, mirroring 006-user-display-names' createListing() precedent
 * (single point of enforcement, not duplicated per route).
 */
async function requireSenderDisplayName(
  senderId: string,
): Promise<{ ok: true } | { ok: false; reason: "display_name_required" }> {
  const sender = await prisma.account.findUnique({ where: { id: senderId }, select: { displayName: true } });
  if (!sender?.displayName) {
    return { ok: false, reason: "display_name_required" };
  }
  return { ok: true };
}

/**
 * research.md #5: validates and appends a message to an *existing* thread.
 * Used by sendThreadMessage() (replies) and by sendMessageToListingOwner()
 * when a thread for (listingId, buyerAccountId) already exists.
 */
async function createMessage(threadId: string, senderId: string, body: string): Promise<CreateMessageResult> {
  const validated = validateMessageBody(body);
  if (!validated.ok) return validated;

  const named = await requireSenderDisplayName(senderId);
  if (!named.ok) return named;

  const message = await insertMessage(prisma, threadId, senderId, validated.trimmed);
  return { ok: true, message };
}

export type SendMessageToListingOwnerResult =
  | { ok: true; thread: { id: string }; message: MessageRecord; threadCreated: boolean }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "cannot_message_own_listing" }
  | { ok: false; reason: "listing_paused" }
  | { ok: false; reason: "invalid_message" }
  | { ok: false; reason: "display_name_required" };

export interface SendMessageToListingOwnerInput {
  communityId: string;
  listingId: string;
  buyerAccountId: string;
  body: string;
}

/**
 * FR-001, FR-002, FR-013, FR-016. Finds the existing (listingId, buyerId)
 * thread and appends to it, or creates the thread and its first message
 * together in one transaction (data-model.md's Atomicity note) — a thread
 * can never exist with zero messages, and the @@unique constraint resolves
 * any race between two rapid first-messages from the same buyer
 * (research.md #2). The ACTIVE-listing gate (FR-016, research.md #4) only
 * applies when a new thread would be created.
 */
export async function sendMessageToListingOwner(
  input: SendMessageToListingOwnerInput,
): Promise<SendMessageToListingOwnerResult> {
  const { communityId, listingId, buyerAccountId, body } = input;

  if (!(await requireCommunityMembership(buyerAccountId, communityId))) {
    return { ok: false, reason: "not_a_member" };
  }

  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing || listing.communityId !== communityId) {
    return { ok: false, reason: "not_found" };
  }

  if (listing.ownerId === buyerAccountId) {
    return { ok: false, reason: "cannot_message_own_listing" };
  }

  const existingThread = await prisma.messageThread.findUnique({
    where: { listingId_buyerId: { listingId, buyerId: buyerAccountId } },
  });

  if (existingThread) {
    const created = await createMessage(existingThread.id, buyerAccountId, body);
    if (!created.ok) return created;
    return { ok: true, thread: { id: existingThread.id }, message: created.message, threadCreated: false };
  }

  if (listing.status !== "ACTIVE") {
    return { ok: false, reason: "listing_paused" };
  }

  const validated = validateMessageBody(body);
  if (!validated.ok) return validated;

  const named = await requireSenderDisplayName(buyerAccountId);
  if (!named.ok) return named;

  const created = await prisma.$transaction(async (tx) => {
    const thread = await tx.messageThread.create({
      data: { listingId, buyerId: buyerAccountId },
    });
    const message = await insertMessage(tx, thread.id, buyerAccountId, validated.trimmed);
    return { thread, message };
  });

  return { ok: true, thread: { id: created.thread.id }, message: created.message, threadCreated: true };
}

export type SendThreadMessageResult =
  | { ok: true; message: MessageRecord }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_a_participant" }
  | { ok: false; reason: "invalid_message" }
  | { ok: false; reason: "display_name_required" };

export interface SendThreadMessageInput {
  communityId: string;
  threadId: string;
  senderAccountId: string;
  body: string;
}

/** FR-003. Either the thread's buyer or its listing's owner may reply — no PAUSED check (FR-016, research.md #4). */
export async function sendThreadMessage(input: SendThreadMessageInput): Promise<SendThreadMessageResult> {
  const { communityId, threadId, senderAccountId, body } = input;

  if (!(await requireCommunityMembership(senderAccountId, communityId))) {
    return { ok: false, reason: "not_a_member" };
  }

  const thread = await prisma.messageThread.findUnique({
    where: { id: threadId },
    include: { listing: { select: { communityId: true, ownerId: true } } },
  });
  if (!thread || thread.listing.communityId !== communityId) {
    return { ok: false, reason: "not_found" };
  }

  const isParticipant = thread.buyerId === senderAccountId || thread.listing.ownerId === senderAccountId;
  if (!isParticipant) {
    return { ok: false, reason: "not_a_participant" };
  }

  return createMessage(threadId, senderAccountId, body);
}

export type ListThreadsResult =
  | {
      ok: true;
      threads: {
        id: string;
        listingId: string;
        listingTitle: string;
        counterpartDisplayName: string | null;
        lastMessageAt: Date;
        lastMessagePreview: string;
      }[];
    }
  | { ok: false; reason: "not_a_member" };

export interface ListThreadsOptions {
  /** 2026-07-17 amendment (My listings, FR-022): narrows to one listing's own threads. */
  listingId?: string;
}

/**
 * FR-005, FR-006, FR-008: every thread in communityId where the caller is
 * either the thread's buyer or that thread's listing's owner — an
 * administrator with no thread of their own gets none (Clarifications,
 * research.md #6). Scoped through the listing relation (research.md #1),
 * ordered most-recent-message-first via `lastMessageAt` at the database
 * level (2026-07-17 amendment — no in-memory sort; unpaginated, research.md #9).
 */
export async function listThreads(
  communityId: string,
  callerAccountId: string,
  options: ListThreadsOptions = {},
): Promise<ListThreadsResult> {
  if (!(await requireCommunityMembership(callerAccountId, communityId))) {
    return { ok: false, reason: "not_a_member" };
  }

  const threads = await prisma.messageThread.findMany({
    where: {
      listing: { communityId },
      OR: [{ buyerId: callerAccountId }, { listing: { ownerId: callerAccountId } }],
      ...(options.listingId ? { listingId: options.listingId } : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    include: {
      listing: { select: { id: true, title: true, ownerId: true, owner: { select: { displayName: true } } } },
      buyer: { select: { displayName: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return {
    ok: true,
    threads: threads.map((thread) => {
      const isOwner = thread.listing.ownerId === callerAccountId;
      return {
        id: thread.id,
        listingId: thread.listing.id,
        listingTitle: thread.listing.title,
        counterpartDisplayName: isOwner ? thread.buyer.displayName : thread.listing.owner.displayName,
        lastMessageAt: thread.lastMessageAt,
        lastMessagePreview: thread.messages[0].body,
      };
    }),
  };
}

export type ListMyThreadsResult = {
  ok: true;
  threads: {
    id: string;
    communityId: string;
    communityName: string;
    listingId: string;
    listingTitle: string;
    role: "owner" | "buyer";
    counterpartDisplayName: string | null;
    lastMessageAt: Date;
    lastMessagePreview: string;
  }[];
};

/**
 * FR-017-FR-020, FR-024 (2026-07-17 amendment): every thread the caller
 * participates in, across every community they currently belong to. Scoped
 * entirely from the caller's own current `Membership` rows (never a
 * caller-supplied community list, data-model.md), ordered by `lastMessageAt`
 * descending at the database level. No error branch — always succeeds,
 * `threads: []` for an account with none (Edge Cases).
 */
export async function listMyThreads(callerAccountId: string): Promise<ListMyThreadsResult> {
  const memberships = await prisma.membership.findMany({
    where: { accountId: callerAccountId },
    select: { communityId: true },
  });
  const communityIds = memberships.map((membership) => membership.communityId);
  if (communityIds.length === 0) {
    return { ok: true, threads: [] };
  }

  const threads = await prisma.messageThread.findMany({
    where: {
      listing: { communityId: { in: communityIds } },
      OR: [{ buyerId: callerAccountId }, { listing: { ownerId: callerAccountId } }],
    },
    orderBy: { lastMessageAt: "desc" },
    include: {
      listing: {
        select: {
          id: true,
          title: true,
          communityId: true,
          ownerId: true,
          owner: { select: { displayName: true } },
          community: { select: { name: true } },
        },
      },
      buyer: { select: { displayName: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return {
    ok: true,
    threads: threads.map((thread) => {
      const isOwner = thread.listing.ownerId === callerAccountId;
      return {
        id: thread.id,
        communityId: thread.listing.communityId,
        communityName: thread.listing.community.name,
        listingId: thread.listing.id,
        listingTitle: thread.listing.title,
        role: isOwner ? "owner" : "buyer",
        counterpartDisplayName: isOwner ? thread.buyer.displayName : thread.listing.owner.displayName,
        lastMessageAt: thread.lastMessageAt,
        lastMessagePreview: thread.messages[0].body,
      };
    }),
  };
}

export type GetThreadResult =
  | {
      ok: true;
      thread: { id: string; listingId: string; listingTitle: string };
      messages: {
        id: string;
        senderId: string;
        senderDisplayName: string | null;
        body: string;
        createdAt: Date;
      }[];
    }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_a_participant" };

export interface GetThreadInput {
  communityId: string;
  threadId: string;
  callerAccountId: string;
}

/** FR-005, FR-006, FR-007, FR-009: only the thread's buyer or its listing's owner, and only while a current member. */
export async function getThread(input: GetThreadInput): Promise<GetThreadResult> {
  const { communityId, threadId, callerAccountId } = input;

  if (!(await requireCommunityMembership(callerAccountId, communityId))) {
    return { ok: false, reason: "not_a_member" };
  }

  const thread = await prisma.messageThread.findUnique({
    where: { id: threadId },
    include: {
      listing: { select: { id: true, title: true, communityId: true, ownerId: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { sender: { select: { displayName: true } } },
      },
    },
  });
  if (!thread || thread.listing.communityId !== communityId) {
    return { ok: false, reason: "not_found" };
  }

  const isParticipant = thread.buyerId === callerAccountId || thread.listing.ownerId === callerAccountId;
  if (!isParticipant) {
    return { ok: false, reason: "not_a_participant" };
  }

  return {
    ok: true,
    thread: { id: thread.id, listingId: thread.listing.id, listingTitle: thread.listing.title },
    messages: thread.messages.map((message) => ({
      id: message.id,
      senderId: message.senderId,
      senderDisplayName: message.sender.displayName,
      body: message.body,
      createdAt: message.createdAt,
    })),
  };
}
