import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { setDisplayName } from "@/server/services/accountService";

function createVerifiedAccount(email: string) {
  return prisma.account.create({
    data: { email, passwordHash: "irrelevant-hash", emailVerifiedAt: new Date() },
  });
}

describe("setDisplayName (contract, FR-002, FR-012)", () => {
  beforeEach(async () => {
    await prisma.account.deleteMany({ where: { email: { contains: "display-name-test" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sets a valid display name and stores it", async () => {
    const account = await createVerifiedAccount("display-name-test-1@example.com");

    const result = await setDisplayName(account.id, "Ada Lovelace");

    expect(result).toEqual({ ok: true, account: { id: account.id, displayName: "Ada Lovelace" } });
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.displayName).toBe("Ada Lovelace");
  });

  it("trims surrounding whitespace before storing", async () => {
    const account = await createVerifiedAccount("display-name-test-2@example.com");

    const result = await setDisplayName(account.id, "  Grace Hopper  ");

    expect(result).toEqual({ ok: true, account: { id: account.id, displayName: "Grace Hopper" } });
  });

  it("rejects a blank or whitespace-only name, leaving the account unchanged", async () => {
    const account = await createVerifiedAccount("display-name-test-3@example.com");
    await setDisplayName(account.id, "Existing Name");

    const blank = await setDisplayName(account.id, "   ");
    expect(blank).toEqual({ ok: false, reason: "invalid_display_name" });

    const unchanged = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(unchanged.displayName).toBe("Existing Name");
  });

  it("rejects a name over 50 characters", async () => {
    const account = await createVerifiedAccount("display-name-test-4@example.com");

    const result = await setDisplayName(account.id, "a".repeat(51));

    expect(result).toEqual({ ok: false, reason: "invalid_display_name" });
    const unchanged = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(unchanged.displayName).toBeNull();
  });

  it("accepts a name at exactly the 50 character limit", async () => {
    const account = await createVerifiedAccount("display-name-test-5@example.com");
    const name = "a".repeat(50);

    const result = await setDisplayName(account.id, name);

    expect(result).toEqual({ ok: true, account: { id: account.id, displayName: name } });
  });
});
