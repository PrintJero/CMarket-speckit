import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as resendVerification } from "../../app/api/auth/resend-verification/route";
import { POST as signUp } from "../../app/api/auth/sign-up/route";
import { GET as verifyEmail } from "../../app/api/auth/verify-email/route";
import { __setEmailTransportForTests } from "@/lib/email/sendEmail";
import { __setPasswordBreachCheckerForTests } from "@/lib/validation/password";
import { signInWithPassword } from "@/server/services/accountService";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function signUpRequest(body: unknown) {
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

describe("POST /api/auth/resend-verification (contract)", () => {
  const sentEmails: { to: string; text: string }[] = [];

  beforeEach(async () => {
    sentEmails.length = 0;
    __setEmailTransportForTests({
      async send(message) {
        sentEmails.push({ to: message.to, text: message.text });
      },
    });
    __setPasswordBreachCheckerForTests(async () => false);
    // Scoped to this file's own accounts — see test_sign_up.ts for why an
    // unscoped verificationToken.deleteMany() is unsafe here (cascades from
    // Account, so this alone is sufficient).
    await prisma.account.deleteMany({ where: { email: { contains: "contract-resend" } } });
  });

  afterAll(async () => {
    __setEmailTransportForTests(undefined);
    __setPasswordBreachCheckerForTests(undefined);
    await prisma.$disconnect();
  });

  it("202s and sends a new email for an existing unverified account", async () => {
    await prisma.account.create({
      data: { email: "contract-resend-1@example.com", passwordHash: null, emailVerifiedAt: null },
    });

    const response = await resendVerification(
      postRequest({ email: "contract-resend-1@example.com" }),
    );
    expect(response.status).toBe(202);
    expect(sentEmails).toHaveLength(1);
  });

  it("202s (non-enumeration) even when the email has no account at all", async () => {
    const response = await resendVerification(
      postRequest({ email: "contract-resend-nonexistent@example.com" }),
    );
    expect(response.status).toBe(202);
    expect(sentEmails).toHaveLength(0);
  });

  it("202s but sends nothing for an already-verified account", async () => {
    await prisma.account.create({
      data: {
        email: "contract-resend-2@example.com",
        passwordHash: "x",
        emailVerifiedAt: new Date(),
      },
    });

    const response = await resendVerification(
      postRequest({ email: "contract-resend-2@example.com" }),
    );
    expect(response.status).toBe(202);
    expect(sentEmails).toHaveLength(0);
  });

  it("FR-014: still invalidates the prior token and preserves its candidate credential", async () => {
    const email = "contract-resend-3@example.com";
    const password = "resend-preserve-password-123";

    const signUpResponse = await signUp(
      signUpRequest({ displayName: "Resend Preserve", email, password }),
    );
    expect(signUpResponse.status).toBe(202);
    expect(sentEmails).toHaveLength(1);
    const firstToken = extractToken(sentEmails[0].text);

    const resendResponse = await resendVerification(postRequest({ email }));
    expect(resendResponse.status).toBe(202);
    expect(sentEmails).toHaveLength(2);
    const secondToken = extractToken(sentEmails[1].text);

    // Unlike a competing sign-up, a resend DOES invalidate the token it replaces.
    const firstAttempt = await verifyEmail(verifyRequest(firstToken));
    expect(firstAttempt.status).toBe(400);

    // The re-sent token still carries the SAME candidate credential.
    const secondAttempt = await verifyEmail(verifyRequest(secondToken));
    expect(secondAttempt.status).toBe(200);
    expect((await signInWithPassword(email, password)).ok).toBe(true);
  });
});
