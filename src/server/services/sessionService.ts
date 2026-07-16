import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Account } from "@prisma/client";

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
    account: session.account,
  };
}

export async function getValidSession(
  rawSessionToken: string,
): Promise<{ accountId: string; email: string; emailVerifiedAt: Date | null } | null> {
  const found = await findSessionWithAccount(rawSessionToken);
  if (!found) return null;
  return {
    accountId: found.account.id,
    email: found.account.email,
    emailVerifiedAt: found.account.emailVerifiedAt,
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
