import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as signUp } from "../../app/api/auth/sign-up/route";
import { POST as resendVerification } from "../../app/api/auth/resend-verification/route";
import { EmailDeliveryError, __setEmailTransportForTests } from "@/lib/email/sendEmail";
import { __setPasswordBreachCheckerForTests } from "@/lib/validation/password";
import { RATE_LIMIT_MAX_TOKENS } from "@/server/services/verificationService";

/**
 * Hotfix v1.0.1: when the verification email cannot be sent, the member gets a
 * clear, retryable error instead of a generic 500, and a failed attempt does
 * not burn the per-account issuance rate limit. Previously each failed attempt
 * still left a token behind, so after RATE_LIMIT_MAX_TOKENS failures the next
 * sign-up "succeeded" (202) without sending anything.
 */

const PASSWORD = "correct-horse-battery-staple";

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const signUpRequest = (email: string) =>
  post("http://localhost/api/auth/sign-up", {
    email,
    password: PASSWORD,
    displayName: "Retry Tester",
  });

describe("sign-up when the verification email cannot be sent (contract)", () => {
  const sent: string[] = [];
  let failing = true;

  beforeEach(async () => {
    sent.length = 0;
    failing = true;
    __setEmailTransportForTests({
      async send(message) {
        if (failing)
          throw new EmailDeliveryError(
            401,
            "Email webhook responded with status 401: API key is invalid",
          );
        sent.push(message.to);
      },
    });
    __setPasswordBreachCheckerForTests(async () => false);
    await prisma.account.deleteMany({ where: { email: { contains: "contract-emailfail" } } });
  });

  afterAll(async () => {
    __setEmailTransportForTests(undefined);
    __setPasswordBreachCheckerForTests(undefined);
    await prisma.$disconnect();
  });

  it("responds 503 with a clear, retryable message", async () => {
    const response = await signUp(signUpRequest("contract-emailfail-1@example.com"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/couldn't send the verification email/i);
    expect(body.error).toMatch(/try again/i);
    // The provider's detail stays in the server log, never in the response.
    expect(JSON.stringify(body)).not.toContain("API key");
  });

  it("leaves no verification token behind for a failed send", async () => {
    await signUp(signUpRequest("contract-emailfail-2@example.com"));
    const account = await prisma.account.findUniqueOrThrow({
      where: { email: "contract-emailfail-2@example.com" },
    });
    expect(account.emailVerifiedAt).toBeNull();
    expect(await prisma.verificationToken.count({ where: { accountId: account.id } })).toBe(0);
  });

  it("can be retried: once delivery works, the next attempt sends the email", async () => {
    const email = "contract-emailfail-3@example.com";
    expect((await signUp(signUpRequest(email))).status).toBe(503);

    failing = false;
    expect((await signUp(signUpRequest(email))).status).toBe(202);
    expect(sent).toEqual([email]);
  });

  it("failed attempts do not consume the rate limit", async () => {
    const email = "contract-emailfail-4@example.com";
    for (let i = 0; i < RATE_LIMIT_MAX_TOKENS + 1; i += 1) {
      expect((await signUp(signUpRequest(email))).status).toBe(503);
    }

    failing = false;
    expect((await signUp(signUpRequest(email))).status).toBe(202);
    expect(sent).toEqual([email]);
  });

  it("resend-verification also reports a failed send clearly", async () => {
    const email = "contract-emailfail-5@example.com";
    failing = false;
    await signUp(signUpRequest(email));
    failing = true;

    const response = await resendVerification(
      post("http://localhost/api/auth/resend-verification", { email }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/couldn't send the verification email/i);
  });
});
