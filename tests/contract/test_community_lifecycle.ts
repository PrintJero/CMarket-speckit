import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createCommunityAsMaster,
  suspendCommunity,
  reactivateCommunity,
  archiveDueSuspendedCommunities,
  restoreCommunity,
} from "@/server/services/communityLifecycleService";
import { inviteToCommunity } from "@/server/services/invitationService";
import { createMaster } from "@/server/services/masterAuthService";

async function resetState() {
  await prisma.membership.deleteMany({ where: { community: { name: { contains: "CLT Community" } } } });
  await prisma.community.deleteMany({ where: { name: { contains: "CLT Community" } } });
  await prisma.account.deleteMany({ where: { email: { contains: "clt-test" } } });
  await prisma.administrativeAuditEntry.deleteMany({});
  await prisma.masterSession.deleteMany({});
  await prisma.masterIdentity.deleteMany({});
}

function createVerifiedAccount(email: string) {
  return prisma.account.create({ data: { email, passwordHash: "irrelevant-hash", emailVerifiedAt: new Date() } });
}

function createUnverifiedAccount(email: string) {
  return prisma.account.create({ data: { email, passwordHash: null, emailVerifiedAt: null } });
}

async function createMasterFixture(masterId: string) {
  const result = await createMaster({ masterId, email: `${masterId}@example.com`, createdByMasterId: null });
  if (!result.ok) throw new Error("setup failed");
  return result.master.id;
}

