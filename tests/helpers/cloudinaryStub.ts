import { vi } from "vitest";

/**
 * Stub for the src/lib/cloudinary/ boundary (017-cloudinary-listing-media,
 * research.md #8).
 *
 * NO TEST EVER CONTACTS CLOUDINARY. Every network-touching function in that
 * directory is replaced here. This is a second reason the module is
 * first-party and small: the whole provider surface is five functions, so the
 * seam is trivial to stub exactly.
 *
 * The pure functions (signUploadParams, signDeliveryPath, resolveVariant) are
 * deliberately NOT stubbed — they perform no I/O and their real behaviour is
 * what tests/unit/test_cloudinary_signature.ts and test_cloudinary_variants.ts
 * pin.
 */

/** Deterministic fixture asset. Dimensions are portrait to catch aspect bugs. */
export const FIXTURE_ASSET = {
  assetId: "fixtureassetid0000000000000001",
  width: 3024,
  height: 4032,
  format: "jpg",
  bytes: 2_345_678,
} as const;

export interface StubbedVerifyResult {
  ok: boolean;
  reason?: "not_found" | "mismatch" | "unavailable";
}

/** Call counts, so tests can assert a call did NOT happen (see T075). */
export const cloudinaryStubCalls = {
  verifyAsset: [] as string[],
  destroyAsset: [] as string[],
  fetchAssetBytes: [] as string[],
};

export function resetCloudinaryStub(): void {
  cloudinaryStubCalls.verifyAsset.length = 0;
  cloudinaryStubCalls.destroyAsset.length = 0;
  cloudinaryStubCalls.fetchAssetBytes.length = 0;
  stubState.verifyOutcome = { ok: true };
  stubState.destroySucceeds = true;
  stubState.deliverySucceeds = true;
}

const stubState = {
  verifyOutcome: { ok: true } as StubbedVerifyResult,
  destroySucceeds: true,
  deliverySucceeds: true,
};

/** Force the next verifyAsset calls to fail with a given reason. */
export function stubVerifyOutcome(outcome: StubbedVerifyResult): void {
  stubState.verifyOutcome = outcome;
}

/** Force destroyAsset to fail, for the retryable-cleanup tests. */
export function stubDestroyFailure(): void {
  stubState.destroySucceeds = false;
}

/** Force the delivery fetch to fail, for the proxy's 502 path. */
export function stubDeliveryFailure(): void {
  stubState.deliverySucceeds = false;
}

/**
 * Install the stub. Call from a test file's top level — `vi.mock` is hoisted,
 * so this must not be inside a hook.
 */
export function installCloudinaryStub(): void {
  vi.mock("@/lib/cloudinary/admin", () => ({
    verifyAsset: vi.fn(async (publicId: string) => {
      cloudinaryStubCalls.verifyAsset.push(publicId);
      if (!stubState.verifyOutcome.ok) {
        return { ok: false, reason: stubState.verifyOutcome.reason ?? "mismatch" };
      }
      return {
        ok: true,
        asset: {
          assetId: `${FIXTURE_ASSET.assetId}-${cloudinaryStubCalls.verifyAsset.length}`,
          publicId,
          width: FIXTURE_ASSET.width,
          height: FIXTURE_ASSET.height,
          format: FIXTURE_ASSET.format,
          bytes: FIXTURE_ASSET.bytes,
        },
      };
    }),
    destroyAsset: vi.fn(async (publicId: string) => {
      cloudinaryStubCalls.destroyAsset.push(publicId);
      return stubState.destroySucceeds;
    }),
  }));

  vi.mock("@/lib/cloudinary/delivery", () => ({
    signedDeliveryUrl: vi.fn(
      (publicId: string, variant: string) =>
        `https://res.cloudinary.com/test-cloud/image/authenticated/s--stub--/${variant}/${publicId}`,
    ),
    fetchAssetBytes: vi.fn(async (publicId: string) => {
      cloudinaryStubCalls.fetchAssetBytes.push(publicId);
      if (!stubState.deliverySucceeds) {
        const { CloudinaryDeliveryError } = await import("@/lib/cloudinary/delivery");
        throw new CloudinaryDeliveryError("stubbed failure", 500);
      }
      return { bytes: new Uint8Array([0xff, 0xd8, 0xff]).buffer, contentType: "image/webp" };
    }),
    CloudinaryDeliveryError: class CloudinaryDeliveryError extends Error {
      constructor(
        message: string,
        readonly status: number | undefined,
      ) {
        super(message);
        this.name = "CloudinaryDeliveryError";
      }
    },
  }));
}
