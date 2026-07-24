import { randomBytes, createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isValidEmail, normalizeEmail, emailsMatch } from "@/lib/validation/email";
import { assertEmailVerified } from "@/server/services/accountService";
import { sendEmail } from "@/lib/email/sendEmail";
import type { CommunityGateOptions } from "@/server/services/listingService";

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function acceptanceLink(rawToken: string): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base}/invitations/accept?token=${encodeURIComponent(rawToken)}`;
}

export type InvitationMetadataResult =
  | { ok: true; communityName: string; email: string }
  | { ok: false; reason: "invalid_or_consumed" };

/**
 * Public, unauthenticated lookup (contracts.md's GET /api/invitations/accept):
 * the raw token itself is the secret, so revealing which email/community it
 * targets is not a new disclosure. Shared by that route and the accept page
 * so the lookup logic exists in exactly one place. Metadata lookup itself is
 * not gated by community status — only acceptance (below) is.
 */
export async function getInvitationMetadata(rawToken: string): Promise<InvitationMetadataResult> {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { community: { select: { name: true } } },
  });

  if (!invitation || invitation.consumedAt) {
    return { ok: false, reason: "invalid_or_consumed" };
  }

  return { ok: true, communityName: invitation.community.name, email: invitation.email };
}

/**
 * research.md #8: both invite and revoke require this identical per-request
 * check; kept as one shared function rather than duplicated in each.
 * 009-platform-administration, research.md #8/#15: also requires the
 * community to be ACTIVE (or SUSPENDED when the caller explicitly tolerates
 * that) and the caller's own membership to be stamped with the community's
 * *current* operationalEpoch.
 */
export async function requireCommunityAdministrator(
  accountId: string,
  communityId: string,
  options: CommunityGateOptions = {},
): Promise<boolean> {
  const community = await prisma.community.findUnique({ where: { id: communityId } });
  if (!community) return false;
  if (community.status === "ARCHIVED") return false;
  if (community.status === "SUSPENDED" && !options.allowSuspended) return false;

  const membership = await prisma.membership.findUnique({
    where: { accountId_communityId: { accountId, communityId } },
  });
  return (
    membership !== null &&
    membership.role === "ADMINISTRATOR" &&
    membership.operationalEpoch === community.operationalEpoch
  );
}

export type InviteToCommunityResult =
  | { ok: true; invitation: { id: string; email: string } }
  | { ok: false; reason: "invalid_email" }
  | { ok: false; reason: "not_administrator" }
  | { ok: false; reason: "already_member" };

export interface InviteToCommunityInput {
  communityId: string;
  email: string;
  invitedByAccountId: string;
}

/**
 * FR-001, FR-010, FR-011, FR-012. Supersedes any prior unconsumed invitation
 * for the same (email, communityId) pair in the same transaction that creates
 * the new one (research.md #4). 009-platform-administration, FR-053:
 * issuing an invitation is a growth action — requireCommunityAdministrator's
 * default (no allowSuspended) already rejects a SUSPENDED community the
 * same way it rejects a non-administrator. The new row is stamped with the
 * community's current operationalEpoch (research.md #8).
 */
export async function inviteToCommunity(
  input: InviteToCommunityInput,
): Promise<InviteToCommunityResult> {
  if (!isValidEmail(input.email)) {
    return { ok: false, reason: "invalid_email" };
  }

  if (!(await requireCommunityAdministrator(input.invitedByAccountId, input.communityId))) {
    return { ok: false, reason: "not_administrator" };
  }

  const normalizedEmail = normalizeEmail(input.email);

  const existingAccount = await prisma.account.findUnique({ where: { email: normalizedEmail } });
  if (existingAccount) {
    const existingMembership = await prisma.membership.findUnique({
      where: {
        accountId_communityId: { accountId: existingAccount.id, communityId: input.communityId },
      },
    });
    if (existingMembership) {
      return { ok: false, reason: "already_member" };
    }
  }

  const rawToken = randomBytes(32).toString("base64url");

  const community = await prisma.community.findUnique({ where: { id: input.communityId } });

  const invitation = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: { communityId: input.communityId, email: normalizedEmail, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    return tx.invitation.create({
      data: {
        communityId: input.communityId,
        email: normalizedEmail,
        tokenHash: hashToken(rawToken),
        invitedBy: input.invitedByAccountId,
        operationalEpoch: community?.operationalEpoch ?? 1,
      },
    });
  });

  await sendEmail({
    to: normalizedEmail,
    subject: `You've been invited to join ${community?.name ?? "a community"} on CMarket`,
    text: `Accept your invitation: ${acceptanceLink(rawToken)}`,
  });

  return { ok: true, invitation: { id: invitation.id, email: invitation.email } };
}

export type AcceptInvitationResult =
  | { ok: true; membership: { communityId: string; role: "MEMBER" } }
  | { ok: false; reason: "invalid_or_consumed" }
  | { ok: false; reason: "account_not_found" }
  | { ok: false; reason: "not_verified" }
  | { ok: false; reason: "email_mismatch" }
  | { ok: false; reason: "already_member" }
  | { ok: false; reason: "community_not_active" };

export interface AcceptInvitationInput {
  token: string;
  accountId: string;
}

