import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET as verifyEmail } from "../../app/api/auth/verify-email/route";
import { issueVerificationToken } from "@/server/services/verificationService";

function getRequest(token: string | null) {
  const url = new URL("http://localhost/api/auth/verify-email");
  if (token !== null) url.searchParams.set("token", token);
  return new Request(url);
}

describe("GET /api/auth/verify-email (contract)", () => {
  beforeEach(async () => {
    // Scoped to this file's own accounts — see test_sign_up.ts for why an
    // unscoped verificationToken.deleteMany() is unsafe here (cascades from
    // Account, so this alone is sufficient).
    await prisma.account.deleteMany({ where: { email: { contains: "contract-verify" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("400s when no token is supplied", async () => {
    const response = await verifyEmail(getRequest(null));
    expect(response.status).toBe(400);
  });

  it("400s for a malformed/unknown token", async () => {
    const response = await verifyEmail(getRequest("not-a-real-token"));
    expect(response.status).toBe(400);
  });

  it("200s, verifies the account for a valid token, and applies its candidate credential", async () => {
    const account = await prisma.account.create({
      data: { email: "contract-verify-1@example.com", passwordHash: null, emailVerifiedAt: null },
    });
    const token = await issueVerificationToken(account.id, "fake-candidate-hash-1");

    const response = await verifyEmail(getRequest(token));
    expect(response.status).toBe(200);

    const updated = await prisma.account.findUnique({ where: { id: account.id } });
    expect(updated?.emailVerifiedAt).not.toBeNull();
    expect(updated?.passwordHash).toBe("fake-candidate-hash-1"); // FR-020
  });

  it("400s when the same token is used a second time (already consumed)", async () => {
    const account = await prisma.account.create({
      data: { email: "contract-verify-2@example.com", passwordHash: null, emailVerifiedAt: null },
    });
    const token = await issueVerificationToken(account.id, "fake-candidate-hash-2");

    await verifyEmail(getRequest(token));
    const second = await verifyEmail(getRequest(token));
    expect(second.status).toBe(400);
  });

  it("FR-020: does not modify passwordHash when the account is already verified by the time the token is consumed", async () => {
    const account = await prisma.account.create({
      data: {
        email: "contract-verify-3@example.com",
        passwordHash: "already-set-hash",
        emailVerifiedAt: new Date(),
      },
    });
    // Simulates a token that survives to consumption after the account was
    // verified through another path (e.g. Google auto-link) — constructed
    // directly to exercise the defensive guard, since the normal invalidate-
    // on-reissue flow (FR-014/FR-019) wouldn't otherwise leave such a token.
    const token = await issueVerificationToken(account.id, "attacker-candidate-hash");

    const response = await verifyEmail(getRequest(token));
    expect(response.status).toBe(200); // still succeeds — the email IS verified

    const updated = await prisma.account.findUnique({ where: { id: account.id } });
    expect(updated?.passwordHash).toBe("already-set-hash"); // untouched
  });

  it("FR-022: a null-candidate token does not verify an account with no credential of its own", async () => {
    const account = await prisma.account.create({
      data: { email: "contract-verify-4@example.com", passwordHash: null, emailVerifiedAt: null },
    });
    // Reachable today only via direct construction like this (no code path
    // in signUp()/resendVerification() issues a null candidate against a
    // truly credential-less account in normal use) — defends against a
    // future caller (e.g. community bootstrap) that might.
    const token = await issueVerificationToken(account.id, null);

    const response = await verifyEmail(getRequest(token));
    expect(response.status).toBe(400); // MUST NOT verify — would be a permanent dead end

    const updated = await prisma.account.findUnique({ where: { id: account.id } });
    expect(updated?.emailVerifiedAt).toBeNull();
    expect(updated?.passwordHash).toBeNull();
  });
});
