/**
 * Live end-to-end verification of the Cloudinary integration
 * (017-cloudinary-listing-media, quickstart.md T094).
 *
 * This is the one thing no stub can prove: that the TWO HAND-ROLLED SIGNATURE
 * ALGORITHMS actually validate against the real service. research.md #3 accepted
 * exactly that risk when it rejected the Cloudinary SDK — "if Cloudinary changes
 * its signature algorithm, this breaks where an SDK would not" — so this script
 * is how that risk gets discharged.
 *
 * Full round trip against a real account:
 *   1. signUploadParams()  -> signed direct upload, type=authenticated
 *   2. verifyAsset()       -> Admin API provenance check
 *   3. signDeliveryPath()  -> signed delivery URL, fetch real bytes
 *   4. destroyAsset()      -> cleanup, leaving the account as it was found
 *
 * Reads credentials from .env. Prints NO secret and NO signed URL (FR-104).
 *
 *   npx tsx --env-file=.env scripts/verify-cloudinary-live.ts
 */
import { randomBytes } from "node:crypto";
import { requireCloudinaryConfig, uploadEndpoint } from "@/lib/cloudinary/config";
import { signUploadParams, type SignedUploadParams } from "@/lib/cloudinary/signature";
import { verifyAsset, destroyAsset } from "@/lib/cloudinary/admin";
import { fetchAssetBytes, signedDeliveryUrl } from "@/lib/cloudinary/delivery";
import { LISTING_IMAGE_VARIANTS } from "@/lib/cloudinary/variants";

/** A real 1x1 PNG — Cloudinary must be able to decode it. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const results: { step: string; ok: boolean; detail: string }[] = [];
function record(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  // Guard: this script must never run against the stubs, or it proves nothing.
  if (process.env.CLOUDINARY_TEST_STUB === "true") {
    console.error("CLOUDINARY_TEST_STUB is set — refusing to run, this would verify nothing.");
    process.exit(2);
  }

  const config = requireCloudinaryConfig();
  console.log(`Cloud: ${config.cloudName}  env folder: ${config.envFolder}\n`);

  const draftId = `livecheck${Date.now()}`;
  const publicId = `cmarket/${config.envFolder}/listings/${draftId}/${randomBytes(16).toString("hex")}`;
  const context = `account=livecheck|draft=${draftId}`;
  const timestamp = Math.floor(Date.now() / 1000);

  // ---- 1. Signed direct upload -----------------------------------------
  const params: SignedUploadParams = {
    timestamp,
    public_id: publicId,
    type: "authenticated",
    allowed_formats: "jpg,png,webp",
    context,
  };
  const signature = signUploadParams(params, config.apiSecret);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "probe.png");
  form.append("api_key", config.apiKey);
  form.append("timestamp", String(params.timestamp));
  form.append("signature", signature);
  form.append("public_id", params.public_id);
  form.append("type", params.type);
  form.append("context", params.context);
  form.append("allowed_formats", params.allowed_formats);

  const uploadResponse = await fetch(uploadEndpoint(config.cloudName), {
    method: "POST",
    body: form,
  });
  const uploadBody = (await uploadResponse.json()) as Record<string, unknown>;

  if (!uploadResponse.ok) {
    record(
      "1. Upload signature accepted by Cloudinary",
      false,
      `HTTP ${uploadResponse.status}: ${JSON.stringify(uploadBody.error ?? uploadBody)}`,
    );
    console.error("\nThe upload signature was rejected. Everything downstream is untestable.");
    process.exit(1);
  }
  record(
    "1. Upload signature accepted by Cloudinary",
    true,
    `asset_id=${String(uploadBody.asset_id).slice(0, 12)}… type=${uploadBody.type}`,
  );
  record(
    "1b. Asset stored with type=authenticated (not publicly deliverable)",
    uploadBody.type === "authenticated",
    `type=${uploadBody.type}`,
  );
  record(
    "1c. Server-generated public ID honoured, no folder param sent",
    uploadBody.public_id === publicId,
    `public_id matches: ${uploadBody.public_id === publicId}`,
  );

  // ---- 2. Admin API provenance verification ----------------------------
  const verified = await verifyAsset(publicId, {
    expectedPrefix: `cmarket/${config.envFolder}/listings/${draftId}/`,
    expectedAccountId: "livecheck",
    expectedDraftId: draftId,
  });
  record(
    "2. verifyAsset() confirms prefix + context + resource_type + type",
    verified.ok,
    verified.ok ? `${verified.asset.width}x${verified.asset.height} ${verified.asset.format}` : `reason=${verified.reason}`,
  );

  // A forged prefix must be refused — the provenance check must be real.
  const forged = await verifyAsset(publicId, {
    expectedPrefix: `cmarket/${config.envFolder}/listings/someone-else/`,
    expectedAccountId: "livecheck",
    expectedDraftId: draftId,
  });
  record("2b. verifyAsset() rejects a mismatched prefix", !forged.ok, `ok=${forged.ok}`);

  // ---- 3. Signed delivery ----------------------------------------------
  // The public URL must NOT work: that is the whole point of type=authenticated.
  const unsignedUrl = `https://res.cloudinary.com/${config.cloudName}/image/upload/${publicId}`;
  const unsigned = await fetch(unsignedUrl);
  record(
    "3. Unsigned public delivery is refused (asset is not publicly readable)",
    !unsigned.ok,
    `HTTP ${unsigned.status}`,
  );

  for (const variant of Object.keys(LISTING_IMAGE_VARIANTS) as (keyof typeof LISTING_IMAGE_VARIANTS)[]) {
    try {
      const asset = await fetchAssetBytes(publicId, variant, "image/webp,image/*");
      record(
        `3b. Delivery signature accepted for variant "${variant}"`,
        asset.bytes.byteLength > 0,
        `${asset.contentType}, ${asset.bytes.byteLength} bytes`,
      );
    } catch (cause) {
      record(
        `3b. Delivery signature accepted for variant "${variant}"`,
        false,
        cause instanceof Error ? cause.message : "unknown",
      );
    }
  }

  // A tampered signature must be refused.
  const good = signedDeliveryUrl(publicId, "card");
  const tampered = good.replace(/s--(.{8})--/, "s--AAAAAAAA--");
  const tamperedResponse = await fetch(tampered);
  record(
    "3c. A tampered delivery signature is refused",
    !tamperedResponse.ok,
    `HTTP ${tamperedResponse.status}`,
  );

  // ---- 4. Destroy -------------------------------------------------------
  const destroyed = await destroyAsset(publicId);
  record("4. destroyAsset() removes the asset", destroyed, `returned ${destroyed}`);

  const afterDestroy = await verifyAsset(publicId, {
    expectedPrefix: `cmarket/${config.envFolder}/listings/${draftId}/`,
    expectedAccountId: "livecheck",
    expectedDraftId: draftId,
  });
  record(
    "4b. Asset is gone afterwards (account left clean)",
    !afterDestroy.ok && afterDestroy.reason === "not_found",
    afterDestroy.ok ? "STILL PRESENT" : `reason=${afterDestroy.reason}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.error(`\nFAILED:\n${failed.map((f) => `  - ${f.step}: ${f.detail}`).join("\n")}`);
    process.exit(1);
  }
  console.log("Live Cloudinary integration verified. No asset left behind.");
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