/**
 * FR-002–FR-005. The consume step is a conditional updateMany + count-check
 * (data-model.md's Invitation validation rules), not a plain read-then-write —
 * that is what makes SC-006's single-use guarantee hold under concurrent
 * acceptance attempts, mirroring consumeVerificationToken.
 * 009-platform-administration, FR-053: acceptance (admitting a new member) is
 * blocked while the community is SUSPENDED or ARCHIVED. A pre-restoration
 * invitation (stale operationalEpoch) is rejected identically to a consumed
 * one — it can never be accepted into a later epoch (research.md #8). The
 * new Membership is stamped with the community's current operationalEpoch.
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { community: true },
  });
  if (!invitation || invitation.consumedAt) {
    return { ok: false, reason: "invalid_or_consumed" };
  }
  if (invitation.operationalEpoch !== invitation.community.operationalEpoch) {
    return { ok: false, reason: "invalid_or_consumed" };
  }
  if (invitation.community.status !== "ACTIVE") {
    return { ok: false, reason: "community_not_active" };
  }

  const account = await prisma.account.findUnique({ where: { id: input.accountId } });
  if (!account) {
    return { ok: false, reason: "account_not_found" };
  }

  if (!emailsMatch(account.email, invitation.email)) {
    return { ok: false, reason: "email_mismatch" };
  }

  if (!(await assertEmailVerified(account.id))) {
    return { ok: false, reason: "not_verified" };
  }

  const existingMembership = await prisma.membership.findUnique({
    where: { accountId_communityId: { accountId: account.id, communityId: invitation.communityId } },
  });
  if (existingMembership) {
    return { ok: false, reason: "already_member" };
  }

  return prisma.$transaction(async (tx) => {
    const consumeResult = await tx.invitation.updateMany({
      where: { id: invitation.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    if (consumeResult.count === 0) {
      return { ok: false, reason: "invalid_or_consumed" };
    }

    await tx.membership.create({
      data: {
        accountId: account.id,
        communityId: invitation.communityId,
        role: "MEMBER",
        operationalEpoch: invitation.community.operationalEpoch,
      },
    });

    return { ok: true, membership: { communityId: invitation.communityId, role: "MEMBER" } };
  });
}

export type RevokeMembershipResult =
  | { ok: true }
  | { ok: false; reason: "not_administrator" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "last_admin" }
  | { ok: false; reason: "conflict" };

export interface RevokeMembershipInput {
  communityId: string;
  membershipId: string;
  revokedByAccountId: string;
}

/**
 * FR-007, FR-009. Runs the count-then-delete last-admin guard at Serializable
 * isolation (research.md #5's correction) — plain default-isolation
 * transaction wrapping does not close the concurrent-revoke race.
 * 009-platform-administration, FR-053: removal is blocked while the
 * community is SUSPENDED/ARCHIVED — requireCommunityAdministrator's default
 * (no allowSuspended) already enforces this.
 */
export async function revokeMembership(input: RevokeMembershipInput): Promise<RevokeMembershipResult> {
  if (!(await requireCommunityAdministrator(input.revokedByAccountId, input.communityId))) {
    return { ok: false, reason: "not_administrator" };
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        const target = await tx.membership.findUnique({ where: { id: input.membershipId } });
        if (!target || target.communityId !== input.communityId) {
          return { ok: false, reason: "not_found" };
        }

        if (target.role === "ADMINISTRATOR") {
          const administratorCount = await tx.membership.count({
            where: { communityId: input.communityId, role: "ADMINISTRATOR" },
          });
          if (administratorCount <= 1) {
            return { ok: false, reason: "last_admin" };
          }
        }

        await tx.membership.delete({ where: { id: input.membershipId } });
        return { ok: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return { ok: false, reason: "conflict" };
    }
    throw error;
  }
}

export type PromoteMemberResult =
  | { ok: true }
  | { ok: false; reason: "not_administrator" }
  | { ok: false; reason: "not_eligible" };

export interface PromoteMemberInput {
  communityId: string;
  membershipId: string;
  callerAccountId: string;
}

/**
 * 009-platform-administration, User Story 6 (FR-036–FR-039): an active
 * administrator of an active community may promote an existing, *current*
 * active member of that same community — no MASTER involvement. Rejects a
 * non-current/other-community/no-membership target, and — via
 * requireCommunityAdministrator's default (no allowSuspended) — any attempt
 * while the community is SUSPENDED or ARCHIVED.
 */
export async function promoteMember(input: PromoteMemberInput): Promise<PromoteMemberResult> {
  if (!(await requireCommunityAdministrator(input.callerAccountId, input.communityId))) {
    return { ok: false, reason: "not_administrator" };
  }

  const community = await prisma.community.findUnique({ where: { id: input.communityId } });
  const target = await prisma.membership.findUnique({ where: { id: input.membershipId } });
  if (
    !community ||
    !target ||
    target.communityId !== input.communityId ||
    target.operationalEpoch !== community.operationalEpoch
  ) {
    return { ok: false, reason: "not_eligible" };
  }

  await prisma.membership.update({ where: { id: input.membershipId }, data: { role: "ADMINISTRATOR" } });
  return { ok: true };
}
