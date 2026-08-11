import type { APIRequestContext, Page } from "@playwright/test";

/** Reads the most recent verification link sent to `email` (test-only sink). */
export async function getVerificationLink(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const response = await request.get(
    `/api/test/last-email?to=${encodeURIComponent(email)}`,
  );
  if (!response.ok()) {
    throw new Error(`No captured email for ${email} (status ${response.status()})`);
  }
  const body = await response.json();
  const match = /(http:\/\/\S*\/verify-email\?token=\S+)/.exec(body.text);
  if (!match) {
    throw new Error(`No verification link found in captured email: ${body.text}`);
  }
  return match[1];
}

/** Reads the most recent invitation accept link sent to `email` (test-only sink). */
export async function getInvitationAcceptLink(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const response = await request.get(
    `/api/test/last-email?to=${encodeURIComponent(email)}`,
  );
  if (!response.ok()) {
    throw new Error(`No captured email for ${email} (status ${response.status()})`);
  }
  const body = await response.json();
  const match = /(http:\/\/\S*\/invitations\/accept\?token=\S+)/.exec(body.text);
  if (!match) {
    throw new Error(`No invitation link found in captured email: ${body.text}`);
  }
  return match[1];
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${process.pid}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

/**
 * Intercept the direct browser-to-Cloudinary upload (017-cloudinary-listing-media).
 *
 * Any test that drives the listing form's photo uploader MUST install this.
 * Without it the upload reaches the real api.cloudinary.com, fails against the
 * dummy test credentials, and the uploader correctly leaves the file in a
 * `failed` state — which disables the submit button (FR-012) and makes the test
 * time out on a click. That is the feature working, not a bug.
 *
 * The server-side half (Admin API verification and the delivery fetch) is
 * stubbed separately by CLOUDINARY_TEST_STUB, since Playwright cannot intercept
 * a call made from the server process.
 */
export async function stubCloudinaryUpload(
  page: Page,
  options: { failFor?: number[]; delayMs?: number } = {},
): Promise<{ inFlight: { peak: number }; uploadCount: () => number }> {
  let ordinal = 0;
  const inFlight = { current: 0, peak: 0 };

  await page.route("https://api.cloudinary.com/**", async (route) => {
    ordinal += 1;
    const mine = ordinal;
    inFlight.current += 1;
    inFlight.peak = Math.max(inFlight.peak, inFlight.current);

    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    inFlight.current -= 1;

    if (options.failFor?.includes(mine)) {
      await route.fulfill({ status: 500, body: "stubbed failure" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ asset_id: `stub-asset-${mine}`, public_id: `stub-${mine}` }),
    });
  });

  return { inFlight, uploadCount: () => ordinal };
}

/** Drives the real /sign-in form — there is no cookie-injection shortcut in this codebase. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}
