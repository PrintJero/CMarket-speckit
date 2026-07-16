import { hash, verify } from "@node-rs/argon2";

/**
 * research.md #1: Argon2id, OWASP-recommended cost parameters
 * (m=19456 KiB, t=2, p=1). FR-011: one-way hash, plaintext is never stored.
 *
 * `algorithm: 2` is `Algorithm.Argon2id` — that ambient const enum can't be
 * imported as a value under Next.js's required `isolatedModules`, so the
 * numeric value is used directly (stable across @node-rs/argon2 versions).
 */
const ARGON2ID_OPTIONS = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID_OPTIONS);
}

/**
 * FR-012: the only way a password-based sign-in can succeed is by verifying
 * the submitted password against this stored hash — there is no bypass.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  return verify(storedHash, password);
}
