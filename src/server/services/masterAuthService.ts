import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/passwordHash";
import { validatePassword } from "@/lib/validation/password";
import { normalizeEmail, isValidEmail } from "@/lib/validation/email";
import { normalizeMasterId, isValidMasterId } from "@/lib/validation/masterId";
import { writeAuditEntry } from "@/server/services/auditService";
import { createMasterSession, deleteAllMasterSessions } from "@/server/services/masterSessionService";

function generateTemporaryPassword(): string {
  // research.md #5: same high-entropy-random shape as a session token
  // (sessionService.ts's generateSessionToken) — displayed once, never
  // retrievable again (Edge Cases).
  return randomBytes(16).toString("base64url");
}

export type CreateMasterResult =
  | { ok: true; master: { id: string; masterId: string }; temporaryPassword: string }
  | { ok: false; reason: "invalid_master_id" }
  | { ok: false; reason: "invalid_email" }
  | { ok: false; reason: "master_id_already_in_use" }
  | { ok: false; reason: "email_already_in_use" }
  | { ok: false; reason: "bootstrap_already_completed" };

export interface CreateMasterInput {
  masterId: string;
  email: string;
  /** null only for the bootstrap MASTER (FR-007). */
  createdByMasterId: string | null;
}

/**
 * FR-007–FR-010, research.md #4: creates a new dedicated MasterIdentity —
 * used both by the one-time bootstrap script (scripts/bootstrap-master.ts,
 * createdByMasterId: null) and by an already-authenticated MASTER creating
 * another (createdByMasterId: caller's id). Cross-store email uniqueness
 * (research.md #4, Constitution v4.1.0 Principle IX) is checked against
 * both MasterIdentity.email and Account.email before insert. Rejections
 * write an independent FAILURE audit entry (research.md #6) — the SUCCESS
 * entry commits atomically with the insert.
 */
