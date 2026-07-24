import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { hashPassword } from "@/lib/auth/passwordHash";
import { randomBytes } from "node:crypto";
import { normalizeEmail, isValidEmail } from "@/lib/validation/email";
import { writeAuditEntry } from "@/server/services/auditService";

function generateTemporaryPassword(): string {
  return randomBytes(16).toString("base64url");
}

export type GetCommunityForMasterResult =
  | {
      ok: true;
      community: {
        id: string;
        name: string;
        status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
        createdAt: Date;
        suspendedAt: Date | null;
        suspensionReason: string | null;
        archiveScheduledAt: Date | null;
        archivedAt: Date | null;
      };
      memberships: {
        id: string;
        accountId: string;
        displayName: string | null;
        email: string;
        role: "ADMINISTRATOR" | "MEMBER";
        isCurrent: boolean;
        /** FR-062: eligible to be selected as the one restored administrator (only meaningful when the community is ARCHIVED). */
        eligibleForRestoration: boolean;
      }[];
    }
  | { ok: false; reason: "not_found" };

/**
 * FR-027, data-model.md's `isCurrent` (derived, never a stored status,
 * research.md #8): a MASTER may inspect any community regardless of state,
 * including its historical (non-current-epoch) memberships once it has been
 * through a restoration — without ever gaining a Membership itself.
 */
export async function getCommunityForMaster(communityId: string): Promise<GetCommunityForMasterResult> {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    include: {
      memberships: { include: { account: true } },
    },
  });
  if (!community) return { ok: false, reason: "not_found" };

  return {
    ok: true,
    community: {
      id: community.id,
      name: community.name,
      status: community.status,
      createdAt: community.createdAt,
      suspendedAt: community.suspendedAt,
      suspensionReason: community.suspensionReason,
      archiveScheduledAt: community.archiveScheduledAt,
      archivedAt: community.archivedAt,
    },
    memberships: community.memberships.map((m) => ({
      id: m.id,
      accountId: m.accountId,
      displayName: m.account.displayName,
      email: m.account.email,
      role: m.role,
      isCurrent: m.operationalEpoch === community.operationalEpoch,
      eligibleForRestoration:
        m.role === "ADMINISTRATOR" &&
        m.operationalEpoch === community.operationalEpoch &&
        m.account.status === "ACTIVE" &&
        m.account.deletedAt === null,
    })),
  };
}

export type EditCommunityResult =
  | { ok: true; community: { id: string; name: string } }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_name" };

/** FR-028: audit entry records prior and new values (Story 5, Scenario 1). */
export async function editCommunity(
  callerMasterId: string,
  communityId: string,
  updates: { name?: string },
): Promise<EditCommunityResult> {
  const before = await prisma.community.findUnique({ where: { id: communityId } });
  if (!before) return { ok: false, reason: "not_found" };
  if (updates.name !== undefined && updates.name.trim().length === 0) {
    return { ok: false, reason: "invalid_name" };
  }

  const after = await prisma.$transaction(async (tx) => {
    const updated = await tx.community.update({
      where: { id: communityId },
      data: updates.name !== undefined ? { name: updates.name } : {},
    });
    await writeAuditEntry(tx, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "community.edit",
      targetType: "Community",
      targetId: communityId,
      outcome: "SUCCESS",
      detail: { before: { name: before.name }, after: { name: updated.name } },
    });
    return updated;
  });

  return { ok: true, community: { id: after.id, name: after.name } };
}

export type PromoteMembershipResult =
  | { ok: true }
  | { ok: false; reason: "not_eligible" };

/** FR-031: promotes a current member to ADMINISTRATOR. */
export async function promoteMembershipAsMaster(
  callerMasterId: string,
  communityId: string,
  membershipId: string,
): Promise<PromoteMembershipResult> {
  const community = await prisma.community.findUnique({ where: { id: communityId } });
  const target = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (
    !community ||
    !target ||
    target.communityId !== communityId ||
    target.operationalEpoch !== community.operationalEpoch
  ) {
    return { ok: false, reason: "not_eligible" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: membershipId }, data: { role: "ADMINISTRATOR" } });
    await writeAuditEntry(tx, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "membership.promote",
      targetType: "Membership",
      targetId: membershipId,
      outcome: "SUCCESS",
    });
  });

  return { ok: true };
}

