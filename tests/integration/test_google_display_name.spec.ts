import { expect, test, type APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { setDisplayName } from "@/server/services/accountService";
import { uniqueEmail } from "./helpers";

/**
 * US3 (FR-004/FR-005/FR-006, Edge Cases): driving the real
 * /api/auth/[...nextauth] Google callback against the mocked OAuth boundary
 * (research.md #2) — never the adapter called directly, per spec.md's own
 * instruction. The mock server's own profile fixture is set via its
 * test-only HTTP control endpoint before each sign-in, since the browser
 * (not this test process) is what actually drives the OAuth round trip.
 */

const MOCK_URL = process.env.GOOGLE_OAUTH_MOCK_URL ?? "http://localhost:4310";

async function setMockProfile(
  request: APIRequestContext,
  profile: { sub: string; email: string; email_verified: boolean; name?: string },
): Promise<void> {
  const response = await request.post(`${MOCK_URL}/_test/set-profile`, { data: profile });
  if (!response.ok()) {
    throw new Error(`failed to set mock Google profile: ${response.status()}`);
  }
}

function mockSub(): string {
  return `mock-sub-${Math.floor(Math.random() * 1e9)}`;
}

test.describe("Google sign-in populates displayName via the real callback route (US3)", () => {
  // The mock OAuth server (scripts/mock-google-oauth-server.ts) holds a single
  // mutable "current profile" set via its test-only control endpoint — safe
  // for one sign-in at a time, not for concurrent workers racing each other.
  test.describe.configure({ mode: "serial" });

  test("a brand-new email arrives already named from the mocked profile, with no prompt", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("google-new-named");
    await setMockProfile(request, {
      sub: mockSub(),
      email,
      email_verified: true,
      name: "Ada Lovelace",
    });

    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.waitForURL("/");

    const account = await prisma.account.findUniqueOrThrow({ where: { email } });
    expect(account.displayName).toBe("Ada Lovelace");
  });

  test("an existing unverified email/password account is auto-linked and named from the mocked profile (FR-005, FR-018)", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("google-link-unverified");
    await prisma.account.create({
      data: { email, passwordHash: await hashPassword("whatever-password-1"), emailVerifiedAt: null },
    });
    await setMockProfile(request, {
      sub: mockSub(),
      email,
      email_verified: true,
      name: "Grace Hopper",
    });

    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.waitForURL("/");

    const account = await prisma.account.findUniqueOrThrow({ where: { email } });
    expect(account.displayName).toBe("Grace Hopper");
    expect(account.emailVerifiedAt).not.toBeNull();
  });

  test("an existing verified account that already has its own display name is left unchanged (FR-006)", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("google-link-already-named");
    const existing = await prisma.account.create({
      data: { email, passwordHash: await hashPassword("whatever-password-2"), emailVerifiedAt: new Date() },
    });
    await setDisplayName(existing.id, "Self-Chosen Name");
    await setMockProfile(request, {
      sub: mockSub(),
      email,
      email_verified: true,
      name: "Provider Overwrite Attempt",
    });

    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.waitForURL("/");

    const account = await prisma.account.findUniqueOrThrow({ where: { id: existing.id } });
    expect(account.displayName).toBe("Self-Chosen Name");
  });

  test("a mocked profile with no name at all leaves a brand-new account's display name null, not an error (Edge Cases)", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("google-new-noname");
    await setMockProfile(request, {
      sub: mockSub(),
      email,
      email_verified: true,
    });

    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.waitForURL("/");

    const account = await prisma.account.findUniqueOrThrow({ where: { email } });
    expect(account.displayName).toBeNull();
  });
});
