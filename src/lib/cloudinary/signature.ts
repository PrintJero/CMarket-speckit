import { createHash } from "node:crypto";

/**
 * The two Cloudinary signature algorithms (017-cloudinary-listing-media,
 * research.md #3).
 *
 * THESE ARE TWO DIFFERENT ALGORITHMS AND MUST NOT SHARE AN IMPLEMENTATION.
 * They use the same secret and nothing else:
 *
 *   - upload   -> sorted body params, SHA-256, HEXADECIMAL
 *   - delivery -> `{transformation}/{publicId}`, SHA-256, URL-SAFE BASE64,
 *                 truncated to 8 characters
 *
 * A single "sign this" helper serving both is the shape that produces a
 * delivery URL Cloudinary answers with 401 — a hex digest inside `s--...--`
 * never validates. Two separate fixture suites in
 * tests/unit/test_cloudinary_signature.ts exist to keep them apart, including
 * an assertion that they differ for identical input.
 *
 * Server-only. Never import from a Client Component (FR-099).
 */

/**
 * Upload-signature body parameters. `public_id` carries the complete path, so
 * there is deliberately NO `folder` member: sending both would make the
 * resulting asset path depend on whether the account is in fixed-folder or
 * dynamic-folder mode (research.md #5).
 *
 * There is also NO `max_file_size`. It is an upload-PRESET setting, not an
 * upload-API request parameter — verified against the live service, which
 * rejected the signature and echoed a string-to-sign that omitted it. Sending it
 * makes every upload fail with "Invalid Signature". The 10 MB limit is instead
 * enforced at association time from the byte count Cloudinary reports, which is
 * authoritative rather than advisory: an oversized asset is refused and queued
 * for deletion, so it never becomes listing media (FR-006, FR-033).
 */
export interface SignedUploadParams {
  timestamp: number;
  public_id: string;
  type: "authenticated";
  allowed_formats: string;
  context: string;
}

/**
 * Parameters Cloudinary requires but which MUST NOT enter the string to sign.
 * Kept as a named constant so the exclusion is assertable by test rather than
 * being an implicit property of whatever the caller happened to pass.
 *
 * `resource_type` is excluded because it lives in the endpoint URL path
 * (`/image/upload`), not the signed body. `file` is the bytes themselves,
 * `cloud_name` is in the URL, and `api_key` travels alongside the signature
 * rather than inside it.
 */
export const UPLOAD_SIGNATURE_EXCLUDED_PARAMS = [
  "file",
  "cloud_name",
  "resource_type",
  "api_key",
] as const;

/**
 * Build the exact string Cloudinary expects to be hashed for a signed upload:
 * every signed body parameter sorted alphabetically by key and joined `k=v&k=v`.
 *
 * Exported separately from the digest so tests can pin the string itself —
 * the ordering is the part most likely to drift silently.
 */
export function buildUploadStringToSign(params: object): string {
  const excluded = new Set<string>(UPLOAD_SIGNATURE_EXCLUDED_PARAMS);
  return Object.entries(params as Record<string, unknown>)
    .filter(([key, value]) => !excluded.has(key) && value !== undefined && value !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
}

/**
 * Parameters signed for the destroy endpoint.
 *
 * Deliberately its own type rather than reusing SignedUploadParams: Cloudinary
 * signs EXACTLY the parameters present in the request, so padding the shape with
 * empty `allowed_formats`/`context` to match upload's would change the
 * string-to-sign and be rejected.
 */
export interface SignedDestroyParams {
  timestamp: number;
  public_id: string;
  type: "authenticated";
  /** FR-074: purges cached derivatives. Signable, so it must be signed. */
  invalidate: boolean;
}

/** Same algorithm as signUploadParams — sorted params, secret appended, SHA-256 hex. */
export function signDestroyParams(params: SignedDestroyParams, apiSecret: string): string {
  return createHash("sha256")
    .update(`${buildUploadStringToSign(params)}${apiSecret}`)
    .digest("hex");
}

/**
 * Upload signature: SHA-256 HEX of the sorted param string with the API secret
 * appended. Anything signed here is tamper-evident, which is what makes
 * `allowed_formats` and `max_file_size` real server-side enforcement rather
 * than advisory client hints (FR-033).
 */
export function signUploadParams(params: SignedUploadParams, apiSecret: string): string {
  const stringToSign = buildUploadStringToSign(params);
  return createHash("sha256").update(`${stringToSign}${apiSecret}`).digest("hex");
}

/** Number of characters of the delivery digest Cloudinary expects in `s--...--`. */
export const DELIVERY_SIGNATURE_LENGTH = 8;

/**
 * Delivery signature for `type: authenticated` assets.
 *
 * Signs exactly the URL components that FOLLOW the signature component —
 * `{transformation}/{publicId}` — then SHA-256, URL-safe Base64 (`+/` -> `-_`,
 * padding stripped), truncated to the first 8 characters.
 *
 * Note the encoding difference from signUploadParams(): hex there, truncated
 * URL-safe Base64 here. Do not "unify" these.
 */
export function signDeliveryPath(
  transformation: string,
  publicId: string,
  apiSecret: string,
): string {
  const stringToSign = `${transformation}/${publicId}`;
  return createHash("sha256")
    .update(`${stringToSign}${apiSecret}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, DELIVERY_SIGNATURE_LENGTH);
}
