import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import { createSession, setActiveCommunityForAccount } from "@/server/services/sessionService";

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
 * 015-navigation-shell-community-selector, T002 (US3 — the community-scoping
 * guarantee this feature mandates automated coverage for). Tests
 * setActiveCommunityForAccount() directly rather than the POST
 * /api/active-community route's HTTP layer, matching this codebase's
 * established contract-test convention (every other tests/contract/*.ts file
 * exercises its service function directly, not its route.ts wrapper).
 */
describe("setActiveCommunityForAccount (contract)", () => {
  beforeEach(async () => {
    await prisma.community.deleteMany({ where: { name: { contains: "Active Community Test" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "active-community-test" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists the active community for a caller who currently belongs to it (FR-002)", async () => {
    const { community: communityA } = await createCommunityWithAdmin(
      "Active Community Test A",
      "active-community-test-admin-a@example.com",
    );
    const member = await addMember(communityA.id, "active-community-test-member-1@example.com");
    await createSession(member.id, "raw-token-active-community-1");

    const result = await setActiveCommunityForAccount(member.id, "raw-token-active-community-1", communityA.id);

    expect(result).toEqual({ ok: true, communityId: communityA.id });
    // Looked up by accountId, not the raw token — the DB column stores a hash of the token, not the raw value.
    const session = await prisma.session.findFirst({ where: { accountId: member.id } });
    expect(session?.activeCommunityId).toBe(communityA.id);
  });

  it("rejects a communityId the caller does not currently belong to (FR-009, 403 not_a_member)", async () => {
    const { community: communityA } = await createCommunityWithAdmin(
      "Active Community Test A2",
      "active-community-test-admin-a2@example.com",
    );
    const { community: communityB } = await createCommunityWithAdmin(
      "Active Community Test B2",
      "active-community-test-admin-b2@example.com",
    );
    const memberOfAOnly = await addMember(communityA.id, "active-community-test-member-2@example.com");
    await createSession(memberOfAOnly.id, "raw-token-active-community-2");

    const result = await setActiveCommunityForAccount(
      memberOfAOnly.id,
      "raw-token-active-community-2",
      communityB.id,
    );

    expect(result).toEqual({ ok: false, reason: "not_a_member" });
  });

  it("rejects a nonexistent communityId identically to a real one the caller doesn't belong to (no information disclosure)", async () => {
    const { community: communityA } = await createCommunityWithAdmin(
      "Active Community Test A3",
      "active-community-test-admin-a3@example.com",
    );
    const member = await addMember(communityA.id, "active-community-test-member-3@example.com");
    await createSession(member.id, "raw-token-active-community-3");

    const result = await setActiveCommunityForAccount(
      member.id,
      "raw-token-active-community-3",
      "nonexistent-community-id",
    );

    expect(result).toEqual({ ok: false, reason: "not_a_member" });
  });

  it("rejects a missing or non-string communityId (400 invalid_input)", async () => {
    const { community: communityA } = await createCommunityWithAdmin(
      "Active Community Test A4",
      "active-community-test-admin-a4@example.com",
    );
    const member = await addMember(communityA.id, "active-community-test-member-4@example.com");
    await createSession(member.id, "raw-token-active-community-4");

    expect(await setActiveCommunityForAccount(member.id, "raw-token-active-community-4", "")).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(await setActiveCommunityForAccount(member.id, "raw-token-active-community-4", undefined)).toEqual({
      ok: false,
      reason: "invalid_input",
    });
  });
});
