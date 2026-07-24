import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isValidCommunityName } from "@/lib/validation/communityName";
import { isValidEmail, normalizeEmail } from "@/lib/validation/email";
import { hashPassword } from "@/lib/auth/passwordHash";
import { writeAuditEntry } from "@/server/services/auditService";

function generateTemporaryPassword(): string {
  return randomBytes(16).toString("base64url");
}

export type CreateCommunityAsMasterInput = {
  callerMasterId: string;
  name: string;
} & (
  | { administrator: { mode: "existing"; email: string } }
  | { administrator: { mode: "provision"; email: string; displayName: string } }
);

export type CreateCommunityAsMasterResult =
  | { ok: true; community: { id: string; name: string }; temporaryPassword?: string }
  | { ok: false; reason: "invalid_name" }
  | { ok: false; reason: "invalid_email" }
  | { ok: false; reason: "account_not_found" }
  | { ok: false; reason: "account_not_verified" }
  | { ok: false; reason: "account_already_exists" };

/**
 * FR-022–FR-026, research.md #10/#12: a MASTER creates a community and its
 * founding administrator atomically — either an existing verified Account
 * (mirrors 003-community-creation's createCommunity(), but this is a
 * distinct function since that one's "existing account only" contract is
 * architecturally enforced elsewhere, research.md #12) or a newly
 * provisioned one (already verified, no VerificationToken row created,
 * research.md #10 — nothing is left pending to hijack). All four writes
 * (account if provisioning, community, membership, audit entry) share one
 * transaction — FR-026's "all four or none."
 */
export async function createCommunityAsMaster(
  input: CreateCommunityAsMasterInput,
): Promise<CreateCommunityAsMasterResult> {
  if (!isValidCommunityName(input.name)) {
    await writeFailure(input.callerMasterId, "invalid_name");
    return { ok: false, reason: "invalid_name" };
  }
  if (!isValidEmail(input.administrator.email)) {
    await writeFailure(input.callerMasterId, "invalid_email");
    return { ok: false, reason: "invalid_email" };
  }

  const normalizedEmail = normalizeEmail(input.administrator.email);
  const existingAccount = await prisma.account.findUnique({ where: { email: normalizedEmail } });

  if (input.administrator.mode === "existing") {
    if (!existingAccount) {
      await writeFailure(input.callerMasterId, "account_not_found");
      return { ok: false, reason: "account_not_found" };
    }
    if (!existingAccount.emailVerifiedAt) {
      await writeFailure(input.callerMasterId, "account_not_verified");
      return { ok: false, reason: "account_not_verified" };
    }

    const result = await prisma.$transaction(async (tx) => {
      const community = await tx.community.create({
        data: { name: input.name, createdByOperator: `master:${input.callerMasterId}` },
      });
      await tx.membership.create({
        data: {
          accountId: existingAccount.id,
          communityId: community.id,
          role: "ADMINISTRATOR",
          operationalEpoch: community.operationalEpoch,
        },
      });
      await writeAuditEntry(tx, {
        actorType: "MASTER",
        actorMasterId: input.callerMasterId,
        action: "community.create",
        targetType: "Community",
        targetId: community.id,
        outcome: "SUCCESS",
        detail: { name: community.name, administratorMode: "existing", administratorAccountId: existingAccount.id },
      });
      return community;
    });

    return { ok: true, community: { id: result.id, name: result.name } };
  }

  // mode === "provision"
  if (existingAccount) {
    await writeFailure(input.callerMasterId, "account_already_exists");
    return { ok: false, reason: "account_already_exists" };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.account.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        emailVerifiedAt: new Date(),
        displayName: input.administrator.mode === "provision" ? input.administrator.displayName : undefined,
      },
    });
    const community = await tx.community.create({
      data: { name: input.name, createdByOperator: `master:${input.callerMasterId}` },
    });
    await tx.membership.create({
      data: {
        accountId: account.id,
        communityId: community.id,
        role: "ADMINISTRATOR",
        operationalEpoch: community.operationalEpoch,
      },
    });
    await writeAuditEntry(tx, {
      actorType: "MASTER",
      actorMasterId: input.callerMasterId,
      action: "community.create",
      targetType: "Community",
      targetId: community.id,
      outcome: "SUCCESS",
      detail: { name: community.name, administratorMode: "provision", administratorAccountId: account.id },
    });
    return community;
  });

  return { ok: true, community: { id: result.id, name: result.name }, temporaryPassword };
}

