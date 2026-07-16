import type { APIRequestContext } from "@playwright/test";

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

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${process.pid}-${Math.floor(Math.random() * 1e9)}@example.com`;
}
