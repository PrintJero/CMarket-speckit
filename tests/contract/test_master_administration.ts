import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createMaster } from "@/server/services/masterAuthService";
import { createCommunityAsMaster } from "@/server/services/communityLifecycleService";
import {
  getCommunityForMaster,
  editCommunity,
  promoteMembershipAsMaster,
  removeMembershipAsMaster,
  listCommunitiesForMaster,
  suspendAccount,
  deleteAccount,
  editAccount,
  reactivateAccount,
  resetAccountPassword,
  listAccountsForMaster,
  getAccountForMaster,
} from "@/server/services/masterAdministrationService";
import { signInWithPassword } from "@/server/services/accountService";
import { hashPassword } from "@/lib/auth/passwordHash";
import { inviteToCommunity } from "@/server/services/invitationService";

async function resetState() {
  await prisma.membership.deleteMany({ where: { community: { name: { contains: "MAT Community" } } } });
  await prisma.community.deleteMany({ where: { name: { contains: "MAT Community" } } });
  await prisma.account.deleteMany({ where: { email: { contains: "mat-test" } } });
  await prisma.administrativeAuditEntry.deleteMany({});
  await prisma.masterSession.deleteMany({});
  await prisma.masterIdentity.deleteMany({});
}

function createVerifiedAccount(email: string) {
  return prisma.account.create({ data: { email, passwordHash: "irrelevant-hash", emailVerifiedAt: new Date() } });
}

async function createMasterFixture(masterId: string) {
  const result = await createMaster({ masterId, email: `${masterId}@example.com`, createdByMasterId: null });
  if (!result.ok) throw new Error("setup failed");
  return result.master.id;
}

async function createCommunityWithAdmin(masterId: string, name: string, adminEmail: string) {
  const founder = await createVerifiedAccount(adminEmail);
  const result = await createCommunityAsMaster({
    callerMasterId: masterId,
    name,
    administrator: { mode: "existing", email: founder.email },
  });
  if (!result.ok) throw new Error("setup failed");
  const membership = await prisma.membership.findFirstOrThrow({
    where: { communityId: result.community.id, accountId: founder.id },
  });
  return { communityId: result.community.id, founder, membership };
}