export type RemoveMembershipDisposition = "demote" | "revoke_membership" | "disable_account" | "delete_account";

export type RemoveMembershipResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "would_orphan_community" };

/**
 * FR-032: removing/replacing an administrator requires an explicit
 * disposition. FR-030: rejects leaving the community with zero active
 * administrators unless a replacement is promoted in the same call.
 */
export async function removeMembershipAsMaster(
  callerMasterId: string,
  communityId: string,
  membershipId: string,
  options: { disposition: RemoveMembershipDisposition; replacementAdministratorMembershipId?: string },
): Promise<RemoveMembershipResult> {
  const community = await prisma.community.findUnique({ where: { id: communityId } });
  const target = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!community || !target || target.communityId !== communityId) {
    return { ok: false, reason: "not_found" };
  }

  if (target.role === "ADMINISTRATOR" && target.operationalEpoch === community.operationalEpoch) {
    const activeAdminCount = await prisma.membership.count({
      where: { communityId, role: "ADMINISTRATOR", operationalEpoch: community.operationalEpoch },
    });
    if (activeAdminCount <= 1) {
      if (!options.replacementAdministratorMembershipId) {
        await writeAuditEntry(prisma, {
          actorType: "MASTER",
          actorMasterId: callerMasterId,
          action: "membership.remove",
          targetType: "Membership",
          targetId: membershipId,
          outcome: "FAILURE",
          detail: { reason: "would_orphan_community" },
        });
        return { ok: false, reason: "would_orphan_community" };
      }
      await prisma.membership.update({
        where: { id: options.replacementAdministratorMembershipId },
        data: { role: "ADMINISTRATOR" },
      });
    }
  }

  await applyDisposition(callerMasterId, target.accountId, communityId, membershipId, options.disposition);

  await writeAuditEntry(prisma, {
    actorType: "MASTER",
    actorMasterId: callerMasterId,
    action: "membership.remove",
    targetType: "Membership",
    targetId: membershipId,
    outcome: "SUCCESS",
    detail: { disposition: options.disposition },
  });

  return { ok: true };
}

async function applyDisposition(
  callerMasterId: string,
  accountId: string,
  communityId: string,
  membershipId: string,
  disposition: RemoveMembershipDisposition,
): Promise<void> {
  switch (disposition) {
    case "demote":
      await prisma.membership.update({ where: { id: membershipId }, data: { role: "MEMBER" } });
      return;
    case "revoke_membership":
      await prisma.membership.delete({ where: { id: membershipId } });
      return;
    case "disable_account":
      await suspendAccount(callerMasterId, accountId, {});
      return;
    case "delete_account":
      await deleteAccount(callerMasterId, accountId, {});
      return;
  }
}

export type AccountAdministratorAssignment = { communityId: string; membershipId: string };

export type SuspendAccountResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "would_orphan_communities"; affectedCommunityIds: string[] };

/**
 * research.md #9: only ordinary marketplace access is revoked — the
 * Account row, its memberships, and all historical content are retained.
 * FR-046: rejected if this account is the last active administrator of any
 * community unless replacement assignments for every affected community are
 * supplied in the same call (User Story 5 scopes this to whichever single
 * community the caller is acting from; User Story 7 generalizes it to every
 * affected community at once — same function, same guard).
 */
export async function suspendAccount(
  callerMasterId: string,
  accountId: string,
  options: { replacementAdministratorAssignments?: AccountAdministratorAssignment[] },
): Promise<SuspendAccountResult> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, reason: "not_found" };

  const orphanCheck = await findOrphanedCommunities(accountId, options.replacementAdministratorAssignments ?? []);
  if (orphanCheck.length > 0) {
    await writeAuditEntry(prisma, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "account.suspend",
      targetType: "Account",
      targetId: accountId,
      outcome: "FAILURE",
      detail: { reason: "would_orphan_communities", affectedCommunityIds: orphanCheck },
    });
    return { ok: false, reason: "would_orphan_communities", affectedCommunityIds: orphanCheck };
  }

  await prisma.$transaction(async (tx) => {
    await applyReplacementAssignments(tx, options.replacementAdministratorAssignments ?? []);
    await tx.account.update({ where: { id: accountId }, data: { status: "SUSPENDED" } });
    await tx.session.deleteMany({ where: { accountId } });
    await writeAuditEntry(tx, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "account.suspend",
      targetType: "Account",
      targetId: accountId,
      outcome: "SUCCESS",
    });
  });

  return { ok: true };
}