export async function createMaster(input: CreateMasterInput): Promise<CreateMasterResult> {
  if (input.createdByMasterId === null) {
    const existingCount = await prisma.masterIdentity.count();
    if (existingCount > 0) {
      await writeAuditEntry(prisma, {
        actorType: "SYSTEM",
        action: "master.create",
        targetType: "MasterIdentity",
        outcome: "FAILURE",
        detail: { reason: "bootstrap_already_completed" },
      });
      return { ok: false, reason: "bootstrap_already_completed" };
    }
  }

  if (!isValidMasterId(input.masterId)) {
    await writeFailure(input.createdByMasterId, "invalid_master_id");
    return { ok: false, reason: "invalid_master_id" };
  }
  if (!isValidEmail(input.email)) {
    await writeFailure(input.createdByMasterId, "invalid_email");
    return { ok: false, reason: "invalid_email" };
  }

  const normalizedMasterId = normalizeMasterId(input.masterId);
  const normalizedEmail = normalizeEmail(input.email);

  const [existingMasterById, existingMasterByEmail, existingAccountByEmail] = await Promise.all([
    prisma.masterIdentity.findUnique({ where: { masterId: normalizedMasterId } }),
    prisma.masterIdentity.findUnique({ where: { email: normalizedEmail } }),
    prisma.account.findUnique({ where: { email: normalizedEmail } }),
  ]);

  if (existingMasterById) {
    await writeFailure(input.createdByMasterId, "master_id_already_in_use");
    return { ok: false, reason: "master_id_already_in_use" };
  }
  if (existingMasterByEmail || existingAccountByEmail) {
    await writeFailure(input.createdByMasterId, "email_already_in_use");
    return { ok: false, reason: "email_already_in_use" };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const master = await prisma.$transaction(async (tx) => {
    const created = await tx.masterIdentity.create({
      data: {
        masterId: normalizedMasterId,
        email: normalizedEmail,
        passwordHash,
        createdByMasterId: input.createdByMasterId,
      },
    });
    await writeAuditEntry(tx, {
      actorType: input.createdByMasterId ? "MASTER" : "SYSTEM",
      actorMasterId: input.createdByMasterId,
      action: "master.create",
      targetType: "MasterIdentity",
      targetId: created.id,
      outcome: "SUCCESS",
      detail: { masterId: created.masterId, email: created.email },
    });
    return created;
  });

  return {
    ok: true,
    master: { id: master.id, masterId: master.masterId },
    temporaryPassword,
  };
}

async function writeFailure(
  actorMasterId: string | null,
  reason: string,
  targetId?: string,
): Promise<void> {
  await writeAuditEntry(prisma, {
    actorType: actorMasterId ? "MASTER" : "SYSTEM",
    actorMasterId,
    action: "master.create",
    targetType: "MasterIdentity",
    targetId,
    outcome: "FAILURE",
    detail: { reason },
  });
}

export type SignInAsMasterResult =
  | { ok: true; sessionToken: string; expiresAt: Date; mustChangePassword: boolean }
  | { ok: false; reason: "invalid_credentials" };

/**
 * FR-003, research.md #11: one generic failure for wrong masterId, wrong
 * password, and a DISABLED identity — never distinguishing which, mirroring
 * accountService.ts's signInWithPassword() anti-enumeration shape.
 */
export async function signInAsMaster(masterId: string, password: string): Promise<SignInAsMasterResult> {
  const master = await prisma.masterIdentity.findUnique({
    where: { masterId: normalizeMasterId(masterId) },
  });

  if (!master || master.status !== "ACTIVE" || !(await verifyPassword(master.passwordHash, password))) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const session = await createMasterSession(master.id);
  return {
    ok: true,
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt,
    mustChangePassword: master.mustChangePassword,
  };
}

export type ChangeMasterPasswordResult =
  | { ok: true }
  | { ok: false; reason: "invalid_current_password" }
  | { ok: false; reason: "invalid_password"; passwordReason: "too_short" | "breached" };

/** FR-010, FR-011: the route that clears mustChangePassword — reachable even while it's true. */
export async function changeMasterPassword(
  masterId: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangeMasterPasswordResult> {
  const master = await prisma.masterIdentity.findUnique({ where: { id: masterId } });
  if (!master || !(await verifyPassword(master.passwordHash, currentPassword))) {
    return { ok: false, reason: "invalid_current_password" };
  }

  const passwordCheck = await validatePassword(newPassword);
  if (!passwordCheck.valid) {
    return { ok: false, reason: "invalid_password", passwordReason: passwordCheck.reason };
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.masterIdentity.update({
    where: { id: masterId },
    data: { passwordHash, mustChangePassword: false },
  });

  return { ok: true };
}

export type DisableMasterResult =
  | { ok: true }
  | { ok: false; reason: "cannot_disable_self" }
  | { ok: false; reason: "last_active_master" };

/**
 * FR-013, FR-014, research.md #6's worked example, research.md #11: the
 * self-disable guard is checked before any transaction opens (its FAILURE
 * entry is written independently, trivially, since nothing was ever
 * attempted); the last-MASTER guard is checked inside the same transaction
 * as the count-then-update, and its FAILURE entry is written independently
 * AFTER that transaction aborts — never nested inside it, so the rejected
 * attempt's own record survives the rollback it describes.
 */
export async function disableMaster(
  callerMasterId: string,
  targetMasterId: string,
): Promise<DisableMasterResult> {
  if (targetMasterId === callerMasterId) {
    await writeAuditEntry(prisma, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "master.disable",
      targetType: "MasterIdentity",
      targetId: targetMasterId,
      outcome: "FAILURE",
      detail: { reason: "cannot_disable_self" },
    });
    return { ok: false, reason: "cannot_disable_self" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const target = await tx.masterIdentity.findUnique({ where: { id: targetMasterId } });
      if (target?.status === "ACTIVE") {
        const activeCount = await tx.masterIdentity.count({ where: { status: "ACTIVE" } });
        if (activeCount <= 1) {
          throw new LastActiveMasterError();
        }
      }

      await tx.masterIdentity.update({
        where: { id: targetMasterId },
        data: { status: "DISABLED", statusChangedAt: new Date() },
      });
      await writeAuditEntry(tx, {
        actorType: "MASTER",
        actorMasterId: callerMasterId,
        action: "master.disable",
        targetType: "MasterIdentity",
        targetId: targetMasterId,
        outcome: "SUCCESS",
      });
    });
    await deleteAllMasterSessions(targetMasterId);
    return { ok: true };
  } catch (error) {
    if (error instanceof LastActiveMasterError) {
      await writeAuditEntry(prisma, {
        actorType: "MASTER",
        actorMasterId: callerMasterId,
        action: "master.disable",
        targetType: "MasterIdentity",
        targetId: targetMasterId,
        outcome: "FAILURE",
        detail: { reason: "last_active_master" },
      });
      return { ok: false, reason: "last_active_master" };
    }
    throw error;
  }
}

class LastActiveMasterError extends Error {}

export type ReactivateMasterResult = { ok: true } | { ok: false; reason: "not_found" };

export async function reactivateMaster(
  callerMasterId: string,
  targetMasterId: string,
): Promise<ReactivateMasterResult> {
  const target = await prisma.masterIdentity.findUnique({ where: { id: targetMasterId } });
  if (!target) return { ok: false, reason: "not_found" };

  await prisma.$transaction(async (tx) => {
    await tx.masterIdentity.update({
      where: { id: targetMasterId },
      data: { status: "ACTIVE", statusChangedAt: new Date() },
    });
    await writeAuditEntry(tx, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "master.reactivate",
      targetType: "MasterIdentity",
      targetId: targetMasterId,
      outcome: "SUCCESS",
    });
  });

  return { ok: true };
}

export type ResetMasterPasswordResult =
  | { ok: true; temporaryPassword: string }
  | { ok: false; reason: "not_found" };

/** FR-011: revokes every existing session for the target and forces a fresh first-login change. */
export async function resetMasterPassword(
  callerMasterId: string,
  targetMasterId: string,
): Promise<ResetMasterPasswordResult> {
  const target = await prisma.masterIdentity.findUnique({ where: { id: targetMasterId } });
  if (!target) return { ok: false, reason: "not_found" };

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.$transaction(async (tx) => {
    await tx.masterIdentity.update({
      where: { id: targetMasterId },
      data: { passwordHash, mustChangePassword: true },
    });
    await writeAuditEntry(tx, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "master.resetPassword",
      targetType: "MasterIdentity",
      targetId: targetMasterId,
      outcome: "SUCCESS",
    });
  });
  await deleteAllMasterSessions(targetMasterId);

  return { ok: true, temporaryPassword };
}
