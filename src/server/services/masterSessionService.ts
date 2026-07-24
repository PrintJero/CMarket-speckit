import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { MasterIdentity } from "@prisma/client";

/**
 * research.md #1/#2: fully separate from sessionService.ts's Session/Account
 * store — a MasterSession token can never authenticate as an Account, and
 * vice versa, by construction. Same SHA-256-token-hash, 30-day-expiry shape
 * as sessionService.ts (research.md #2's rationale applies identically: a
 * high-entropy random token needs only a fast deterministic hash at rest).
 */
const MASTER_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function generateMasterSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createMasterSession(
  masterId: string,
  rawSessionToken: string = generateMasterSessionToken(),
  expiresAt: Date = new Date(Date.now() + MASTER_SESSION_MAX_AGE_MS),
): Promise<{ sessionToken: string; masterId: string; expiresAt: Date }> {
  await prisma.masterSession.create({
    data: { masterId, sessionTokenHash: hashToken(rawSessionToken), expiresAt },
  });
  return { sessionToken: rawSessionToken, masterId, expiresAt };
}

export interface ValidMasterSession {
  masterId: string;
  masterIdValue: string;
  email: string;
  mustChangePassword: boolean;
}

/**
 * Mirrors sessionService.ts's findSessionWithAccount()/getValidSession():
 * an expired session, or one whose MasterIdentity has since been disabled,
 * is treated identically to a deleted one (Story 1, Scenario 5) — a stale
 * row past expiry is cleaned up on lookup.
 */
export async function getValidMasterSession(rawSessionToken: string): Promise<ValidMasterSession | null> {
  const hashed = hashToken(rawSessionToken);
  const session = await prisma.masterSession.findUnique({
    where: { sessionTokenHash: hashed },
    include: { master: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.masterSession.delete({ where: { sessionTokenHash: hashed } }).catch(() => undefined);
    return null;
  }

  const master: MasterIdentity = session.master;
  if (master.status !== "ACTIVE") return null;

  return {
    masterId: master.id,
    masterIdValue: master.masterId,
    email: master.email,
    mustChangePassword: master.mustChangePassword,
  };
}

export async function deleteMasterSession(rawSessionToken: string): Promise<void> {
  await prisma.masterSession
    .delete({ where: { sessionTokenHash: hashToken(rawSessionToken) } })
    .catch(() => undefined);
}

/** research.md #11: disabling/resetting a MASTER revokes every one of its active sessions. */
export async function deleteAllMasterSessions(masterId: string): Promise<void> {
  await prisma.masterSession.deleteMany({ where: { masterId } });
}
