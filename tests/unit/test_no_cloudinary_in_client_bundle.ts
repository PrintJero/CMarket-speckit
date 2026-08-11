import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T052 (017-cloudinary-listing-media, FR-098, FR-099, FR-100, SC-012).
 *
 * Proves the upload/delivery exposure boundary holds in the SHIPPED artifact,
 * not just in source.
 *
 * The assertions are deliberately targeted rather than a blanket "cloudinary
 * appears nowhere" grep. The uploader legitimately receives a Cloudinary upload
 * endpoint at runtime (FR-108), so a keyword sweep would either fail spuriously
 * or get weakened until it proved nothing. What must be absent is specific:
 *
 *   - the API SECRET, unconditionally
 *   - the DELIVERY host res.cloudinary.com, because delivery is proxied
 *   - any NEXT_PUBLIC_CLOUDINARY_* name, because none should exist
 *
 * `api.cloudinary.com` is NOT asserted absent: it arrives in the authorize
 * response at runtime, and if a build ever inlined it that would be a
 * configuration smell rather than a leak — the source-level check below already
 * catches the way that could happen.
 */

const ROOT = path.resolve(__dirname, "../..");
const CLIENT_CHUNK_DIR = path.join(ROOT, ".next", "static");

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

const SOURCE_ROOTS = ["src", "app"];
function collectSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectSources(full, acc);
    else if ([".ts", ".tsx"].includes(path.extname(entry))) acc.push(full);
  }
  return acc;
}

describe("no Cloudinary delivery data or credentials in the client bundle", () => {
  // Source-level checks always run — they are the ones that catch a regression
  // at review time rather than only after a build.
  const sources = SOURCE_ROOTS.flatMap((root) => collectSources(path.join(ROOT, root)));

  it("declares no NEXT_PUBLIC_CLOUDINARY_* variable anywhere (FR-099)", () => {
    const offenders = sources
      .filter((file) => /NEXT_PUBLIC_CLOUDINARY/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"))
      // config.ts documents in prose WHY the variable does not exist; that
      // comment is the reason the rule is followed, not a violation of it.
      .filter((file) => file !== "src/lib/cloudinary/config.ts");

    expect(offenders).toEqual([]);
  });

  it("imports the Cloudinary provider modules from no Client Component (FR-099)", () => {
    const offenders = sources
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          /^\s*["']use client["']/m.test(source) &&
          /from "@\/lib\/cloudinary\/(config|signature|admin|delivery|logging)"/.test(source)
        );
      })
      .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });

  it("builds every browser-facing image URL through the CMarket proxy, never a Cloudinary host", () => {
    const offenders = sources
      .filter((file) => /res\.cloudinary\.com/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"))
      // delivery.ts constructs the signed source URL SERVER-SIDE and never
      // returns it — that is the one legitimate place the host may appear.
      .filter((file) => file !== "src/lib/cloudinary/delivery.ts");

    expect(offenders).toEqual([]);
  });

  // Bundle checks need a production build. Skipped rather than silently passing
  // when .next/static is absent, so a green run never overstates what was proven.
  const hasBuild = existsSync(CLIENT_CHUNK_DIR);
  const bundleTest = hasBuild ? it : it.skip;

  bundleTest("ships no API secret in any client chunk (FR-100, SC-012)", () => {
    const secret = process.env.CLOUDINARY_API_SECRET;
    expect(secret, "CLOUDINARY_API_SECRET must be set for this assertion to mean anything").toBeTruthy();

    const leaking = collectFiles(CLIENT_CHUNK_DIR)
      .filter((file) => readFileSync(file, "utf8").includes(secret!))
      .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"));

    expect(leaking).toEqual([]);
  });

  bundleTest("ships no Cloudinary delivery host in any client chunk (FR-056)", () => {
    const leaking = collectFiles(CLIENT_CHUNK_DIR)
      .filter((file) => readFileSync(file, "utf8").includes("res.cloudinary.com"))
      .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"));

    expect(leaking).toEqual([]);
  });
});
