import { createHash } from "node:crypto";

export const MIN_PASSWORD_LENGTH = 8;

export type PasswordValidationResult =
  | { valid: true }
  | { valid: false; reason: "too_short" | "breached" };

let breachChecker: typeof isPasswordBreached = isPasswordBreached;

/**
 * Test-only hook so contract/unit tests don't make a real network call for
 * every password validated — mirrors sendEmail's test transport seam.
 */
export function __setPasswordBreachCheckerForTests(
  checker: typeof isPasswordBreached | undefined,
): void {
  breachChecker = checker ?? isPasswordBreached;
}

/**
 * FR-016: reject passwords shorter than 8 characters, or found on a known
 * breached-password list. No other composition rule is enforced.
 */
export async function validatePassword(
  password: string,
  deps: { checkBreached?: typeof isPasswordBreached } = {},
): Promise<PasswordValidationResult> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, reason: "too_short" };
  }

  const checkBreached = deps.checkBreached ?? breachChecker;
  if (await checkBreached(password)) {
    return { valid: false, reason: "breached" };
  }

  return { valid: true };
}

/**
 * research.md #4: Have I Been Pwned Pwned Passwords, k-anonymity range query.
 * Only a 5-character SHA-1 prefix ever leaves this server — never the
 * plaintext password, never the full hash.
 */
export async function isPasswordBreached(password: string): Promise<boolean> {
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { "Add-Padding": "true" },
  });

  if (!response.ok) {
    throw new Error(`Pwned Passwords lookup failed with status ${response.status}`);
  }

  const body = await response.text();
  return body
    .split("\n")
    .some((line) => line.split(":")[0]?.trim().toUpperCase() === suffix);
}
