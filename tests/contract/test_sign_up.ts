import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as signUp } from "../../app/api/auth/sign-up/route";
import { GET as verifyEmail } from "../../app/api/auth/verify-email/route";
import { __setEmailTransportForTests } from "@/lib/email/sendEmail";
import { __setPasswordBreachCheckerForTests } from "@/lib/validation/password";
import { signInWithPassword } from "@/server/services/accountService";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/auth/sign-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function verifyRequest(token: string) {
  const url = new URL("http://localhost/api/auth/verify-email");
  url.searchParams.set("token", token);
  return new Request(url);
}

function extractToken(emailText: string): string {
  const match = /token=([^\s&]+)/.exec(emailText);
  if (!match) throw new Error(`no verification token found in email body: ${emailText}`);
  return decodeURIComponent(match[1]);
}

describe("POST /api/auth/sign-up (contract)", () => {
  const sentEmails: { to: string; text: string }[] = [];

  beforeEach(async () => {
    sentEmails.length = 0;
    __setEmailTransportForTests({
      async send(message) {
        sentEmails.push({ to: message.to, text: message.text });
      },
    });
    __setPasswordBreachCheckerForTests(async () => false);
    // Scoped to this file's own accounts only — VerificationToken cascades
    // from Account (schema.prisma), and an unscoped deleteMany here would
    // race with other contract test files sharing the same test database.
    await prisma.account.deleteMany({ where: { email: { contains: "contract-signup" } } });
  });

  afterAll(async () => {
    __setEmailTransportForTests(undefined);
    __setPasswordBreachCheckerForTests(undefined);
    await prisma.$disconnect();
  });

  it("returns 202 and creates an unverified account, with its displayName, for a new email", async () => {
    const response = await signUp(
      postRequest({
        displayName: "Ada Lovelace",
        email: "contract-signup-1@example.com",
        password: "correct-horse-battery",
      }),
    );
    expect(response.status).toBe(202);

    const account = await prisma.account.findUnique({
      where: { email: "contract-signup-1@example.com" },
    });
    expect(account).not.toBeNull();
    expect(account?.displayName).toBe("Ada Lovelace");
    expect(account?.emailVerifiedAt).toBeNull();
    expect(account?.passwordHash).toBeNull(); // FR-019: no credential attached before verification
    expect(sentEmails).toHaveLength(1);
  });

  it("returns 400 for a password shorter than 8 characters", async () => {
    const response = await signUp(
      postRequest({
        displayName: "Test User",
        email: "contract-signup-2@example.com",
        password: "short1",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for a syntactically invalid email", async () => {
    const response = await signUp(
      postRequest({ displayName: "Test User", email: "not-an-email", password: "longenough1" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 and creates no account when displayName is missing", async () => {
    const email = "contract-signup-no-name@example.com";
    const response = await signUp(postRequest({ email, password: "longenough1" }));
    expect(response.status).toBe(400);

    const account = await prisma.account.findUnique({ where: { email } });
    expect(account).toBeNull();
  });

  it("returns 400 and creates no account when displayName is blank after trimming", async () => {
    const email = "contract-signup-blank-name@example.com";
    const response = await signUp(
      postRequest({ displayName: "   ", email, password: "longenough1" }),
    );
    expect(response.status).toBe(400);

    const account = await prisma.account.findUnique({ where: { email } });
    expect(account).toBeNull();
  });

  it("FR-009: responds identically for a repeated sign-up, and consuming either party's own token applies only their own password", async () => {
    const email = "contract-signup-3@example.com";
    const attackerPassword = "attacker-password-123";
    const ownerPassword = "owner-password-456";

    const first = await signUp(
      postRequest({ displayName: "Signup Three", email, password: attackerPassword }),
    );
    const firstBody = await first.json();

    const second = await signUp(
      postRequest({ displayName: "Signup Three", email, password: ownerPassword }),
    );
    const secondBody = await second.json();

    expect(second.status).toBe(202);
    expect(secondBody).toEqual(firstBody); // FR-009: identical response either way

    const count = await prisma.account.count({ where: { email } });
    expect(count).toBe(1); // no duplicate account created

    // Still unverified: neither candidate password authenticates yet.
    expect((await signInWithPassword(email, attackerPassword)).ok).toBe(false);
    expect((await signInWithPassword(email, ownerPassword)).ok).toBe(false);

    // Security amendment #3 (FR-019): the second sign-up does NOT invalidate
    // the first — both tokens remain independently live. Consuming the one
    // from the second (most recent) email applies its own candidate.
    const latestEmail = sentEmails.at(-1)!;
    const token = extractToken(latestEmail.text);
    const verifyResponse = await verifyEmail(verifyRequest(token));
    expect(verifyResponse.status).toBe(200);

    // FR-019/FR-020: whichever token was actually consumed determines the
    // credential — here, the owner's (see test_signup_token_coexistence.ts
    // for the full coexistence + "first consumption wins" behavior).
    expect((await signInWithPassword(email, attackerPassword)).ok).toBe(false);
    expect((await signInWithPassword(email, ownerPassword)).ok).toBe(true);
  });

  it("FR-021: rate-limits repeated sign-up attempts for the same email while preserving identical non-enumeration responses", async () => {
    const email = "contract-signup-ratelimit@example.com";
    const attemptCount = 7;
    const responses: unknown[] = [];

    for (let i = 0; i < attemptCount; i += 1) {
      const response = await signUp(
        postRequest({ displayName: "Rate Limit Tester", email, password: `attempt-password-${i}` }),
      );
      responses.push(await response.json());
      expect(response.status).toBe(202); // identical response even once rate-limited
    }

    for (const body of responses) {
      expect(body).toEqual(responses[0]); // FR-009: non-enumeration preserved throughout
    }

    // Beyond the threshold, no further tokens/emails are issued at all.
    expect(sentEmails.length).toBeLessThan(attemptCount);
    expect(sentEmails.length).toBe(5);
  });
});
