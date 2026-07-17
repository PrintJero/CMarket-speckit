import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import {
  acceptInvitation,
  inviteToCommunity,
  revokeMembership,
} from "@/server/services/invitationService";
import { getCapturedEmails } from "@/lib/email/sendEmail";

function createVerifiedAccount(email: string) {
  return prisma.account.create({
    data: { email, passwordHash: "irrelevant-hash", emailVerifiedAt: new Date() },
  });
}

function createUnverifiedAccount(email: string) {
  return prisma.account.create({ data: { email, passwordHash: null, emailVerifiedAt: null } });
}

async function createCommunityWithAdmin(communityName: string, adminEmail: string) {
  const admin = await createVerifiedAccount(adminEmail);
  const result = await createCommunity({
    name: communityName,
    founderEmail: adminEmail,
    invokedBy: "test-operator",
  });
  if (!result.ok) throw new Error(`expected community creation to succeed, got ${result.reason}`);
  return { community: result.community, admin };
}

describe("invitationService (contract)", () => {
  beforeEach(async () => {
    // Community deletion cascades to Membership and Invitation (schema.prisma).
    await prisma.community.deleteMany({ where: { name: { contains: "Invite Test Community" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "invite-membership" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("inviteToCommunity", () => {
    // T004 (US1)
    it("creates a single-use invitation for a syntactically valid, non-member email (FR-001)", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Invite Test Community One",
        "invite-membership-admin-1@example.com",
      );

      const result = await inviteToCommunity({
        communityId: community.id,
        email: "invite-membership-invitee-1@example.com",
        invitedByAccountId: admin.id,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");

      const invitations = await prisma.invitation.findMany({ where: { communityId: community.id } });
      expect(invitations).toHaveLength(1);
      expect(invitations[0].consumedAt).toBeNull();
      expect(invitations[0].email).toBe("invite-membership-invitee-1@example.com");
    });

    // T004 (FR-010)
    it("rejects a caller with no ADMINISTRATOR membership in the target community", async () => {
      const { community } = await createCommunityWithAdmin(
        "Invite Test Community Two",
        "invite-membership-admin-2@example.com",
      );
      const outsider = await createVerifiedAccount("invite-membership-outsider-2@example.com");

      const result = await inviteToCommunity({
        communityId: community.id,
        email: "invite-membership-invitee-2@example.com",
        invitedByAccountId: outsider.id,
      });

      expect(result).toEqual({ ok: false, reason: "not_administrator" });
      expect(await prisma.invitation.findMany({ where: { communityId: community.id } })).toHaveLength(0);
    });

    // T004 (FR-011)
    it("rejects inviting an email that already holds an active membership (any role) in the community", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Invite Test Community Three",
        "invite-membership-admin-3@example.com",
      );

      const result = await inviteToCommunity({
        communityId: community.id,
        email: "invite-membership-admin-3@example.com",
        invitedByAccountId: admin.id,
      });

      expect(result).toEqual({ ok: false, reason: "already_member" });
      expect(await prisma.invitation.findMany({ where: { communityId: community.id } })).toHaveLength(0);
    });

    // T004 (FR-012)
    it("supersedes a still-unconsumed prior invitation to the same (email, community) pair", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Invite Test Community Four",
        "invite-membership-admin-4@example.com",
      );
      const invitee = "invite-membership-invitee-4@example.com";

      const first = await inviteToCommunity({ communityId: community.id, email: invitee, invitedByAccountId: admin.id });
      const second = await inviteToCommunity({ communityId: community.id, email: invitee, invitedByAccountId: admin.id });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) throw new Error("expected both to succeed");
      expect(first.invitation.id).not.toBe(second.invitation.id);

      const firstRow = await prisma.invitation.findUnique({ where: { id: first.invitation.id } });
      const secondRow = await prisma.invitation.findUnique({ where: { id: second.invitation.id } });
      expect(firstRow?.consumedAt).not.toBeNull();
      expect(secondRow?.consumedAt).toBeNull();
    });

    // T004
    it("rejects a syntactically invalid email, writing nothing", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Invite Test Community Five",
        "invite-membership-admin-5@example.com",
      );

      const result = await inviteToCommunity({
        communityId: community.id,
        email: "not-an-email",
        invitedByAccountId: admin.id,
      });

      expect(result).toEqual({ ok: false, reason: "invalid_email" });
      expect(await prisma.invitation.findMany({ where: { communityId: community.id } })).toHaveLength(0);
    });
  });

  describe("acceptInvitation", () => {
    // T005 (US1)
    it("succeeds for an already-verified, exactly-matching account, and is single-use (FR-005, SC-006)", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Invite Test Community Six",
        "invite-membership-admin-6@example.com",
      );
      const invitee = await createVerifiedAccount("invite-membership-invitee-6@example.com");
      const invited = await inviteToCommunity({
        communityId: community.id,
        email: invitee.email,
        invitedByAccountId: admin.id,
      });
      if (!invited.ok) throw new Error("expected invitation to be created");

      const rawToken = await tokenFor(invited.invitation.id);
      const result = await acceptInvitation({ token: rawToken, accountId: invitee.id });

      expect(result).toEqual({ ok: true, membership: { communityId: community.id, role: "MEMBER" } });
      const memberships = await prisma.membership.findMany({
        where: { accountId: invitee.id, communityId: community.id },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe("MEMBER");

      // Second acceptance attempt, same token, different account — must fail, no second membership.
      const otherAccount = await createVerifiedAccount("invite-membership-other-6@example.com");
      const second = await acceptInvitation({ token: rawToken, accountId: otherAccount.id });
      expect(second).toEqual({ ok: false, reason: "invalid_or_consumed" });
      expect(
        await prisma.membership.findMany({ where: { communityId: community.id } }),
      ).toHaveLength(2); // admin + invitee only
    });

    // T006 (US2): no account exists for the invited email yet.
    it("rejects acceptance against an accountId that does not resolve to any account", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Invite Test Community Seven",
        "invite-membership-admin-7@example.com",
      );
      const invited = await inviteToCommunity({
        communityId: community.id,
        email: "invite-membership-invitee-7@example.com",
        invitedByAccountId: admin.id,
      });
      if (!invited.ok) throw new Error("expected invitation to be created");

      const rawToken = await tokenFor(invited.invitation.id);
      const result = await acceptInvitation({ token: rawToken, accountId: "nonexistent-account-id" });

      expect(result).toEqual({ ok: false, reason: "account_not_found" });
      expect(await prisma.membership.count({ where: { communityId: community.id } })).toBe(1); // admin only
    });

    // T006 (US2, FR-003): matching account exists but is unverified.
    it("rejects acceptance by a matching but unverified account, distinguishable from account_not_found (FR-003)", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Invite Test Community Eight",
        "invite-membership-admin-8@example.com",
      );
      const invitee = await createUnverifiedAccount("invite-membership-invitee-8@example.com");
      const invited = await inviteToCommunity({
        communityId: community.id,
        email: invitee.email,
        invitedByAccountId: admin.id,
      });
      if (!invited.ok) throw new Error("expected invitation to be created");

      const rawToken = await tokenFor(invited.invitation.id);
      const result = await acceptInvitation({ token: rawToken, accountId: invitee.id });

      expect(result).toEqual({ ok: false, reason: "not_verified" });
      expect(await prisma.membership.count({ where: { communityId: community.id } })).toBe(1);
    });

    // T006 (US2, FR-002): verified account whose email does not match, regardless of its own verification.
    it("rejects acceptance by a verified account whose email does not match the invited email (FR-002)", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Invite Test Community Nine",
        "invite-membership-admin-9@example.com",
      );
      const otherVerified = await createVerifiedAccount("invite-membership-other-9@example.com");
      const invited = await inviteToCommunity({
        communityId: community.id,
        email: "invite-membership-invitee-9@example.com",
        invitedByAccountId: admin.id,
      });
      if (!invited.ok) throw new Error("expected invitation to be created");

      const rawToken = await tokenFor(invited.invitation.id);
      const result = await acceptInvitation({ token: rawToken, accountId: otherVerified.id });

      expect(result).toEqual({ ok: false, reason: "email_mismatch" });
      expect(await prisma.membership.count({ where: { communityId: community.id } })).toBe(1);
    });
  });

  describe("revokeMembership", () => {
    // T017 (US3)
    it("revokes an existing MEMBER's membership, leaving the account and other communities untouched (FR-007)", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Invite Test Community Ten",
        "invite-membership-admin-10@example.com",
      );
      const member = await createVerifiedAccount("invite-membership-member-10@example.com");
      const membership = await prisma.membership.create({
        data: { accountId: member.id, communityId: community.id, role: "MEMBER" },
      });

      const result = await revokeMembership({
        communityId: community.id,
        membershipId: membership.id,
        revokedByAccountId: admin.id,
      });

      expect(result).toEqual({ ok: true });
      expect(await prisma.membership.findUnique({ where: { id: membership.id } })).toBeNull();
      const memberAfter = await prisma.account.findUnique({ where: { id: member.id } });
      expect(memberAfter).toEqual(member);
    });

    // T017 (FR-010)
    it("rejects a caller with no ADMINISTRATOR membership in the target community", async () => {
      const { community } = await createCommunityWithAdmin(
        "Invite Test Community Eleven",
        "invite-membership-admin-11@example.com",
      );
      const member = await createVerifiedAccount("invite-membership-member-11@example.com");
      const membership = await prisma.membership.create({
        data: { accountId: member.id, communityId: community.id, role: "MEMBER" },
      });
      const outsider = await createVerifiedAccount("invite-membership-outsider-11@example.com");

      const result = await revokeMembership({
        communityId: community.id,
        membershipId: membership.id,
        revokedByAccountId: outsider.id,
      });

      expect(result).toEqual({ ok: false, reason: "not_administrator" });
      expect(await prisma.membership.findUnique({ where: { id: membership.id } })).not.toBeNull();
    });

    // T017
    it("rejects a membershipId that doesn't belong to communityId, or doesn't exist", async () => {
      const { community: communityA, admin: adminA } = await createCommunityWithAdmin(
        "Invite Test Community Twelve A",
        "invite-membership-admin-12a@example.com",
      );
      const { community: communityB } = await createCommunityWithAdmin(
        "Invite Test Community Twelve B",
        "invite-membership-admin-12b@example.com",
      );
      const memberOfB = await createVerifiedAccount("invite-membership-member-12b@example.com");
      const membershipInB = await prisma.membership.create({
        data: { accountId: memberOfB.id, communityId: communityB.id, role: "MEMBER" },
      });

      const result = await revokeMembership({
        communityId: communityA.id,
        membershipId: membershipInB.id,
        revokedByAccountId: adminA.id,
      });

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });

    // T018 (US5)
    it("rejects revoking a community's sole remaining ADMINISTRATOR membership (FR-009)", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Invite Test Community Thirteen",
        "invite-membership-admin-13@example.com",
      );
      const soleAdminMembership = await prisma.membership.findUniqueOrThrow({
        where: { accountId_communityId: { accountId: admin.id, communityId: community.id } },
      });

      const result = await revokeMembership({
        communityId: community.id,
        membershipId: soleAdminMembership.id,
        revokedByAccountId: admin.id,
      });

      expect(result).toEqual({ ok: false, reason: "last_admin" });
      expect(await prisma.membership.findUnique({ where: { id: soleAdminMembership.id } })).not.toBeNull();
    });

    // T018 (US5, Scenario 2): two administrators — revoking one succeeds.
    it("allows revoking one of two administrators, leaving exactly one remaining", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Invite Test Community Fourteen",
        "invite-membership-admin-14@example.com",
      );
      const secondAdminAccount = await createVerifiedAccount("invite-membership-admin2-14@example.com");
      await prisma.membership.create({
        data: { accountId: secondAdminAccount.id, communityId: community.id, role: "ADMINISTRATOR" },
      });
      const firstAdminMembership = await prisma.membership.findUniqueOrThrow({
        where: { accountId_communityId: { accountId: admin.id, communityId: community.id } },
      });

      const result = await revokeMembership({
        communityId: community.id,
        membershipId: firstAdminMembership.id,
        revokedByAccountId: secondAdminAccount.id,
      });

      expect(result).toEqual({ ok: true });
      const remainingAdmins = await prisma.membership.count({
        where: { communityId: community.id, role: "ADMINISTRATOR" },
      });
      expect(remainingAdmins).toBe(1);
    });
  });

  describe("cross-community independence (FR-013)", () => {
    // quickstart.md Scenario 7.
    it("holds independent roles across two communities, and revoking one leaves the other untouched", async () => {
      const { community: communityD, admin: adminD } = await createCommunityWithAdmin(
        "Invite Test Community Sixteen D",
        "invite-membership-admind-16@example.com",
      );
      const { community: communityC, admin: adminC } = await createCommunityWithAdmin(
        "Invite Test Community Sixteen C",
        "invite-membership-adminc-16@example.com",
      );

      // The same account holds ADMINISTRATOR in D and, separately, accepts a MEMBER invitation into C.
      const shared = await createVerifiedAccount("invite-membership-shared-16@example.com");
      await prisma.membership.create({
        data: { accountId: shared.id, communityId: communityD.id, role: "ADMINISTRATOR" },
      });
      const invited = await inviteToCommunity({
        communityId: communityC.id,
        email: shared.email,
        invitedByAccountId: adminC.id,
      });
      if (!invited.ok) throw new Error("expected invitation to be created");
      const token = await tokenFor(invited.invitation.id);
      const accepted = await acceptInvitation({ token, accountId: shared.id });
      expect(accepted).toEqual({ ok: true, membership: { communityId: communityC.id, role: "MEMBER" } });

      // Revoke the MEMBER membership in C; the ADMINISTRATOR membership in D must be untouched.
      const membershipInC = await prisma.membership.findUniqueOrThrow({
        where: { accountId_communityId: { accountId: shared.id, communityId: communityC.id } },
      });
      const revoked = await revokeMembership({
        communityId: communityC.id,
        membershipId: membershipInC.id,
        revokedByAccountId: adminC.id,
      });
      expect(revoked).toEqual({ ok: true });

      const membershipInD = await prisma.membership.findUnique({
        where: { accountId_communityId: { accountId: shared.id, communityId: communityD.id } },
      });
      expect(membershipInD?.role).toBe("ADMINISTRATOR");
      expect(
        await prisma.membership.findUnique({
          where: { accountId_communityId: { accountId: shared.id, communityId: communityC.id } },
        }),
      ).toBeNull();

      // adminD's own standing in D is unaffected by anything done in C.
      const adminDMembership = await prisma.membership.findUnique({
        where: { accountId_communityId: { accountId: adminD.id, communityId: communityD.id } },
      });
      expect(adminDMembership?.role).toBe("ADMINISTRATOR");
    });
  });

  describe("revoke-then-reinvite (US4)", () => {
    // T024 (FR-008, SC-004)
    it("lets an administrator re-invite the exact same email after revoking its membership, with no cooldown", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Invite Test Community Fifteen",
        "invite-membership-admin-15@example.com",
      );
      const memberAccount = await createVerifiedAccount("invite-membership-member-15@example.com");

      const invited = await inviteToCommunity({
        communityId: community.id,
        email: memberAccount.email,
        invitedByAccountId: admin.id,
      });
      if (!invited.ok) throw new Error("expected invitation to be created");
      const acceptToken = await tokenFor(invited.invitation.id);
      const accepted = await acceptInvitation({ token: acceptToken, accountId: memberAccount.id });
      if (!accepted.ok) throw new Error("expected acceptance to succeed");

      const membership = await prisma.membership.findUniqueOrThrow({
        where: { accountId_communityId: { accountId: memberAccount.id, communityId: community.id } },
      });
      const revoked = await revokeMembership({
        communityId: community.id,
        membershipId: membership.id,
        revokedByAccountId: admin.id,
      });
      expect(revoked).toEqual({ ok: true });

      const reinvited = await inviteToCommunity({
        communityId: community.id,
        email: memberAccount.email,
        invitedByAccountId: admin.id,
      });
      expect(reinvited.ok).toBe(true);
      if (!reinvited.ok) throw new Error("expected re-invitation to succeed");

      const reinviteToken = await tokenFor(reinvited.invitation.id);
      const reaccepted = await acceptInvitation({ token: reinviteToken, accountId: memberAccount.id });
      expect(reaccepted).toEqual({ ok: true, membership: { communityId: community.id, role: "MEMBER" } });
    });
  });
});

/**
 * Test-only helper: inviteToCommunity()/acceptInvitation() only ever expose
 * the raw token via the emailed link, never in a service return value
 * (research.md #1) — so tests read it back out of the captured invitation
 * email (EMAIL_TEST_CAPTURE=true, set in .env.test).
 */
async function tokenFor(invitationId: string): Promise<string> {
  const invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } });
  const emails = getCapturedEmails(invitation.email);
  const match = /token=([^\s&"']+)/.exec(emails[emails.length - 1]?.text ?? "");
  if (!match) throw new Error(`no invitation token found in captured email for ${invitation.email}`);
  return decodeURIComponent(match[1]);
}
