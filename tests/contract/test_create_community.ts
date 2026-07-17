import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import { toCurrentAccountPayload } from "@/lib/auth/currentAccount";

function createVerifiedAccount(email: string) {
  return prisma.account.create({
    data: { email, passwordHash: "irrelevant-hash", emailVerifiedAt: new Date() },
  });
}

function createUnverifiedAccount(email: string) {
  return prisma.account.create({ data: { email, passwordHash: null, emailVerifiedAt: null } });
}

describe("createCommunity (contract)", () => {
  beforeEach(async () => {
    // Community deletion cascades to Membership (schema.prisma); scoped to
    // this file's own fixtures so parallel contract test files don't race.
    await prisma.community.deleteMany({ where: { name: { contains: "Contract Test Community" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "contract-community" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // T006 (US1): success path — FR-001, FR-005, FR-006, FR-007, FR-008, FR-011, FR-013.
  it("creates the community and exactly one ADMINISTRATOR membership for a verified account, with an audit trail", async () => {
    const founder = await createVerifiedAccount("contract-community-founder-1@example.com");

    const result = await createCommunity({
      name: "Contract Test Community One",
      founderEmail: founder.email,
      invokedBy: "test-operator",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const community = await prisma.community.findUnique({ where: { id: result.community.id } });
    expect(community).not.toBeNull();
    expect(community?.name).toBe("Contract Test Community One");
    expect(community?.createdByOperator).toBe("test-operator"); // FR-013

    const memberships = await prisma.membership.findMany({ where: { communityId: result.community.id } });
    expect(memberships).toHaveLength(1); // FR-008: the only membership produced
    expect(memberships[0].accountId).toBe(founder.id);
    expect(memberships[0].role).toBe("ADMINISTRATOR");

    // FR-005/FR-006: the founder's account is never touched.
    const founderAfter = await prisma.account.findUnique({ where: { id: founder.id } });
    expect(founderAfter).toEqual(founder);
  });

  // T006 (US1): FR-014.
  it("rejects a blank/whitespace-only name, writing nothing, even with a valid account", async () => {
    const founder = await createVerifiedAccount("contract-community-founder-2@example.com");

    const result = await createCommunity({
      name: "   ",
      founderEmail: founder.email,
      invokedBy: "test-operator",
    });

    expect(result).toEqual({ ok: false, reason: "invalid_name" });
    const membership = await prisma.membership.findFirst({ where: { accountId: founder.id } });
    expect(membership).toBeNull();
  });

  // T006 (US1): FR-009 — verified against a genuinely unrelated account B, never A,
  // and never via toCurrentAccountPayload() (see FR-015's separate test below).
  it("FR-009: a community founded for A produces no real membership for an unrelated account B", async () => {
    const founderA = await createVerifiedAccount("contract-community-founder-3@example.com");
    const accountB = await createVerifiedAccount("contract-community-nonmember-b@example.com");

    const result = await createCommunity({
      name: "Contract Test Community Three",
      founderEmail: founderA.email,
      invokedBy: "test-operator",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const membershipForB = await prisma.membership.findFirst({
      where: { communityId: result.community.id, accountId: accountB.id },
    });
    expect(membershipForB).toBeNull();
  });

  // T006 (US1): FR-015 — a distinct claim from FR-009, asserted separately.
  it("FR-015: the founder's own existing session payload is unchanged immediately after creation", async () => {
    const founder = await createVerifiedAccount("contract-community-founder-4@example.com");

    const result = await createCommunity({
      name: "Contract Test Community Four",
      founderEmail: founder.email,
      invokedBy: "test-operator",
    });
    expect(result.ok).toBe(true);

    const payload = toCurrentAccountPayload({
      accountId: founder.id,
      email: founder.email,
      emailVerifiedAt: founder.emailVerifiedAt,
    });
    expect(payload.memberships).toEqual([]);
  });

  // T006 (US1): Scenario 3 — the same account founds a second, independent community.
  it("the same account can found a second, independent community", async () => {
    const founder = await createVerifiedAccount("contract-community-founder-5@example.com");

    const first = await createCommunity({
      name: "Contract Test Community Five A",
      founderEmail: founder.email,
      invokedBy: "test-operator",
    });
    const second = await createCommunity({
      name: "Contract Test Community Five B",
      founderEmail: founder.email,
      invokedBy: "test-operator",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected both to succeed");
    expect(first.community.id).not.toBe(second.community.id);

    const memberships = await prisma.membership.findMany({ where: { accountId: founder.id } });
    expect(memberships).toHaveLength(2);
    expect(memberships.map((m) => m.communityId).sort()).toEqual(
      [first.community.id, second.community.id].sort(),
    );
  });

  // T007 (US2): FR-003.
  it("FR-003: rejects a founderEmail matching no Account, with no side effects", async () => {
    const email = "contract-community-nonexistent@example.com";

    const result = await createCommunity({
      name: "Contract Test Community Six",
      founderEmail: email,
      invokedBy: "test-operator",
    });

    expect(result).toEqual({ ok: false, reason: "account_not_found" });
    expect(await prisma.account.findUnique({ where: { email } })).toBeNull();
    expect(
      await prisma.community.findFirst({ where: { name: "Contract Test Community Six" } }),
    ).toBeNull();
  });

  // T008 (US3): FR-004 — distinguishable from FR-003, target account byte-for-byte unchanged.
  it("FR-004: rejects an unverified founderEmail, distinct from account_not_found, leaving the account untouched", async () => {
    const before = await createUnverifiedAccount("contract-community-unverified@example.com");

    const result = await createCommunity({
      name: "Contract Test Community Seven",
      founderEmail: before.email,
      invokedBy: "test-operator",
    });

    expect(result).toEqual({ ok: false, reason: "account_not_verified" });
    expect(result).not.toEqual({ ok: false, reason: "account_not_found" });

    const after = await prisma.account.findUnique({ where: { id: before.id } });
    expect(after).toEqual(before);
    expect(
      await prisma.community.findFirst({ where: { name: "Contract Test Community Seven" } }),
    ).toBeNull();
  });
});