async function writeFailure(callerMasterId: string, reason: string): Promise<void> {
  await writeAuditEntry(prisma, {
    actorType: "MASTER",
    actorMasterId: callerMasterId,
    action: "community.create",
    targetType: "Community",
    outcome: "FAILURE",
    detail: { reason },
  });
}

const SUSPENSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export type SuspendCommunityResult =
  | { ok: true; community: { id: string; status: "SUSPENDED"; suspendedAt: Date; archiveScheduledAt: Date } }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_reason" }
  | { ok: false; reason: "not_active" };

/**
 * FR-050, FR-051, FR-056: only an active MASTER may suspend, and only an
 * `ACTIVE` community — re-suspending an already-`SUSPENDED` one is rejected
 * rather than silently pushing `archiveScheduledAt` forward. Touches only
 * `Community` fields — no `Membership`/`Listing`/`MessageThread`/`Invitation`
 * row is ever written here (research.md #8).
 */
export async function suspendCommunity(
  callerMasterId: string,
  communityId: string,
  reason: string,
): Promise<SuspendCommunityResult> {
  const community = await prisma.community.findUnique({ where: { id: communityId } });
  if (!community) return { ok: false, reason: "not_found" };
  if (reason.trim().length === 0) {
    await writeLifecycleFailure(callerMasterId, communityId, "community.suspend", "invalid_reason");
    return { ok: false, reason: "invalid_reason" };
  }
  if (community.status !== "ACTIVE") {
    await writeLifecycleFailure(callerMasterId, communityId, "community.suspend", "not_active");
    return { ok: false, reason: "not_active" };
  }

  const suspendedAt = new Date();
  const archiveScheduledAt = new Date(suspendedAt.getTime() + SUSPENSION_DURATION_MS);

  await prisma.$transaction(async (tx) => {
    await tx.community.update({
      where: { id: communityId },
      data: { status: "SUSPENDED", suspendedAt, suspensionReason: reason, archiveScheduledAt },
    });
    await writeAuditEntry(tx, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "community.suspend",
      targetType: "Community",
      targetId: communityId,
      outcome: "SUCCESS",
      detail: { reason },
    });
  });

  return { ok: true, community: { id: communityId, status: "SUSPENDED", suspendedAt, archiveScheduledAt } };
}

export type ReactivateCommunityResult =
  | { ok: true; community: { id: string; status: "ACTIVE" } }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_suspended" };

/** FR-055: cancels the scheduled archival and restores normal function. Only a MASTER — never a community administrator. */
export async function reactivateCommunity(
  callerMasterId: string,
  communityId: string,
): Promise<ReactivateCommunityResult> {
  const community = await prisma.community.findUnique({ where: { id: communityId } });
  if (!community) return { ok: false, reason: "not_found" };
  if (community.status !== "SUSPENDED") {
    await writeLifecycleFailure(callerMasterId, communityId, "community.reactivate", "not_suspended");
    return { ok: false, reason: "not_suspended" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.community.update({
      where: { id: communityId },
      data: { status: "ACTIVE", suspendedAt: null, suspensionReason: null, archiveScheduledAt: null },
    });
    await writeAuditEntry(tx, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "community.reactivate",
      targetType: "Community",
      targetId: communityId,
      outcome: "SUCCESS",
    });
  });

  return { ok: true, community: { id: communityId, status: "ACTIVE" } };
}

async function writeLifecycleFailure(
  callerMasterId: string,
  communityId: string,
  action: "community.suspend" | "community.reactivate" | "community.restore",
  reason: string,
): Promise<void> {
  await writeAuditEntry(prisma, {
    actorType: "MASTER",
    actorMasterId: callerMasterId,
    action,
    targetType: "Community",
    targetId: communityId,
    outcome: "FAILURE",
    detail: { reason },
  });
}

export interface ArchiveDueSuspendedCommunitiesResult {
  archivedCommunityIds: string[];
}

