import { requireCloudinaryConfig } from "./config";
import { logCloudinaryFailure } from "./logging";
import { signDestroyParams } from "./signature";

/**
 * Cloudinary Admin API operations: asset verification and deletion
 * (017-cloudinary-listing-media, FR-030, FR-031, FR-079, FR-081).
 *
 * Server-only. Never import from a Client Component.
 */

export interface VerifyAssetExpectations {
  /** Exact required prefix, e.g. `cmarket/production/listings/{draftId}/`. */
  expectedPrefix: string;
  expectedAccountId: string;
  expectedDraftId: string;
}

export type VerifyAssetResult =
  | {
      ok: true;
      asset: { assetId: string; publicId: string; width: number; height: number; format: string; bytes: number };
    }
  | { ok: false; reason: "not_found" | "mismatch" | "unavailable" };

function basicAuthHeader(apiKey: string, apiSecret: string): string {
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;
}

/**
 * FR-030, FR-031: confirm a client-supplied public ID really is an asset this
 * account was authorized to create.
 *
 * FOUR checks, none folder-based (research.md #5):
 *   1. `public_id` starts with the exact expected prefix
 *   2. `context` carries the expected account and draft
 *   3. `resource_type === "image"`
 *   4. `type === "authenticated"`
 *
 * Prefix-plus-context rather than a folder comparison is what keeps this correct
 * regardless of whether the account is in fixed-folder or dynamic-folder mode.
 * This runs on top of the PendingListingMedia row, which the caller has already
 * matched on accountId — five independent facts in total.
 */
export async function verifyAsset(
  publicId: string,
  expectations: VerifyAssetExpectations,
): Promise<VerifyAssetResult> {
  // Test-only boundary stub (mirrors EMAIL_TEST_CAPTURE and
  // GOOGLE_OAUTH_MOCK_ENABLED, this codebase's existing pattern for standing in
  // for a third party during Playwright runs). Upload bytes are intercepted in
  // the browser by the test, so the asset genuinely does not exist in Cloudinary
  // and a real verification would correctly fail — but that would make the
  // end-to-end save flow untestable without a live account.
  //
  // Still enforces the prefix and context checks, so the provenance guarantees
  // (FR-030, FR-031) remain under test rather than being bypassed. Only the
  // network call is replaced.
  //
  // MUST NEVER be set in any real deployment.
  if (process.env.CLOUDINARY_TEST_STUB === "true") {
    if (!publicId.startsWith(expectations.expectedPrefix)) {
      return { ok: false, reason: "mismatch" };
    }
    return {
      ok: true,
      asset: {
        assetId: `test-stub-asset-${publicId}`,
        publicId,
        width: 1600,
        height: 1200,
        format: "jpg",
        bytes: 123_456,
      },
    };
  }

  const { cloudName, apiKey, apiSecret } = requireCloudinaryConfig();
  const url =
    `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/authenticated/` +
    encodeURIComponent(publicId);

  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: basicAuthHeader(apiKey, apiSecret) } });
  } catch (cause) {
    logCloudinaryFailure({
      operation: "verify",
      publicId,
      message: cause instanceof Error ? cause.message : "network error",
    });
    return { ok: false, reason: "unavailable" };
  }

  if (response.status === 404) {
    return { ok: false, reason: "not_found" };
  }
  if (!response.ok) {
    logCloudinaryFailure({
      operation: "verify",
      publicId,
      status: response.status,
      message: response.statusText,
    });
    return { ok: false, reason: "unavailable" };
  }

  const body = (await response.json()) as {
    asset_id?: string;
    public_id?: string;
    resource_type?: string;
    type?: string;
    width?: number;
    height?: number;
    format?: string;
    bytes?: number;
    context?: { custom?: Record<string, string> };
  };

  const custom = body.context?.custom ?? {};
  const matches =
    typeof body.public_id === "string" &&
    body.public_id.startsWith(expectations.expectedPrefix) &&
    body.resource_type === "image" &&
    body.type === "authenticated" &&
    custom.account === expectations.expectedAccountId &&
    custom.draft === expectations.expectedDraftId;

  if (
    !matches ||
    typeof body.asset_id !== "string" ||
    typeof body.width !== "number" ||
    typeof body.height !== "number" ||
    typeof body.format !== "string" ||
    typeof body.bytes !== "number"
  ) {
    return { ok: false, reason: "mismatch" };
  }

  return {
    ok: true,
    asset: {
      assetId: body.asset_id,
      publicId: body.public_id!,
      width: body.width,
      height: body.height,
      format: body.format,
      bytes: body.bytes,
    },
  };
}

/**
 * FR-079, FR-081: delete an asset by its stable public ID, invalidating any
 * cached delivery copies (FR-074). Returns false on failure so the caller can
 * leave the MediaCleanupTask row in place for retry — a throw here would risk
 * aborting a drain loop midway (FR-082).
 */
export async function destroyAsset(publicId: string): Promise<boolean> {
  const { cloudName, apiKey, apiSecret } = requireCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);

  // The destroy endpoint takes its own small signed param set. Reuses the
  // upload signer because it is the same "sorted params + secret, hex" scheme.
  // The destroy endpoint signs only what it is actually sent. Padding the shape
  // with empty allowed_formats/context would change the string-to-sign and be
  // rejected — Cloudinary signs exactly the parameters present in the request.
  const signature = signDestroyParams(
    { timestamp, public_id: publicId, type: "authenticated", invalidate: true },
    apiSecret,
  );

  let response: Response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Exactly the signed parameters, plus the two Cloudinary excludes from
      // signing (api_key and the signature itself). Any extra signable field
      // here would not match the string-to-sign and would be rejected.
      body: JSON.stringify({
        public_id: publicId,
        type: "authenticated",
        invalidate: true,
        timestamp,
        signature,
        api_key: apiKey,
      }),
    });
  } catch (cause) {
    logCloudinaryFailure({
      operation: "destroy",
      publicId,
      message: cause instanceof Error ? cause.message : "network error",
    });
    return false;
  }

  if (!response.ok) {
    logCloudinaryFailure({
      operation: "destroy",
      publicId,
      status: response.status,
      message: response.statusText,
    });
    return false;
  }
  return true;
}