describe("communityLifecycleService (contract)", () => {
  beforeEach(resetState);
  afterAll(async () => {
    await resetState();
    await prisma.$disconnect();
  });

  describe("createCommunityAsMaster (User Story 4, FR-022–FR-026, research.md #10/#12)", () => {
    it("creates a community + ADMINISTRATOR membership for an existing verified account, atomically, with no MASTER membership", async () => {
      const masterId = await createMasterFixture("clt-master-1");
      const founder = await createVerifiedAccount("clt-test-founder-1@example.com");

      const result = await createCommunityAsMaster({
        callerMasterId: masterId,
        name: "CLT Community One",
        administrator: { mode: "existing", email: founder.email },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");

      const memberships = await prisma.membership.findMany({ where: { communityId: result.community.id } });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].accountId).toBe(founder.id);
      expect(memberships[0].role).toBe("ADMINISTRATOR");
      expect(memberships[0].operationalEpoch).toBe(1);

      const community = await prisma.community.findUnique({ where: { id: result.community.id } });
      expect(community?.operationalEpoch).toBe(1);
      expect(community?.status).toBe("ACTIVE");

      // MASTER itself gets no Membership anywhere.
      const masterMembership = await prisma.membership.findFirst({ where: { accountId: masterId } });
      expect(masterMembership).toBeNull();

      const auditEntry = await prisma.administrativeAuditEntry.findFirst({
        where: { action: "community.create", targetId: result.community.id, outcome: "SUCCESS" },
      });
      expect(auditEntry).not.toBeNull();
    });

    it("provisions a brand-new, already-verified account with a temporary password when none exists", async () => {
      const masterId = await createMasterFixture("clt-master-2");

      const result = await createCommunityAsMaster({
        callerMasterId: masterId,
        name: "CLT Community Two",
        administrator: { mode: "provision", email: "clt-test-provisioned-1@example.com", displayName: "Provisioned Admin" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.temporaryPassword).toBeTruthy();

      const account = await prisma.account.findUnique({ where: { email: "clt-test-provisioned-1@example.com" } });
      expect(account?.emailVerifiedAt).not.toBeNull();
      expect(account?.displayName).toBe("Provisioned Admin");

      // research.md #10: no VerificationToken row — nothing pending to hijack.
      const tokens = await prisma.verificationToken.findMany({ where: { accountId: account!.id } });
      expect(tokens).toHaveLength(0);

      const membership = await prisma.membership.findFirst({ where: { accountId: account!.id } });
      expect(membership?.role).toBe("ADMINISTRATOR");
    });

    it("rejects account_not_found / account_not_verified / account_already_exists / invalid_name with no side effects", async () => {
      const masterId = await createMasterFixture("clt-master-3");

      expect(
        await createCommunityAsMaster({
          callerMasterId: masterId,
          name: "   ",
          administrator: { mode: "existing", email: "clt-test-x@example.com" },
        }),
      ).toEqual({ ok: false, reason: "invalid_name" });

      expect(
        await createCommunityAsMaster({
          callerMasterId: masterId,
          name: "CLT Community Three",
          administrator: { mode: "existing", email: "clt-test-nonexistent@example.com" },
        }),
      ).toEqual({ ok: false, reason: "account_not_found" });

      const unverified = await createUnverifiedAccount("clt-test-unverified@example.com");
      expect(
        await createCommunityAsMaster({
          callerMasterId: masterId,
          name: "CLT Community Four",
          administrator: { mode: "existing", email: unverified.email },
        }),
      ).toEqual({ ok: false, reason: "account_not_verified" });

      const verified = await createVerifiedAccount("clt-test-already-exists@example.com");
      expect(
        await createCommunityAsMaster({
          callerMasterId: masterId,
          name: "CLT Community Five",
          administrator: { mode: "provision", email: verified.email, displayName: "Whoever" },
        }),
      ).toEqual({ ok: false, reason: "account_already_exists" });

      expect(await prisma.community.count({ where: { name: { in: ["CLT Community Three", "CLT Community Four", "CLT Community Five"] } } })).toBe(0);

      const failureEntries = await prisma.administrativeAuditEntry.count({
        where: { action: "community.create", outcome: "FAILURE" },
      });
      expect(failureEntries).toBeGreaterThanOrEqual(4);
    });
  });

  describe("suspendCommunity / reactivateCommunity (User Story 8, FR-050, FR-051, FR-055, FR-056)", () => {
    it("suspends an ACTIVE community, recording suspendedAt/reason/a 30-day archiveScheduledAt", async () => {
      const masterId = await createMasterFixture("clt-master-suspend-1");
      const created = await createCommunityAsMaster({
        callerMasterId: masterId,
        name: "CLT Community Suspend One",
        administrator: { mode: "existing", email: (await createVerifiedAccount("clt-test-suspend-admin-1@example.com")).email },
      });
      if (!created.ok) throw new Error("setup failed");

      const result = await suspendCommunity(masterId, created.community.id, "Payment overdue");
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");

      const community = await prisma.community.findUnique({ where: { id: created.community.id } });
      expect(community?.status).toBe("SUSPENDED");
      expect(community?.suspensionReason).toBe("Payment overdue");
      expect(community?.suspendedAt).not.toBeNull();
      const expectedDeadline = community!.suspendedAt!.getTime() + 30 * 24 * 60 * 60 * 1000;
      expect(community?.archiveScheduledAt?.getTime()).toBe(expectedDeadline);
    });

    it("rejects a blank reason, and rejects re-suspending an already-SUSPENDED community without extending the deadline", async () => {
      const masterId = await createMasterFixture("clt-master-suspend-2");
      const created = await createCommunityAsMaster({
        callerMasterId: masterId,
        name: "CLT Community Suspend Two",
        administrator: { mode: "existing", email: (await createVerifiedAccount("clt-test-suspend-admin-2@example.com")).email },
      });
      if (!created.ok) throw new Error("setup failed");

      expect(await suspendCommunity(masterId, created.community.id, "   ")).toEqual({
        ok: false,
        reason: "invalid_reason",
      });

      const first = await suspendCommunity(masterId, created.community.id, "First reason");
      if (!first.ok) throw new Error("expected success");
      const originalDeadline = first.community.archiveScheduledAt.getTime();

      const second = await suspendCommunity(masterId, created.community.id, "Second reason");
      expect(second).toEqual({ ok: false, reason: "not_active" });

      const community = await prisma.community.findUnique({ where: { id: created.community.id } });
      expect(community?.archiveScheduledAt?.getTime()).toBe(originalDeadline);
      expect(community?.suspensionReason).toBe("First reason");
    });

    it("reactivateCommunity cancels the scheduled archival and restores ACTIVE status; rejects a non-SUSPENDED community", async () => {
      const masterId = await createMasterFixture("clt-master-suspend-3");
      const created = await createCommunityAsMaster({
        callerMasterId: masterId,
        name: "CLT Community Suspend Three",
        administrator: { mode: "existing", email: (await createVerifiedAccount("clt-test-suspend-admin-3@example.com")).email },
      });
      if (!created.ok) throw new Error("setup failed");

      expect(await reactivateCommunity(masterId, created.community.id)).toEqual({
        ok: false,
        reason: "not_suspended",
      });

      await suspendCommunity(masterId, created.community.id, "Reason");
      const result = await reactivateCommunity(masterId, created.community.id);
      expect(result).toEqual({ ok: true, community: { id: created.community.id, status: "ACTIVE" } });

      const community = await prisma.community.findUnique({ where: { id: created.community.id } });
      expect(community?.status).toBe("ACTIVE");
      expect(community?.suspendedAt).toBeNull();
      expect(community?.suspensionReason).toBeNull();
      expect(community?.archiveScheduledAt).toBeNull();
    });
  });

  describe("archiveDueSuspendedCommunities (User Story 9, FR-057, FR-058, research.md #7/#8)", () => {
    it("archives a community whose deadline has passed while still SUSPENDED, touching zero Listing/MessageThread/Invitation/Membership rows", async () => {
      const masterId = await createMasterFixture("clt-master-archive-1");
      const founder = await createVerifiedAccount("clt-test-archive-admin-1@example.com");
      const created = await createCommunityAsMaster({
        callerMasterId: masterId,
        name: "CLT Community Archive One",
        administrator: { mode: "existing", email: founder.email },
      });
      if (!created.ok) throw new Error("setup failed");

      await suspendCommunity(masterId, created.community.id, "Reason");
      await prisma.community.update({
        where: { id: created.community.id },
        data: { archiveScheduledAt: new Date(Date.now() - 1000) },
      });

      const membershipBefore = await prisma.membership.findFirst({ where: { communityId: created.community.id } });

      const result = await archiveDueSuspendedCommunities();
      expect(result.archivedCommunityIds).toContain(created.community.id);

      const community = await prisma.community.findUnique({ where: { id: created.community.id } });
      expect(community?.status).toBe("ARCHIVED");
      expect(community?.archivedAt).not.toBeNull();

      const membershipAfter = await prisma.membership.findFirst({ where: { communityId: created.community.id } });
      expect(membershipAfter).toEqual(membershipBefore); // untouched, including operationalEpoch

      const auditEntry = await prisma.administrativeAuditEntry.findFirst({
        where: { action: "community.archive", targetId: created.community.id },
      });
      expect(auditEntry?.actorType).toBe("SYSTEM");
      expect(auditEntry?.outcome).toBe("SUCCESS");
    });

    it("is idempotent: re-running against an already-ARCHIVED community produces no duplicate audit entry", async () => {
      const masterId = await createMasterFixture("clt-master-archive-2");
      const founder = await createVerifiedAccount("clt-test-archive-admin-2@example.com");
      const created = await createCommunityAsMaster({
        callerMasterId: masterId,
        name: "CLT Community Archive Two",
        administrator: { mode: "existing", email: founder.email },
      });
      if (!created.ok) throw new Error("setup failed");

      await suspendCommunity(masterId, created.community.id, "Reason");
      await prisma.community.update({
        where: { id: created.community.id },
        data: { archiveScheduledAt: new Date(Date.now() - 1000) },
      });

      await archiveDueSuspendedCommunities();
      const secondRun = await archiveDueSuspendedCommunities();
      expect(secondRun.archivedCommunityIds).not.toContain(created.community.id);

      const auditEntries = await prisma.administrativeAuditEntry.count({
        where: { action: "community.archive", targetId: created.community.id },
      });
      expect(auditEntries).toBe(1);
    });

    it("a community reactivated before its deadline is untouched by a later run of its now-stale scheduled job", async () => {
      const masterId = await createMasterFixture("clt-master-archive-3");
      const founder = await createVerifiedAccount("clt-test-archive-admin-3@example.com");
      const created = await createCommunityAsMaster({
        callerMasterId: masterId,
        name: "CLT Community Archive Three",
        administrator: { mode: "existing", email: founder.email },
      });
      if (!created.ok) throw new Error("setup failed");

      await suspendCommunity(masterId, created.community.id, "Reason");
      // Simulate a stale scheduled deadline that already passed, but the community was reactivated since.
      await prisma.community.update({
        where: { id: created.community.id },
        data: { archiveScheduledAt: new Date(Date.now() - 1000) },
      });
      await reactivateCommunity(masterId, created.community.id);

      const result = await archiveDueSuspendedCommunities();
      expect(result.archivedCommunityIds).not.toContain(created.community.id);

      const community = await prisma.community.findUnique({ where: { id: created.community.id } });
      expect(community?.status).toBe("ACTIVE");
    });
  });

  describe("restoreCommunity (User Story 10, FR-062–FR-065, research.md #8)", () => {
    async function createArchivedCommunityWithHistory(masterId: string, name: string, adminEmail: string, memberEmail: string) {
      const founder = await createVerifiedAccount(adminEmail);
      const created = await createCommunityAsMaster({
        callerMasterId: masterId,
        name,
        administrator: { mode: "existing", email: founder.email },
      });
      if (!created.ok) throw new Error("setup failed");

      const member = await createVerifiedAccount(memberEmail);
      const memberMembership = await prisma.membership.create({
        data: { accountId: member.id, communityId: created.community.id, role: "MEMBER", operationalEpoch: 1 },
      });
      const invitation = await inviteToCommunity({
        communityId: created.community.id,
        email: "clt-test-restore-invitee@example.com",
        invitedByAccountId: founder.id,
      });
      if (!invitation.ok) throw new Error("setup failed");

      const adminMembership = await prisma.membership.findFirstOrThrow({
        where: { communityId: created.community.id, accountId: founder.id },
      });

      await suspendCommunity(masterId, created.community.id, "Reason");
      await prisma.community.update({
        where: { id: created.community.id },
        data: { archiveScheduledAt: new Date(Date.now() - 1000) },
      });
      await archiveDueSuspendedCommunities();

      return { communityId: created.community.id, founder, adminMembership, member, memberMembership, invitation };
    }

    it("restores exactly the selected administrator, incrementing operationalEpoch and leaving every other row at the old epoch", async () => {
      const masterId = await createMasterFixture("clt-master-restore-1");
      const { communityId, adminMembership, memberMembership, invitation } = await createArchivedCommunityWithHistory(
        masterId,
        "CLT Community Restore One",
        "clt-test-restore-admin-1@example.com",
        "clt-test-restore-member-1@example.com",
      );

      const result = await restoreCommunity(masterId, communityId, adminMembership.id);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.administrator.accountId).toBe(adminMembership.accountId);

      const community = await prisma.community.findUniqueOrThrow({ where: { id: communityId } });
      expect(community.status).toBe("ACTIVE");
      expect(community.operationalEpoch).toBe(2);
      expect(community.archivedAt).toBeNull();

      const restoredAdminMembership = await prisma.membership.findUniqueOrThrow({ where: { id: adminMembership.id } });
      expect(restoredAdminMembership.operationalEpoch).toBe(2);

      // Every other pre-restoration row keeps the OLD epoch, unchanged, permanently.
      const staleMemberMembership = await prisma.membership.findUniqueOrThrow({ where: { id: memberMembership.id } });
      expect(staleMemberMembership.operationalEpoch).toBe(1);
      const staleInvitation = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.invitation.id } });
      expect(staleInvitation.operationalEpoch).toBe(1);
    });

    it("rejects restoring a non-ARCHIVED community, and an ineligible administrator selection", async () => {
      const masterId = await createMasterFixture("clt-master-restore-2");
      const founder = await createVerifiedAccount("clt-test-restore-admin-2@example.com");
      const created = await createCommunityAsMaster({
        callerMasterId: masterId,
        name: "CLT Community Restore Two",
        administrator: { mode: "existing", email: founder.email },
      });
      if (!created.ok) throw new Error("setup failed");
      const adminMembership = await prisma.membership.findFirstOrThrow({ where: { communityId: created.community.id } });

      // Not archived yet (still ACTIVE).
      expect(await restoreCommunity(masterId, created.community.id, adminMembership.id)).toEqual({
        ok: false,
        reason: "not_archived",
      });

      await suspendCommunity(masterId, created.community.id, "Reason");
      // Still not archived (only SUSPENDED).
      expect(await restoreCommunity(masterId, created.community.id, adminMembership.id)).toEqual({
        ok: false,
        reason: "not_archived",
      });
    });

    it("rejects a selected administrator whose account is disabled or was never an administrator at the archived epoch", async () => {
      const masterId = await createMasterFixture("clt-master-restore-3");
      const { communityId, adminMembership, memberMembership } = await createArchivedCommunityWithHistory(
        masterId,
        "CLT Community Restore Three",
        "clt-test-restore-admin-3@example.com",
        "clt-test-restore-member-3@example.com",
      );

      // A plain MEMBER (not administrator) is not eligible.
      expect(await restoreCommunity(masterId, communityId, memberMembership.id)).toEqual({
        ok: false,
        reason: "administrator_not_eligible",
      });

      // A suspended administrator account is not eligible.
      await prisma.account.update({ where: { id: adminMembership.accountId }, data: { status: "SUSPENDED" } });
      expect(await restoreCommunity(masterId, communityId, adminMembership.id)).toEqual({
        ok: false,
        reason: "administrator_not_eligible",
      });

      const community = await prisma.community.findUniqueOrThrow({ where: { id: communityId } });
      expect(community.status).toBe("ARCHIVED"); // unchanged by the rejected attempts
    });

    it("the restored administrator can invite new members and create listings that stamp the new epoch", async () => {
      const masterId = await createMasterFixture("clt-master-restore-4");
      const { communityId, adminMembership, founder } = await createArchivedCommunityWithHistory(
        masterId,
        "CLT Community Restore Four",
        "clt-test-restore-admin-4@example.com",
        "clt-test-restore-member-4@example.com",
      );

      await restoreCommunity(masterId, communityId, adminMembership.id);

      const newInvitation = await inviteToCommunity({
        communityId,
        email: "clt-test-restore-new-invitee-4@example.com",
        invitedByAccountId: founder.id,
      });
      expect(newInvitation.ok).toBe(true);
      if (!newInvitation.ok) throw new Error("expected success");

      const invitationRow = await prisma.invitation.findUniqueOrThrow({ where: { id: newInvitation.invitation.id } });
      const community = await prisma.community.findUniqueOrThrow({ where: { id: communityId } });
      expect(invitationRow.operationalEpoch).toBe(community.operationalEpoch);
    });
  });
});
