import { requireCloudinaryConfig } from "./config";
import { logCloudinaryFailure } from "./logging";
import { signDeliveryPath } from "./signature";
import { resolveVariant, type ListingImageVariant } from "./variants";

/**
 * Server-side fetch of a `type: authenticated` Cloudinary asset
 * (017-cloudinary-listing-media, FR-055, FR-107).
 *
 * The URL built here is an INTERNAL implementation detail. It must never be
 * returned to a browser, placed in a header, used in a redirect, or logged
 * (FR-056, FR-104, FR-107) — it is a read capability, and a `302` to it would
 * deposit that capability in the browser's history and referrers while
 * appearing to satisfy "no Cloudinary URL in the response body".
 *
 * Server-only. Never import from a Client Component.
 */

export interface FetchedAsset {
  bytes: ArrayBuffer;
  contentType: string;
}

/**
 * Build the signed delivery URL. Uses signDeliveryPath() — NOT
 * signUploadParams(); see the warning in signature.ts.
 */
export function signedDeliveryUrl(publicId: string, variant: ListingImageVariant): string {
  const { cloudName, apiSecret } = requireCloudinaryConfig();
  const { transformation } = resolveVariant(variant);
  const signature = signDeliveryPath(transformation, publicId, apiSecret);
  return `https://res.cloudinary.com/${cloudName}/image/authenticated/s--${signature}--/${transformation}/${publicId}`;
}

export class CloudinaryDeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
  ) {
    super(message);
    this.name = "CloudinaryDeliveryError";
  }
}

/**
 * Fetch the variant's bytes server-side, forwarding the caller's `Accept` header
 * so Cloudinary's `f_auto` can negotiate a format. The proxy streams what comes
 * back; it never hands the browser this URL.
 */
export async function fetchAssetBytes(
  publicId: string,
  variant: ListingImageVariant,
  acceptHeader: string | null,
): Promise<FetchedAsset> {
  // Test-only boundary stub (same flag and rationale as verifyAsset in
  // admin.ts). Playwright intercepts uploads in the browser, so the asset never
  // reaches Cloudinary and a real delivery fetch would 404 — making an outbound
  // call on every rendered image for no benefit. Authorization has already run
  // in the route by the time this is reached, so stubbing here bypasses no gate.
  //
  // MUST NEVER be set in any real deployment.
  if (process.env.CLOUDINARY_TEST_STUB === "true") {
    // A 1x1 GIF: enough for the browser to treat the response as an image.
    return {
      bytes: Uint8Array.from([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00,
        0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
        0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
      ]).buffer as ArrayBuffer,
      contentType: "image/gif",
    };
  }

  const url = signedDeliveryUrl(publicId, variant);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: acceptHeader ? { Accept: acceptHeader } : {},
    });
  } catch (cause) {
    // Note: `url` is deliberately absent from the log line (FR-104).
    logCloudinaryFailure({
      operation: "deliver",
      publicId,
      message: cause instanceof Error ? cause.message : "network error",
    });
    throw new CloudinaryDeliveryError("Cloudinary unreachable", undefined);
  }

  if (!response.ok) {
    logCloudinaryFailure({
      operation: "deliver",
      publicId,
      status: response.status,
      message: response.statusText,
    });
    throw new CloudinaryDeliveryError("Cloudinary delivery failed", response.status);
  }

  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}
