import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import { resolveLiveActiveCommunityId } from "@/lib/auth/currentAccount";

function createVerifiedAccount(email: string) {
  return prisma.account.create({
    data: { email, passwordHash: "irrelevant-hash", emailVerifiedAt: new Date(), displayName: "Test Member" },
  });
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

async function addMember(communityId: string, email: string) {
  const account = await createVerifiedAccount(email);
  await prisma.membership.create({ data: { accountId: account.id, communityId, role: "MEMBER" } });
  return account;
}

/**
 * 015-navigation-shell-community-selector, T003 (FR-001b, research.md #3).
 * Tests resolveLiveActiveCommunityId() directly — the piece of
 * getCurrentAccount() that re-verifies a session's stored activeCommunityId
 * — rather than getCurrentAccount() itself, since that depends on
 * next/headers' request-scoped cookies() and isn't callable outside a real
 * request (this codebase's other cookie-dependent behaviors are exercised via
 * Playwright, not vitest contract tests).
 */
describe("resolveLiveActiveCommunityId (contract)", () => {
  beforeEach(async () => {
    await prisma.community.deleteMany({ where: { name: { contains: "Current Account Test" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "current-account-test" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns null when nothing is stored (FR-001)", async () => {
    const { community } = await createCommunityWithAdmin(
      "Current Account Test A",
      "current-account-test-admin-a@example.com",
    );
    const member = await addMember(community.id, "current-account-test-member-1@example.com");

    expect(await resolveLiveActiveCommunityId(member.id, null)).toBeNull();
  });

  it("returns the stored community when the caller is still a current member of it", async () => {
    const { community } = await createCommunityWithAdmin(
      "Current Account Test B",
      "current-account-test-admin-b@example.com",
    );
    const member = await addMember(community.id, "current-account-test-member-2@example.com");

    expect(await resolveLiveActiveCommunityId(member.id, community.id)).toBe(community.id);
  });

  it("returns null when the caller's membership in the stored community was removed (FR-001b, edge case)", async () => {
    const { community } = await createCommunityWithAdmin(
      "Current Account Test C",
      "current-account-test-admin-c@example.com",
    );
    const member = await addMember(community.id, "current-account-test-member-3@example.com");
    await prisma.membership.delete({ where: { accountId_communityId: { accountId: member.id, communityId: community.id } } });

    expect(await resolveLiveActiveCommunityId(member.id, community.id)).toBeNull();
  });

  it("returns null when the stored community is no longer one the caller ever belonged to", async () => {
    const { community: communityA } = await createCommunityWithAdmin(
      "Current Account Test D",
      "current-account-test-admin-d@example.com",
    );
    const { community: communityB } = await createCommunityWithAdmin(
      "Current Account Test E",
      "current-account-test-admin-e@example.com",
    );
    const memberOfAOnly = await addMember(communityA.id, "current-account-test-member-4@example.com");

    expect(await resolveLiveActiveCommunityId(memberOfAOnly.id, communityB.id)).toBeNull();
  });

  it("returns null when the stored community has since been archived (FR-001b, 009-platform-administration)", async () => {
    const { community } = await createCommunityWithAdmin(
      "Current Account Test F",
      "current-account-test-admin-f@example.com",
    );
    const member = await addMember(community.id, "current-account-test-member-5@example.com");
    await prisma.community.update({ where: { id: community.id }, data: { status: "ARCHIVED" } });

    expect(await resolveLiveActiveCommunityId(member.id, community.id)).toBeNull();
  });
});
