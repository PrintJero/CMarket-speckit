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

/** Drives the real /sign-in form — there is no cookie-injection shortcut in this codebase. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}
