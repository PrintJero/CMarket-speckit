import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DELIVERY_SIGNATURE_LENGTH,
  UPLOAD_SIGNATURE_EXCLUDED_PARAMS,
  buildUploadStringToSign,
  signDeliveryPath,
  signUploadParams,
  type SignedUploadParams,
} from "@/lib/cloudinary/signature";

/**
 * T006 (017-cloudinary-listing-media, research.md #3).
 *
 * TWO INDEPENDENT SUITES, deliberately sharing no helper. The upload and
 * delivery signatures use the same secret and nothing else: different input,
 * different encoding, different length. Collapsing them into one "sign this"
 * helper produces a delivery URL Cloudinary answers with 401, because a hex
 * digest inside `s--...--` never validates. The final test in this file exists
 * specifically to make that collapse impossible to do silently.
 *
 * Fixtures are hand-computed from the documented algorithms rather than
 * captured from the implementation, so a drifting implementation fails instead
 * of re-baselining itself.
 */

const SECRET = "test-secret-not-a-real-credential";

const UPLOAD_PARAMS: SignedUploadParams = {
  timestamp: 1786000000,
  public_id: "cmarket/test/listings/draft1/a1b2c3d4e5f60718",
  type: "authenticated",
  allowed_formats: "jpg,png,webp",
  context: "account=acc1|draft=draft1",
};

describe("upload signature (SHA-256 hex over sorted body params)", () => {
  it("sorts every signed parameter alphabetically and joins with &", () => {
    // Pinned against the string Cloudinary itself echoed back during live
    // verification (scripts/verify-cloudinary-live.ts) — not merely against what
    // this implementation happens to produce.
    expect(buildUploadStringToSign(UPLOAD_PARAMS)).toBe(
      "allowed_formats=jpg,png,webp&" +
        "context=account=acc1|draft=draft1&" +
        "public_id=cmarket/test/listings/draft1/a1b2c3d4e5f60718&" +
        "timestamp=1786000000&" +
        "type=authenticated",
    );
  });

  it("does NOT sign max_file_size — it is an upload-preset setting, not a request parameter", () => {
    // Verified against the live service: signing it produced
    // "Invalid Signature", and Cloudinary's echoed string-to-sign omitted it.
    // The 10 MB limit is enforced at association time from the reported byte
    // count instead (listingMediaService), which is authoritative rather than
    // advisory.
    expect(buildUploadStringToSign(UPLOAD_PARAMS)).not.toContain("max_file_size");
    expect(Object.keys(UPLOAD_PARAMS)).not.toContain("max_file_size");
  });

  it("appends the secret and returns the SHA-256 HEX digest", () => {
    const expected = createHash("sha256")
      .update(`${buildUploadStringToSign(UPLOAD_PARAMS)}${SECRET}`)
      .digest("hex");

    const actual = signUploadParams(UPLOAD_PARAMS, SECRET);
    expect(actual).toBe(expected);
    // Hex, not Base64: 64 lowercase hex characters.
    expect(actual).toMatch(/^[0-9a-f]{64}$/);
  });

  it("excludes file, cloud_name, resource_type, and api_key from the string to sign", () => {
    expect([...UPLOAD_SIGNATURE_EXCLUDED_PARAMS].sort()).toEqual([
      "api_key",
      "cloud_name",
      "file",
      "resource_type",
    ]);

    // Passing them anyway must not change the signature — resource_type in
    // particular belongs to the endpoint URL path, not the signed string.
    const polluted = {
      ...UPLOAD_PARAMS,
      file: "binary",
      cloud_name: "test-cloud",
      resource_type: "image",
      api_key: "000000000000000",
    } as unknown as SignedUploadParams;

    expect(buildUploadStringToSign(polluted)).toBe(buildUploadStringToSign(UPLOAD_PARAMS));
    expect(signUploadParams(polluted, SECRET)).toBe(signUploadParams(UPLOAD_PARAMS, SECRET));
  });

  it("never signs a folder parameter (research.md #5)", () => {
    const stringToSign = buildUploadStringToSign(UPLOAD_PARAMS);
    expect(stringToSign).not.toContain("folder=");
    expect(Object.keys(UPLOAD_PARAMS)).not.toContain("folder");
  });

  it("changes when any signed value is tampered with (FR-033)", () => {
    const baseline = signUploadParams(UPLOAD_PARAMS, SECRET);
    const tampered: Array<Partial<SignedUploadParams>> = [
      { allowed_formats: "jpg,png,webp,svg" },
      { public_id: "cmarket/test/listings/other/deadbeefdeadbeef" },
      { timestamp: 1786000001 },
      { context: "account=attacker|draft=draft1" },
    ];
    for (const patch of tampered) {
      expect(
        signUploadParams({ ...UPLOAD_PARAMS, ...patch }, SECRET),
        `tampering with ${Object.keys(patch)[0]} must invalidate the signature`,
      ).not.toBe(baseline);
    }
  });
});

describe("delivery signature (SHA-256 -> URL-safe Base64 -> first 8 chars)", () => {
  const TRANSFORMATION = "c_limit,w_640,f_auto,q_auto";
  const PUBLIC_ID = "cmarket/test/listings/draft1/a1b2c3d4e5f60718";

  it("signs exactly the components that follow the signature component", () => {
    const expected = createHash("sha256")
      .update(`${TRANSFORMATION}/${PUBLIC_ID}${SECRET}`)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
      .slice(0, DELIVERY_SIGNATURE_LENGTH);

    expect(signDeliveryPath(TRANSFORMATION, PUBLIC_ID, SECRET)).toBe(expected);
  });

  it("returns exactly eight URL-safe Base64 characters", () => {
    const signature = signDeliveryPath(TRANSFORMATION, PUBLIC_ID, SECRET);
    expect(signature).toHaveLength(8);
    // URL-safe alphabet only: no +, /, or = may survive.
    expect(signature).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });

  it("is not a hex digest — a hex value inside s--...-- never validates", () => {
    const signature = signDeliveryPath(TRANSFORMATION, PUBLIC_ID, SECRET);
    expect(signature).not.toMatch(/^[0-9a-f]{8}$/);
  });

  it("varies by transformation and by public ID", () => {
    const baseline = signDeliveryPath(TRANSFORMATION, PUBLIC_ID, SECRET);
    expect(signDeliveryPath("c_limit,w_320,f_auto,q_auto", PUBLIC_ID, SECRET)).not.toBe(baseline);
    expect(signDeliveryPath(TRANSFORMATION, `${PUBLIC_ID}x`, SECRET)).not.toBe(baseline);
    expect(signDeliveryPath(TRANSFORMATION, PUBLIC_ID, "another-secret")).not.toBe(baseline);
  });
});

describe("the two algorithms are genuinely distinct", () => {
  it("produces different output for the same logical input", () => {
    // The guard against a future refactor collapsing both into one helper.
    const transformation = "c_limit,w_640,f_auto,q_auto";
    const publicId = "cmarket/test/listings/draft1/a1b2c3d4e5f60718";

    const delivery = signDeliveryPath(transformation, publicId, SECRET);
    const upload = signUploadParams(
      { ...UPLOAD_PARAMS, public_id: publicId },
      SECRET,
    );

    expect(delivery).not.toBe(upload);
    expect(delivery).not.toBe(upload.slice(0, DELIVERY_SIGNATURE_LENGTH));
    expect(upload).toHaveLength(64);
    expect(delivery).toHaveLength(8);
  });
});