describe("masterAdministrationService (contract)", () => {
  beforeEach(resetState);
  afterAll(async () => {
    await resetState();
    await prisma.$disconnect();
  });

  describe("Community management from outside (User Story 5, FR-027–FR-032)", () => {
    it("getCommunityForMaster returns memberships with isCurrent, and the MASTER never appears among them", async () => {
      const masterId = await createMasterFixture("mat-master-1");
      const { communityId } = await createCommunityWithAdmin(masterId, "MAT Community One", "mat-test-admin-1@example.com");

      const result = await getCommunityForMaster(communityId);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.memberships).toHaveLength(1);
      expect(result.memberships[0].isCurrent).toBe(true);
      expect(result.memberships.some((m) => m.accountId === masterId)).toBe(false);
    });

    it("editCommunity updates the name and records prior/new values in the audit entry", async () => {
      const masterId = await createMasterFixture("mat-master-2");
      const { communityId } = await createCommunityWithAdmin(masterId, "MAT Community Two", "mat-test-admin-2@example.com");

      const result = await editCommunity(masterId, communityId, { name: "MAT Community Two Renamed" });
      expect(result.ok).toBe(true);

      const entry = await prisma.administrativeAuditEntry.findFirst({
        where: { action: "community.edit", targetId: communityId },
      });
      expect(entry?.detail).toMatchObject({
        before: { name: "MAT Community Two" },
        after: { name: "MAT Community Two Renamed" },
      });
    });

    it("promoteMembershipAsMaster promotes a current member to ADMINISTRATOR", async () => {
      const masterId = await createMasterFixture("mat-master-3");
      const { communityId } = await createCommunityWithAdmin(masterId, "MAT Community Three", "mat-test-admin-3@example.com");
      const member = await createVerifiedAccount("mat-test-member-3@example.com");
      const membership = await prisma.membership.create({
        data: { accountId: member.id, communityId, role: "MEMBER", operationalEpoch: 1 },
      });

      const result = await promoteMembershipAsMaster(masterId, communityId, membership.id);
      expect(result).toEqual({ ok: true });

      const after = await prisma.membership.findUnique({ where: { id: membership.id } });
      expect(after?.role).toBe("ADMINISTRATOR");
    });

    it("removeMembershipAsMaster rejects orphaning the community, then succeeds once a replacement is supplied", async () => {
      const masterId = await createMasterFixture("mat-master-4");
      const { communityId, membership } = await createCommunityWithAdmin(masterId, "MAT Community Four", "mat-test-admin-4@example.com");
      const secondMember = await createVerifiedAccount("mat-test-member-4@example.com");
      const secondMembership = await prisma.membership.create({
        data: { accountId: secondMember.id, communityId, role: "MEMBER", operationalEpoch: 1 },
      });

      const rejected = await removeMembershipAsMaster(masterId, communityId, membership.id, {
        disposition: "revoke_membership",
      });
      expect(rejected).toEqual({ ok: false, reason: "would_orphan_community" });
      expect(await prisma.membership.findUnique({ where: { id: membership.id } })).not.toBeNull();

      const accepted = await removeMembershipAsMaster(masterId, communityId, membership.id, {
        disposition: "revoke_membership",
        replacementAdministratorMembershipId: secondMembership.id,
      });
      expect(accepted).toEqual({ ok: true });
      expect(await prisma.membership.findUnique({ where: { id: membership.id } })).toBeNull();
      const promoted = await prisma.membership.findUnique({ where: { id: secondMembership.id } });
      expect(promoted?.role).toBe("ADMINISTRATOR");
    });

    it("removeMembershipAsMaster's disable_account/delete_account dispositions call through to account-level actions", async () => {
      const masterId = await createMasterFixture("mat-master-5");
      const { communityId, membership, founder } = await createCommunityWithAdmin(masterId, "MAT Community Five", "mat-test-admin-5@example.com");
      const secondMember = await createVerifiedAccount("mat-test-member-5@example.com");
      const secondMembership = await prisma.membership.create({
        data: { accountId: secondMember.id, communityId, role: "MEMBER", operationalEpoch: 1 },
      });

      const result = await removeMembershipAsMaster(masterId, communityId, membership.id, {
        disposition: "disable_account",
        replacementAdministratorMembershipId: secondMembership.id,
      });
      expect(result).toEqual({ ok: true });

      const account = await prisma.account.findUnique({ where: { id: founder.id } });
      expect(account?.status).toBe("SUSPENDED");
      // FR-032: the account and its (now-demoted-to-nothing, still-existing) membership remain, unlike revoke_membership.
      expect(await prisma.membership.findUnique({ where: { id: membership.id } })).not.toBeNull();
    });

    it("listCommunitiesForMaster filters by status and never requires the caller to be a member", async () => {
      const masterId = await createMasterFixture("mat-master-6");
      await createCommunityWithAdmin(masterId, "MAT Community Six", "mat-test-admin-6@example.com");

      const all = await listCommunitiesForMaster();
      expect(all.communities.some((c) => c.name === "MAT Community Six")).toBe(true);

      const suspendedOnly = await listCommunitiesForMaster({ status: "SUSPENDED" });
      expect(suspendedOnly.communities.some((c) => c.name === "MAT Community Six")).toBe(false);
    });
  });

  describe("Account-level primitives used by removeMembershipAsMaster (research.md #9)", () => {
    it("suspendAccount rejects orphaning a community, then succeeds with a replacement assignment", async () => {
      const masterId = await createMasterFixture("mat-master-7");
      const { communityId, membership, founder } = await createCommunityWithAdmin(masterId, "MAT Community Seven", "mat-test-admin-7@example.com");

      const rejected = await suspendAccount(masterId, founder.id, {});
      expect(rejected).toEqual({ ok: false, reason: "would_orphan_communities", affectedCommunityIds: [communityId] });

      const secondMember = await createVerifiedAccount("mat-test-member-7@example.com");
      const secondMembership = await prisma.membership.create({
        data: { accountId: secondMember.id, communityId, role: "MEMBER", operationalEpoch: 1 },
      });

      const accepted = await suspendAccount(masterId, founder.id, {
        replacementAdministratorAssignments: [{ communityId, membershipId: secondMembership.id }],
      });
      expect(accepted).toEqual({ ok: true });

      const account = await prisma.account.findUnique({ where: { id: founder.id } });
      expect(account?.status).toBe("SUSPENDED");
      expect((await prisma.membership.findUnique({ where: { id: membership.id } }))).not.toBeNull();
    });

    it("deleteAccount soft-deletes: retains the row and FKs, frees the email, clears credentials", async () => {
      const masterId = await createMasterFixture("mat-master-8");
      const { communityId, membership, founder } = await createCommunityWithAdmin(masterId, "MAT Community Eight", "mat-test-admin-8@example.com");
      const secondMember = await createVerifiedAccount("mat-test-member-8@example.com");
      const secondMembership = await prisma.membership.create({
        data: { accountId: secondMember.id, communityId, role: "MEMBER", operationalEpoch: 1 },
      });

      const originalEmail = founder.email;
      const result = await deleteAccount(masterId, founder.id, {
        replacementAdministratorAssignments: [{ communityId, membershipId: secondMembership.id }],
      });
      expect(result).toEqual({ ok: true });

      const account = await prisma.account.findUnique({ where: { id: founder.id } });
      expect(account).not.toBeNull();
      expect(account?.deletedAt).not.toBeNull();
      expect(account?.email).not.toBe(originalEmail);
      expect(account?.passwordHash).toBeNull();

      // Original email is now free for a new sign-up.
      expect(await prisma.account.findUnique({ where: { email: originalEmail } })).toBeNull();

      // The old membership row (historical attribution) is retained, not deleted.
      expect(await prisma.membership.findUnique({ where: { id: membership.id } })).not.toBeNull();
    });
  });

  describe("Ordinary account management (User Story 7, FR-040–FR-047, research.md #9)", () => {
    it("editAccount updates displayName/email with case-insensitive uniqueness, and never touches an existing Invitation row (FR-045)", async () => {
      const masterId = await createMasterFixture("mat-master-9");
      const account = await createVerifiedAccount("mat-test-edit-1@example.com");
      const { communityId } = await createCommunityWithAdmin(masterId, "MAT Community Nine", "mat-test-edit-admin-9@example.com");
      const invited = await inviteToCommunity({
        communityId,
        email: account.email,
        invitedByAccountId: (await prisma.membership.findFirstOrThrow({ where: { communityId, role: "ADMINISTRATOR" } })).accountId,
      });
      if (!invited.ok) throw new Error("setup failed");

      const result = await editAccount(masterId, account.id, {
        displayName: "Edited Name",
        email: "mat-test-edited-1@example.com",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.account.email).toBe("mat-test-edited-1@example.com");

      // The pending invitation remains bound to the OLD email — untouched (research.md #14).
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: invited.invitation.id } });
      expect(invitation.email).toBe("mat-test-edit-1@example.com");
      expect(invitation.consumedAt).toBeNull();

      // Rejects a duplicate email.
      const other = await createVerifiedAccount("mat-test-edit-2@example.com");
      expect(await editAccount(masterId, other.id, { email: "mat-test-edited-1@example.com" })).toEqual({
        ok: false,
        reason: "email_already_in_use",
      });
    });

    it("reactivateAccount restores sign-in eligibility after a suspension", async () => {
      const masterId = await createMasterFixture("mat-master-10");
      const account = await prisma.account.create({
        data: { email: "mat-test-reactivate-1@example.com", passwordHash: await hashPassword("original-password-1"), emailVerifiedAt: new Date() },
      });

      await suspendAccount(masterId, account.id, {});
      expect(await signInWithPassword(account.email, "original-password-1")).toEqual({ ok: false });

      await reactivateAccount(masterId, account.id);
      const signedIn = await signInWithPassword(account.email, "original-password-1");
      expect(signedIn.ok).toBe(true);
    });

    it("resetAccountPassword issues a one-time temporary password and revokes existing sessions", async () => {
      const masterId = await createMasterFixture("mat-master-11");
      const account = await prisma.account.create({
        data: { email: "mat-test-reset-1@example.com", passwordHash: await hashPassword("original-password-1"), emailVerifiedAt: new Date() },
      });
      const signedInBefore = await signInWithPassword(account.email, "original-password-1");
      if (!signedInBefore.ok) throw new Error("setup failed");

      const result = await resetAccountPassword(masterId, account.id);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");

      expect(await prisma.session.findFirst({ where: { accountId: account.id } })).toBeNull();
      expect(await signInWithPassword(account.email, "original-password-1")).toEqual({ ok: false });
      expect((await signInWithPassword(account.email, result.temporaryPassword)).ok).toBe(true);
    });

    it("listAccountsForMaster/getAccountForMaster support search and surface every currently-administered community", async () => {
      const masterId = await createMasterFixture("mat-master-12");
      const { communityId } = await createCommunityWithAdmin(masterId, "MAT Community Twelve", "mat-test-search-admin-12@example.com");
      const admin = await prisma.membership.findFirstOrThrow({ where: { communityId, role: "ADMINISTRATOR" } });

      const searched = await listAccountsForMaster({ search: "mat-test-search-admin-12" });
      expect(searched.accounts.some((a) => a.id === admin.accountId)).toBe(true);

      const detail = await getAccountForMaster(admin.accountId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) throw new Error("expected success");
      expect(detail.administeredCommunities.map((c) => c.communityId)).toContain(communityId);
    });

    it("suspendAccount/deleteAccount generalize the orphan guard across multiple communities at once (FR-046, FR-047)", async () => {
      const masterId = await createMasterFixture("mat-master-13");
      const { communityId: communityX } = await createCommunityWithAdmin(masterId, "MAT Community Thirteen X", "mat-test-multi-13@example.com");
      const soleAdmin = await prisma.membership.findFirstOrThrow({ where: { communityId: communityX, role: "ADMINISTRATOR" } });

      // Same account also administers a second community.
      const communityY = await prisma.community.create({ data: { name: "MAT Community Thirteen Y", createdByOperator: "test" } });
      await prisma.membership.create({
        data: { accountId: soleAdmin.accountId, communityId: communityY.id, role: "ADMINISTRATOR", operationalEpoch: 1 },
      });

      const rejected = await suspendAccount(masterId, soleAdmin.accountId, {});
      if (rejected.ok || rejected.reason !== "would_orphan_communities") {
        throw new Error("expected would_orphan_communities rejection");
      }
      expect(new Set(rejected.affectedCommunityIds)).toEqual(new Set([communityX, communityY.id]));

      // Supplying a replacement for only ONE of the two communities is still rejected.
      const secondMemberX = await createVerifiedAccount("mat-test-multi-member-x-13@example.com");
      const membershipX = await prisma.membership.create({
        data: { accountId: secondMemberX.id, communityId: communityX, role: "MEMBER", operationalEpoch: 1 },
      });
      const partial = await suspendAccount(masterId, soleAdmin.accountId, {
        replacementAdministratorAssignments: [{ communityId: communityX, membershipId: membershipX.id }],
      });
      expect(partial).toEqual({ ok: false, reason: "would_orphan_communities", affectedCommunityIds: [communityY.id] });

      // Supplying replacements for both succeeds.
      const secondMemberY = await createVerifiedAccount("mat-test-multi-member-y-13@example.com");
      const membershipY = await prisma.membership.create({
        data: { accountId: secondMemberY.id, communityId: communityY.id, role: "MEMBER", operationalEpoch: 1 },
      });
      const accepted = await suspendAccount(masterId, soleAdmin.accountId, {
        replacementAdministratorAssignments: [
          { communityId: communityX, membershipId: membershipX.id },
          { communityId: communityY.id, membershipId: membershipY.id },
        ],
      });
      expect(accepted).toEqual({ ok: true });

      expect((await prisma.membership.findUniqueOrThrow({ where: { id: membershipX.id } })).role).toBe("ADMINISTRATOR");
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: membershipY.id } })).role).toBe("ADMINISTRATOR");
    });
  });
});