/**
 * FR-057, FR-058, research.md #7/#8: for each community whose
 * `archiveScheduledAt` has passed, re-verifies inside its own transaction
 * that it is *still* `SUSPENDED` under that same cycle before flipping to
 * `ARCHIVED` — a stale/duplicate job run, or a community reactivated in the
 * meantime, is a safe no-op rather than a double transition. Touches only
 * the `Community` row itself — no `Listing`/`MessageThread`/`Invitation`/
 * `Membership` row is ever written (research.md #8's "consequence" note:
 * archival needs no bulk update because operationalEpoch, not row status,
 * is what keeps pre-archive content non-operational after a later restore).
 */
export async function archiveDueSuspendedCommunities(): Promise<ArchiveDueSuspendedCommunitiesResult> {
  const due = await prisma.community.findMany({
    where: { status: "SUSPENDED", archiveScheduledAt: { lte: new Date() } },
    select: { id: true },
  });

  const archivedCommunityIds: string[] = [];
  for (const { id } of due) {
    const archived = await prisma.$transaction(async (tx) => {
      const community = await tx.community.findUnique({ where: { id } });
      if (!community || community.status !== "SUSPENDED" || !community.archiveScheduledAt) {
        return false;
      }
      if (community.archiveScheduledAt.getTime() > Date.now()) {
        return false;
      }

      await tx.community.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      await writeAuditEntry(tx, {
        actorType: "SYSTEM",
        action: "community.archive",
        targetType: "Community",
        targetId: id,
        outcome: "SUCCESS",
      });
      return true;
    });
    if (archived) archivedCommunityIds.push(id);
  }

  return { archivedCommunityIds };
}

export type RestoreCommunityResult =
  | { ok: true; community: { id: string; status: "ACTIVE" }; administrator: { accountId: string; displayName: string | null } }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_archived" }
  | { ok: false; reason: "administrator_not_eligible" };

/**
 * FR-062–FR-065, research.md #8: restoring an archived community opens a new
 * operational epoch. Only the selected membership — which MUST have been an
 * ADMINISTRATOR at the epoch being restored from, with an account that is
 * neither SUSPENDED nor soft-deleted — is moved into the new epoch; every
 * other Listing/MessageThread/Invitation/Membership row keeps its old epoch
 * forever, which is what keeps them historical (research.md #8's
 * "consequence" note — this is the one place that note's exception applies).
 */
export async function restoreCommunity(
  callerMasterId: string,
  communityId: string,
  administratorMembershipId: string,
): Promise<RestoreCommunityResult> {
  const community = await prisma.community.findUnique({ where: { id: communityId } });
  if (!community) return { ok: false, reason: "not_found" };
  if (community.status !== "ARCHIVED") {
    await writeLifecycleFailure(callerMasterId, communityId, "community.restore", "not_archived");
    return { ok: false, reason: "not_archived" };
  }

  const selected = await prisma.membership.findUnique({
    where: { id: administratorMembershipId },
    include: { account: true },
  });
  const eligible =
    selected &&
    selected.communityId === communityId &&
    selected.role === "ADMINISTRATOR" &&
    selected.operationalEpoch === community.operationalEpoch &&
    selected.account.status === "ACTIVE" &&
    selected.account.deletedAt === null;

  if (!selected || !eligible) {
    await writeLifecycleFailure(callerMasterId, communityId, "community.restore", "administrator_not_eligible");
    return { ok: false, reason: "administrator_not_eligible" };
  }

  const newEpoch = community.operationalEpoch + 1;

  await prisma.$transaction(async (tx) => {
    await tx.community.update({
      where: { id: communityId },
      data: { status: "ACTIVE", archivedAt: null, operationalEpoch: newEpoch },
    });
    await tx.membership.update({
      where: { id: administratorMembershipId },
      data: { operationalEpoch: newEpoch },
    });
    await writeAuditEntry(tx, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "community.restore",
      targetType: "Community",
      targetId: communityId,
      outcome: "SUCCESS",
      detail: { administratorAccountId: selected.accountId, newOperationalEpoch: newEpoch },
    });
  });

  return {
    ok: true,
    community: { id: communityId, status: "ACTIVE" },
    administrator: { accountId: selected.accountId, displayName: selected.account.displayName },
  };
}
