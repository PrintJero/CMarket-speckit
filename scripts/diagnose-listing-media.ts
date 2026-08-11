/**
 * Diagnose the listing-media upload pipeline against a RUNNING server
 * (017-cloudinary-listing-media).
 *
 * Answers, in order, the questions that actually distinguish the failure modes:
 *
 *   1. Does the server have Cloudinary configured at all?
 *   2. Is the server running CURRENT code, or stale compiled output?
 *      (Turbopack's cache in .next/dev/cache survives Ctrl+C — the single most
 *      common cause of a signature mismatch after editing src/lib/cloudinary/.)
 *   3. Does a real signed upload succeed?
 *   4. Does association and authenticated delivery succeed?
 *
 * Prints no secret and no signed delivery URL. Cleans up everything it creates,
 * including destroying the Cloudinary asset.
 *
 *   npx tsx --env-file=.env scripts/diagnose-listing-media.ts
 *   npx tsx --env-file=.env scripts/diagnose-listing-media.ts http://localhost:3100
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { destroyAsset } from "@/lib/cloudinary/admin";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function sign(stringToSign: string, secret: string): string {
  return createHash("sha256").update(`${stringToSign}${secret}`).digest("hex");
}

async function main() {
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!secret) {
    console.error("CLOUDINARY_API_SECRET is not set in this shell. Run with --env-file=.env");
    process.exitCode = 1;
    return;
  }
  console.log(`Target server: ${BASE}\n`);

  // ---- fixtures -------------------------------------------------------
  const email = `mediadiag-${Date.now()}@example.com`;
  const password = "correct-horse-battery-staple";
  await prisma.account.create({
    data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), displayName: "Diag" },
  });

  const communityResponse = await fetch(`${BASE}/api/operator/create-community`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `MediaDiag ${Date.now()}`, founderEmail: email, invokedBy: "diagnose" }),
  });
  const communityBody = await communityResponse.json();
  if (!communityBody.ok) {
    console.error(`Could not create a community: ${JSON.stringify(communityBody)}`);
    if (communityBody.reason === "account_not_found") {
      console.error(
        "The server is using a DIFFERENT database than this script. Check DATABASE_URL on both sides.",
      );
    }
    if (communityBody.reason === undefined) {
      console.error("Is OPERATOR_PANEL_ENABLED=true set for the server?");
    }
    await cleanup();
    process.exitCode = 1;
    return;
  }
  const communityId = communityBody.community.id as string;

  const signInResponse = await fetch(`${BASE}/api/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = (signInResponse.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) {
    console.error(`Sign-in failed (HTTP ${signInResponse.status}); cannot continue.`);
    await cleanup();
    process.exitCode = 1;
    return;
  }

  // ---- 1. is Cloudinary configured on the server? ---------------------
  const draftId = `mediadiag${Date.now()}`;
  const authResponse = await fetch(`${BASE}/api/listing-media/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ communityId, draftId }),
  });
  const authText = await authResponse.text();

  console.log("1. Server Cloudinary configuration");
  if (authResponse.status === 500) {
    console.log("   FAIL — the server has no usable CLOUDINARY_* configuration.");
    console.log("   Set them in .env and RESTART the server (it reads .env only at boot).");
    console.log(`   response: ${authText.slice(0, 200)}`);
    await cleanup();
    process.exitCode = 1;
    return;
  }
  if (!authResponse.ok) {
    console.log(`   FAIL — authorize returned HTTP ${authResponse.status}: ${authText.slice(0, 200)}`);
    await cleanup();
    process.exitCode = 1;
    return;
  }
  const { upload } = JSON.parse(authText) as {
    upload: {
      url: string;
      apiKey: string;
      timestamp: number;
      signature: string;
      publicId: string;
      type: string;
      context: string;
    };
  };
  const missing = (["url", "apiKey", "signature", "publicId", "type", "context"] as const).filter(
    (k) => !upload?.[k],
  );
  if (missing.length > 0) {
    // An empty api_key is what produces Cloudinary's misleading
    // "Upload preset must be specified when using unsigned upload".
    console.log(`   FAIL — incomplete credentials, missing: ${missing.join(", ")}`);
    console.log("   An empty api_key makes Cloudinary treat the upload as UNSIGNED.");
    await cleanup();
    process.exitCode = 1;
    return;
  }
  console.log(`   OK — cloud in URL: ${upload.url.split("/v1_1/")[1]?.split("/")[0]}, apiKey len ${upload.apiKey.length}`);

  // ---- 2. current code, or stale Turbopack cache? ---------------------
  const currentString =
    `allowed_formats=jpg,png,webp&context=${upload.context}` +
    `&public_id=${upload.publicId}&timestamp=${upload.timestamp}&type=authenticated`;
  const staleString =
    `allowed_formats=jpg,png,webp&context=${upload.context}` +
    `&max_file_size=10485760&public_id=${upload.publicId}&timestamp=${upload.timestamp}&type=authenticated`;

  console.log("\n2. Is the server running current code?");
  if (upload.signature === sign(currentString, secret)) {
    console.log("   OK — current code (max_file_size correctly not signed).");
  } else if (upload.signature === sign(staleString, secret)) {
    console.log("   FAIL — STALE compiled code: it still signs max_file_size.");
    console.log("   Turbopack's cache survives Ctrl+C. Fix:  rm -rf .next  &&  npm run dev");
    await cleanup();
    process.exitCode = 1;
    return;
  } else {
    console.log("   FAIL — the signature matches neither. The server's CLOUDINARY_API_SECRET");
    console.log("   differs from the one in this shell's .env.");
    await cleanup();
    process.exitCode = 1;
    return;
  }

  // ---- 3. real signed upload ------------------------------------------
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "diag.png");
  form.append("api_key", upload.apiKey);
  form.append("timestamp", String(upload.timestamp));
  form.append("signature", upload.signature);
  form.append("public_id", upload.publicId);
  form.append("type", upload.type);
  form.append("context", upload.context);
  form.append("allowed_formats", "jpg,png,webp");

  const uploadResponse = await fetch(upload.url, { method: "POST", body: form });
  console.log("\n3. Signed upload to Cloudinary");
  if (!uploadResponse.ok) {
    console.log(`   FAIL — HTTP ${uploadResponse.status}: ${(await uploadResponse.text()).slice(0, 300)}`);
    await cleanup();
    process.exitCode = 1;
    return;
  }
  console.log("   OK");

  // ---- 4. associate and deliver ---------------------------------------
  const listingResponse = await fetch(`${BASE}/api/communities/${communityId}/listings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title: "MediaDiag listing", description: "diagnostic", priceCents: 100 }),
  });
  const listingId = (await listingResponse.json()).listing.id as string;

  const assocResponse = await fetch(
    `${BASE}/api/communities/${communityId}/listings/${listingId}/photos`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ draftId, photos: [{ publicId: upload.publicId, displayOrder: 0 }] }),
    },
  );
  const assocText = await assocResponse.text();
  console.log("\n4. Association and authenticated delivery");
  if (!assocResponse.ok) {
    console.log(`   FAIL — associate HTTP ${assocResponse.status}: ${assocText.slice(0, 300)}`);
    await destroyAsset(upload.publicId);
    await cleanup();
    process.exitCode = 1;
    return;
  }
  const photoId = JSON.parse(assocText).photos[0].id as string;

  const deliverResponse = await fetch(
    `${BASE}/api/communities/${communityId}/listing-photos/${photoId}?v=card`,
    { headers: { Cookie: cookie, Accept: "image/webp,image/*" }, redirect: "manual" },
  );
  const bytes = await deliverResponse.arrayBuffer();
  if (!deliverResponse.ok || bytes.byteLength === 0) {
    console.log(`   FAIL — deliver HTTP ${deliverResponse.status}, ${bytes.byteLength} bytes`);
    await destroyAsset(upload.publicId);
    await cleanup();
    process.exitCode = 1;
    return;
  }
  console.log(
    `   OK — ${deliverResponse.headers.get("content-type")}, ${bytes.byteLength} bytes, ` +
      `cache-control: ${deliverResponse.headers.get("cache-control")}`,
  );

  await destroyAsset(upload.publicId);
  await cleanup();
  console.log("\nAll checks passed. Listing media works end to end on this server.");
}

async function cleanup() {
  await prisma.mediaCleanupTask.deleteMany({
    where: { cloudinaryPublicId: { contains: "/listings/mediadiag" } },
  });
  await prisma.community.deleteMany({ where: { name: { contains: "MediaDiag " } } });
  await prisma.account.deleteMany({ where: { email: { contains: "mediadiag-" } } });
}

main()
  .catch((cause) => {
    console.error("\nDiagnostic error:", cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
