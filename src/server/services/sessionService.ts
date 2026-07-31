import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Account } from "@prisma/client";
import { requireCommunityMembership } from "@/server/services/listingService";

/**
 * research.md #2: database-backed sessions. Session tokens are high-entropy
 * random values, so — unlike passwords — a fast deterministic hash (SHA-256)
 * is the appropriate at-rest protection, not Argon2id.
 */
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (Assumptions: persistent session)

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface SessionWithAccount {
  sessionToken: string;
  accountId: string;
  expiresAt: Date;
  activeCommunityId: string | null;
  account: Account;
}

export async function createSession(
  accountId: string,
  rawSessionToken: string = generateSessionToken(),
  expiresAt: Date = new Date(Date.now() + SESSION_MAX_AGE_MS),
): Promise<{ sessionToken: string; accountId: string; expiresAt: Date }> {
  await prisma.session.create({
    data: { accountId, sessionToken: hashToken(rawSessionToken), expiresAt },
  });
  return { sessionToken: rawSessionToken, accountId, expiresAt };
}

/**
 * FR-008/Story 2: an expired session MUST be treated identically to a
 * deleted one — so a lookup past expiry cleans it up and returns nothing.
 */
export async function findSessionWithAccount(
  rawSessionToken: string,
): Promise<SessionWithAccount | null> {
  const hashed = hashToken(rawSessionToken);
  const session = await prisma.session.findUnique({
    where: { sessionToken: hashed },
    include: { account: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { sessionToken: hashed } }).catch(() => undefined);
    return null;
  }

  return {
    sessionToken: rawSessionToken,
    accountId: session.accountId,
    expiresAt: session.expiresAt,
    activeCommunityId: session.activeCommunityId,
    account: session.account,
  };
}

export async function getValidSession(rawSessionToken: string): Promise<{
  accountId: string;
  email: string;
  emailVerifiedAt: Date | null;
  displayName: string | null;
  activeCommunityId: string | null;
} | null> {
  const found = await findSessionWithAccount(rawSessionToken);
  if (!found) return null;
  return {
    accountId: found.account.id,
    email: found.account.email,
    emailVerifiedAt: found.account.emailVerifiedAt,
    displayName: found.account.displayName,
    activeCommunityId: found.activeCommunityId,
  };
}

/** Story 2 scenario 3: sign-out means this row no longer exists. */
export async function deleteSession(rawSessionToken: string): Promise<void> {
  await prisma.session
    .delete({ where: { sessionToken: hashToken(rawSessionToken) } })
    .catch(() => undefined);
}

export async function extendSession(rawSessionToken: string, expiresAt: Date): Promise<void> {
  await prisma.session
    .update({ where: { sessionToken: hashToken(rawSessionToken) }, data: { expiresAt } })
    .catch(() => undefined);
}

/**
 * 015-navigation-shell-community-selector, data-model.md: pure persistence,
 * mirroring extendSession()'s own shape — no membership validation here (see
 * setActiveCommunityForAccount() for the validated entry point every caller
 * actually uses).
 */
export async function setActiveCommunity(rawSessionToken: string, communityId: string): Promise<void> {
  await prisma.session
    .update({ where: { sessionToken: hashToken(rawSessionToken) }, data: { activeCommunityId: communityId } })
    .catch(() => undefined);
}

export type SetActiveCommunityResult =
  | { ok: true; communityId: string }
  | { ok: false; reason: "invalid_input" }
  | { ok: false; reason: "not_a_member" };

/**
 * 015-navigation-shell-community-selector, FR-002/FR-014, contracts/
 * navigation-shell-api.md: the one validated write path for "becoming the
 * active community" — the selector, the sidebar switcher, and the main
 * view's deep-link sync all resolve here via POST /api/active-community.
 * Never persists a caller-supplied communityId without re-checking
 * requireCommunityMembership() first (no allowSuspended — selecting a
 * community to work in is a growth action, matching createListing()'s own
 * convention).
 */
export async function setActiveCommunityForAccount(
  accountId: string,
  rawSessionToken: string,
  communityId: unknown,
): Promise<SetActiveCommunityResult> {
  if (typeof communityId !== "string" || communityId.length === 0) {
    return { ok: false, reason: "invalid_input" };
  }
  const isMember = await requireCommunityMembership(accountId, communityId);
  if (!isMember) {
    return { ok: false, reason: "not_a_member" };
  }
  await setActiveCommunity(rawSessionToken, communityId);
  return { ok: true, communityId };
}
