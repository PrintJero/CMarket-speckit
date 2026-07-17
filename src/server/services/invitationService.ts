import { randomBytes, createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isValidEmail, normalizeEmail, emailsMatch } from "@/lib/validation/email";
import { assertEmailVerified } from "@/server/services/accountService";
import { sendEmail } from "@/lib/email/sendEmail";

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
 * so the lookup logic exists in exactly one place.
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
 */
export async function requireCommunityAdministrator(
  accountId: string,
  communityId: string,
): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: { accountId_communityId: { accountId, communityId } },
  });
  return membership?.role === "ADMINISTRATOR";
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
 * the new one (research.md #4).
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
      },
    });
  });

  const community = await prisma.community.findUnique({ where: { id: input.communityId } });
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
  | { ok: false; reason: "already_member" };

export interface AcceptInvitationInput {
  token: string;
  accountId: string;
}

/**
 * FR-002–FR-005. The consume step is a conditional updateMany + count-check
 * (data-model.md's Invitation validation rules), not a plain read-then-write —
 * that is what makes SC-006's single-use guarantee hold under concurrent
 * acceptance attempts, mirroring consumeVerificationToken.
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(input.token) } });
  if (!invitation || invitation.consumedAt) {
    return { ok: false, reason: "invalid_or_consumed" };
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
      data: { accountId: account.id, communityId: invitation.communityId, role: "MEMBER" },
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