export type ReactivateAccountResult = { ok: true } | { ok: false; reason: "not_found" };

export async function reactivateAccount(callerMasterId: string, accountId: string): Promise<ReactivateAccountResult> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, reason: "not_found" };

  await prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: accountId }, data: { status: "ACTIVE" } });
    await writeAuditEntry(tx, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "account.reactivate",
      targetType: "Account",
      targetId: accountId,
      outcome: "SUCCESS",
    });
  });

  return { ok: true };
}

export type ResetAccountPasswordResult =
  | { ok: true; temporaryPassword: string }
  | { ok: false; reason: "not_found" };

export async function resetAccountPassword(
  callerMasterId: string,
  accountId: string,
): Promise<ResetAccountPasswordResult> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, reason: "not_found" };

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: accountId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { accountId } });
    await writeAuditEntry(tx, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "account.resetPassword",
      targetType: "Account",
      targetId: accountId,
      outcome: "SUCCESS",
    });
  });

  return { ok: true, temporaryPassword };
}

export type EditAccountResult =
  | { ok: true; account: { id: string; email: string; displayName: string | null } }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_email" }
  | { ok: false; reason: "email_already_in_use" };

/**
 * FR-045: changing email MUST NOT transfer/rewrite any existing Invitation
 * row (research.md #14) — this function only ever touches Account, never
 * Invitation, so that guarantee holds by omission.
 */
export async function editAccount(
  callerMasterId: string,
  accountId: string,
  updates: { displayName?: string; email?: string },
): Promise<EditAccountResult> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, reason: "not_found" };

  let normalizedEmail: string | undefined;
  if (updates.email !== undefined) {
    if (!isValidEmail(updates.email)) return { ok: false, reason: "invalid_email" };
    normalizedEmail = normalizeEmail(updates.email);
    const existing = await prisma.account.findUnique({ where: { email: normalizedEmail } });
    if (existing && existing.id !== accountId) return { ok: false, reason: "email_already_in_use" };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.account.update({
      where: { id: accountId },
      data: {
        ...(updates.displayName !== undefined ? { displayName: updates.displayName } : {}),
        ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
      },
    });
    await writeAuditEntry(tx, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "account.edit",
      targetType: "Account",
      targetId: accountId,
      outcome: "SUCCESS",
      detail: { before: { email: account.email, displayName: account.displayName }, after: { email: result.email, displayName: result.displayName } },
    });
    return result;
  });

  return { ok: true, account: { id: updated.id, email: updated.email, displayName: updated.displayName } };
}

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "would_orphan_communities"; affectedCommunityIds: string[] };

/**
 * FR-034, research.md #9: soft delete — the Account row and every FK to it
 * (Listing.ownerId, Message.senderId, Membership.accountId,
 * Invitation.invitedBy) are retained; only authentication capability and
 * personal sign-in identifiers are removed. `email` is overwritten with a
 * non-reusable synthetic value, freeing the original for reuse (Edge Cases).
 */
export async function deleteAccount(
  callerMasterId: string,
  accountId: string,
  options: { replacementAdministratorAssignments?: AccountAdministratorAssignment[] },
): Promise<DeleteAccountResult> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, reason: "not_found" };

  const orphanCheck = await findOrphanedCommunities(accountId, options.replacementAdministratorAssignments ?? []);
  if (orphanCheck.length > 0) {
    await writeAuditEntry(prisma, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "account.delete",
      targetType: "Account",
      targetId: accountId,
      outcome: "FAILURE",
      detail: { reason: "would_orphan_communities", affectedCommunityIds: orphanCheck },
    });
    return { ok: false, reason: "would_orphan_communities", affectedCommunityIds: orphanCheck };
  }

  await prisma.$transaction(async (tx) => {
    await applyReplacementAssignments(tx, options.replacementAdministratorAssignments ?? []);
    await tx.account.update({
      where: { id: accountId },
      data: { email: `deleted-${accountId}@deleted.cmarket.invalid`, passwordHash: null, deletedAt: new Date() },
    });
    await tx.authIdentity.deleteMany({ where: { accountId } });
    await tx.session.deleteMany({ where: { accountId } });
    await tx.verificationToken.deleteMany({ where: { accountId } });
    await writeAuditEntry(tx, {
      actorType: "MASTER",
      actorMasterId: callerMasterId,
      action: "account.delete",
      targetType: "Account",
      targetId: accountId,
      outcome: "SUCCESS",
    });
  });

  return { ok: true };
}

