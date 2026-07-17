import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { buildPrismaAuthAdapter } from "@/lib/auth/prismaAuthAdapter";
import { authOptions } from "@/lib/auth/authConfig";
import { generateSessionToken } from "@/server/services/sessionService";
import { uniqueEmail } from "./helpers";

/**
 * FR-025 (2026-07-17 bug-fix amendment). Google sign-in completed (Auth.js
 * returned a successful callback, a Session row was created) but
 * getCurrentAccount() never resolved the account afterward, because
 * getCurrentAccount() reads a cookie named `cmarket_session` while
 * unconfigured Auth.js sets its own default (`next-auth.session-token`).
 *
 * Driving Google's real consent screen isn't feasible in tests (same
 * rationale as the other Google specs), so a session is established through
 * the real Auth.js adapter directly — the exact code NextAuth's core
 * callback handler invokes — and the resulting raw token is set as a real
 * browser cookie under whatever name Auth.js is actually configured to
 * write. This is what crosses the seam none of the other Google tests cross:
 * a real page load, resolved through the real getCurrentAccount() cookie
 * read, not just an assertion against database rows.
 */

// Falls back to NextAuth v4's own unconfigured default for this test
// environment (NEXTAUTH_URL is http, so useSecureCookies is false and no
// "__Secure-" prefix applies) — this is the name Auth.js actually wrote
// before FR-025's fix configured `cookies.sessionToken.name` explicitly.
const AUTH_JS_DEFAULT_COOKIE_NAME = "next-auth.session-token";

async function establishGoogleSession(email: string) {
  const adapter = buildPrismaAuthAdapter();
  const providerAccountId = `google-${Math.floor(Math.random() * 1e9)}`;

  const user = await adapter.createUser!({ email, emailVerified: null } as never);
  await adapter.linkAccount!({
    provider: "google",
    providerAccountId,
    userId: user.id,
    type: "oauth",
  } as never);

  const rawSessionToken = generateSessionToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await adapter.createSession!({ sessionToken: rawSessionToken, userId: user.id, expires });

  return { accountId: user.id, rawSessionToken };
}

function resolvedAuthJsCookieName(): string {
  return authOptions.cookies?.sessionToken?.name ?? AUTH_JS_DEFAULT_COOKIE_NAME;
}

test("a session established through the Auth.js adapter resolves via getCurrentAccount() once its cookie is set under Auth.js's configured name (FR-025)", async ({
  page,
}) => {
  const email = uniqueEmail("google-cookie-seam");
  const { rawSessionToken } = await establishGoogleSession(email);

  await page.context().addCookies([
    {
      name: resolvedAuthJsCookieName(),
      value: rawSessionToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    },
  ]);

  await page.goto("/");

  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
});

test("signing out clears the unified cookie and deletes the Session row for a Google-established session (FR-025, FR-008)", async ({
  page,
}) => {
  const email = uniqueEmail("google-cookie-signout");
  const { accountId, rawSessionToken } = await establishGoogleSession(email);

  await page.context().addCookies([
    {
      name: resolvedAuthJsCookieName(),
      value: rawSessionToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    },
  ]);

  await page.goto("/");
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  expect(await prisma.session.count({ where: { accountId } })).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("/");
  await expect(page.getByText(`Signed in as ${email}`)).toHaveCount(0);

  const cookiesAfterSignOut = await page.context().cookies();
  expect(cookiesAfterSignOut.find((cookie) => cookie.name === resolvedAuthJsCookieName())).toBeUndefined();
  expect(await prisma.session.count({ where: { accountId } })).toBe(0);
});
