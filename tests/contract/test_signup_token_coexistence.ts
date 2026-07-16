import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as signUp } from "../../app/api/auth/sign-up/route";
import { GET as verifyEmail } from "../../app/api/auth/verify-email/route";
import { __setEmailTransportForTests } from "@/lib/email/sendEmail";
import { __setPasswordBreachCheckerForTests } from "@/lib/validation/password";
import { signInWithPassword } from "@/server/services/accountService";

/**
 * Security amendment #3 (spec.md FR-019/FR-020, Story 1 scenarios 5-6):
 * a competing sign-up MUST NOT destroy an account holder's own pending
 * verification token. Multiple tokens may coexist; the first one consumed
 * wins and applies its own candidate credential; every other pending token
 * becomes dead at that same moment.
 */

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

describe("token coexistence across competing sign-ups", () => {
  const sentEmails: { to: string; text: string }[] = [];

  beforeEach(async () => {
    sentEmails.length = 0;
    __setEmailTransportForTests({
      async send(message) {
        sentEmails.push({ to: message.to, text: message.text });
      },
    });
    __setPasswordBreachCheckerForTests(async () => false);
    await prisma.account.deleteMany({ where: { email: { contains: "contract-coexist" } } });
  });

  afterAll(async () => {
    __setEmailTransportForTests(undefined);
    __setPasswordBreachCheckerForTests(undefined);
    await prisma.$disconnect();
  });

  it("the account holder's own token survives a competing sign-up, and consuming it applies their own password", async () => {
    const email = "contract-coexist-1@example.com";
    const victimPassword = "victim-password-123";
    const attackerPassword = "attacker-password-456";

    await signUp(postRequest({ email, password: victimPassword }));
    await signUp(postRequest({ email, password: attackerPassword }));

    expect(sentEmails).toHaveLength(2);
    const victimToken = extractToken(sentEmails[0].text);
    const attackerToken = extractToken(sentEmails[1].text);

    // The victim consumes THEIR OWN (first-issued) token.
    const victimVerify = await verifyEmail(verifyRequest(victimToken));
    expect(victimVerify.status).toBe(200);

    expect((await signInWithPassword(email, victimPassword)).ok).toBe(true);
    expect((await signInWithPassword(email, attackerPassword)).ok).toBe(false);

    // The attacker's token is dead now — it cannot be consumed to apply a
    // different credential, and the account's password is unaffected.
    const attackerVerify = await verifyEmail(verifyRequest(attackerToken));
    expect(attackerVerify.status).toBe(400);
    expect((await signInWithPassword(email, attackerPassword)).ok).toBe(false);
  });

  it("documents the residual honestly: whoever consumes a token first wins, even if it's the attacker's", async () => {
    const email = "contract-coexist-2@example.com";
    const victimPassword = "victim-password-789";
    const attackerPassword = "attacker-password-012";

    await signUp(postRequest({ email, password: victimPassword }));
    await signUp(postRequest({ email, password: attackerPassword }));

    const victimToken = extractToken(sentEmails[0].text);
    const attackerToken = extractToken(sentEmails[1].text);

    // The attacker consumes FIRST — this is not something FR-019/FR-020 can
    // prevent (see research.md #10): it's a first-click-wins race inherent
    // to any email-link verification scheme, not a defect this amendment
    // introduces.
    const attackerVerify = await verifyEmail(verifyRequest(attackerToken));
    expect(attackerVerify.status).toBe(200);

    expect((await signInWithPassword(email, attackerPassword)).ok).toBe(true);
    expect((await signInWithPassword(email, victimPassword)).ok).toBe(false);

    // The victim's own token is dead now too.
    const victimVerify = await verifyEmail(verifyRequest(victimToken));
    expect(victimVerify.status).toBe(400);
  });
});