/**
 * Every community where `accountId` is currently the sole active
 * administrator, excluding any community for which a valid replacement
 * assignment was supplied in the same call.
 */
async function findOrphanedCommunities(
  accountId: string,
  assignments: AccountAdministratorAssignment[],
): Promise<string[]> {
  const assignedCommunityIds = new Set(assignments.map((a) => a.communityId));

  const adminMemberships = await prisma.membership.findMany({
    where: { accountId, role: "ADMINISTRATOR" },
    include: { community: { select: { operationalEpoch: true } } },
  });

  const affected: string[] = [];
  for (const membership of adminMemberships) {
    if (membership.operationalEpoch !== membership.community.operationalEpoch) continue; // not current
    if (assignedCommunityIds.has(membership.communityId)) continue; // replacement supplied

    const otherActiveAdmins = await prisma.membership.count({
      where: {
        communityId: membership.communityId,
        role: "ADMINISTRATOR",
        operationalEpoch: membership.community.operationalEpoch,
        accountId: { not: accountId },
      },
    });
    if (otherActiveAdmins === 0) affected.push(membership.communityId);
  }
  return affected;
}

async function applyReplacementAssignments(
  tx: Prisma.TransactionClient,
  assignments: AccountAdministratorAssignment[],
): Promise<void> {
  for (const assignment of assignments) {
    await tx.membership.update({ where: { id: assignment.membershipId }, data: { role: "ADMINISTRATOR" } });
  }
}

export type ListCommunitiesForMasterResult = {
  ok: true;
  communities: {
    id: string;
    name: string;
    status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
    createdAt: Date;
    memberCount: number;
  }[];
};

export async function listCommunitiesForMaster(options: {
  status?: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
} = {}): Promise<ListCommunitiesForMasterResult> {
  const communities = await prisma.community.findMany({
    where: options.status ? { status: options.status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { memberships: true } } },
  });

  return {
    ok: true,
    communities: communities.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      createdAt: c.createdAt,
      memberCount: c._count.memberships,
    })),
  };
}

export type ListAccountsForMasterResult = {
  ok: true;
  accounts: {
    id: string;
    email: string;
    displayName: string | null;
    status: "ACTIVE" | "SUSPENDED";
    deletedAt: Date | null;
    createdAt: Date;
  }[];
};

/** FR-040: paginated/searchable list for the MASTER account-management surface (User Story 7). */
export async function listAccountsForMaster(options: {
  search?: string;
} = {}): Promise<ListAccountsForMasterResult> {
  const accounts = await prisma.account.findMany({
    where: options.search
      ? { email: { contains: options.search, mode: "insensitive" } }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return {
    ok: true,
    accounts: accounts.map((a) => ({
      id: a.id,
      email: a.email,
      displayName: a.displayName,
      status: a.status,
      deletedAt: a.deletedAt,
      createdAt: a.createdAt,
    })),
  };
}

export type GetAccountForMasterResult =
  | {
      ok: true;
      account: {
        id: string;
        email: string;
        displayName: string | null;
        status: "ACTIVE" | "SUSPENDED";
        deletedAt: Date | null;
        createdAt: Date;
      };
      administeredCommunities: { communityId: string; communityName: string }[];
    }
  | { ok: false; reason: "not_found" };

/**
 * FR-047: surfaces every community this account currently administers, so a
 * MASTER can preview the multi-community impact of suspending/deleting it
 * before confirming (User Story 7).
 */
export async function getAccountForMaster(accountId: string): Promise<GetAccountForMasterResult> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, reason: "not_found" };

  const adminMemberships = await prisma.membership.findMany({
    where: { accountId, role: "ADMINISTRATOR" },
    include: { community: { select: { name: true, operationalEpoch: true } } },
  });

  return {
    ok: true,
    account: {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      status: account.status,
      deletedAt: account.deletedAt,
      createdAt: account.createdAt,
    },
    administeredCommunities: adminMemberships
      .filter((m) => m.operationalEpoch === m.community.operationalEpoch)
      .map((m) => ({ communityId: m.communityId, communityName: m.community.name })),
  };
}
