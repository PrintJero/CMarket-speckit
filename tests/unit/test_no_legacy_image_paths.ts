import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T084 (017-cloudinary-listing-media, FR-090, FR-091, SC-017).
 *
 * A structural audit that the hard cutover actually happened. These are
 * properties of the source tree rather than of any single function, so they are
 * asserted by inspecting files — the only way to prove an ABSENCE.
 *
 * Also pins the single permitted lint suppression: FR-063 makes a raw <img>
 * acceptable, so exactly one @next/next/no-img-element suppression is EXPECTED
 * in the shared media component. Its spread beyond that file is the defect.
 */

const ROOT = path.resolve(__dirname, "../..");
const SEARCH_ROOTS = ["src", "app"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry))) {
      acc.push(full);
    }
  }
  return acc;
}

const sourceFiles = SEARCH_ROOTS.flatMap((root) => collectSourceFiles(path.join(ROOT, root)));

/**
 * Strip comments before matching.
 *
 * Without this the audit fails on its own documentation: listingService.ts
 * explains that MAX_PHOTO_BYTES was removed, config.ts explains why no
 * NEXT_PUBLIC_CLOUDINARY_* variable exists, and logging.ts lists
 * CLOUDINARY_API_SECRET among the things never to log. Each of those comments is
 * valuable and none is a legacy code path. An audit that punishes explaining
 * yourself would just get the comments deleted.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const codeByFile = new Map(
  sourceFiles.map((file) => [file, stripComments(readFileSync(file, "utf8"))]),
);

/** Matches against CODE only, comments removed. */
function filesContaining(pattern: RegExp): string[] {
  return sourceFiles
    .filter((file) => pattern.test(codeByFile.get(file)!))
    .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"));
}

/** Matches against the raw file, comments included — for lint-directive checks. */
function filesContainingRaw(pattern: RegExp): string[] {
  return sourceFiles
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"));
}

describe("no legacy listing-image paths remain", () => {
  it("finds source files to audit at all (guards against a vacuous pass)", () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it("has removed the byte-validation constants (FR-090)", () => {
    expect(filesContaining(/\bMAX_PHOTO_BYTES\b/)).toEqual([]);
    expect(filesContaining(/\bALLOWED_PHOTO_MIME_TYPES\b/)).toEqual([]);
  });

  it("references no photo byte, mimeType, or sizeBytes field (FR-045)", () => {
    // Scoped to photo-ish usage so unrelated `bytes` (e.g. the stored Cloudinary
    // byte SIZE, which is legitimate) does not trip the audit.
    expect(filesContaining(/photo\.data\b/)).toEqual([]);
    expect(filesContaining(/\bsizeBytes\b/)).toEqual([]);
    expect(filesContaining(/listingPhoto[\s\S]{0,200}?\bmimeType\b/)).toEqual([]);
  });

  it("no longer uses `position` for listing photo ordering (renamed to displayOrder)", () => {
    expect(filesContaining(/listingPhoto[\s\S]{0,200}?\bposition:/)).toEqual([]);
  });

  it("serves no listing photo bytes from the old listings/photos path (FR-084)", () => {
    const legacyRoute = path.join(
      ROOT,
      "app/api/communities/[communityId]/listings/[listingId]/photos/[photoId]/route.ts",
    );
    const source = readFileSync(legacyRoute, "utf8");
    // DELETE remains — its contract is unchanged. A GET here would mean the byte
    // endpoint survived the cutover.
    expect(source).toMatch(/export async function DELETE/);
    expect(source).not.toMatch(/export async function GET/);
  });

  it("keeps getListingPhoto(), because the delivery proxy reuses its gate (research.md #12)", () => {
    // Its ABSENCE would mean the authorization gate was reinvented inside a route
    // handler instead of reused — the opposite of what the cutover intends.
    expect(filesContaining(/export async function getListingPhoto/)).toEqual([
      "src/server/services/listingService.ts",
    ]);
  });

  it("suppresses no-img-element in exactly the two permitted places (FR-059, FR-063)", () => {
    // Raw match: a lint directive IS a comment, so stripping them would make this
    // assertion vacuous.
    const suppressors = filesContainingRaw(/eslint-disable[^\n]*@next\/next\/no-img-element/);
    expect(suppressors.sort()).toEqual([
      // The single shared listing-media component.
      "app/_components/ListingImage.tsx",
      // The uploader tile's local object-URL preview of a not-yet-uploaded file,
      // which has no ListingPhoto row and so cannot go through the proxy.
      "app/communities/[communityId]/listings/ListingMediaTile.tsx",
    ]);
  });

  it("introduces no next/image, remotePatterns, or image loader (FR-063)", () => {
    expect(filesContaining(/from "next\/image"/)).toEqual([]);
    expect(filesContaining(/remotePatterns/)).toEqual([]);

    // next.config.ts must remain free of an images block entirely.
    const nextConfig = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
    expect(nextConfig).not.toMatch(/images\s*:/);
  });

  it("exposes no NEXT_PUBLIC_ Cloudinary variable (FR-099)", () => {
    expect(filesContaining(/NEXT_PUBLIC_CLOUDINARY/)).toEqual([]);
  });

  it("imports src/lib/cloudinary/ from no Client Component (FR-099)", () => {
    const clientComponentsImportingCloudinary = sourceFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      const isClient = /^\s*["']use client["']/m.test(source);
      // The variants module is a pure frozen lookup table with no node: imports
      // and no secret, so a type-only import of it is harmless.
      const importsProviderCode = /from "@\/lib\/cloudinary\/(config|signature|admin|delivery|logging)"/.test(
        source,
      );
      return isClient && importsProviderCode;
    });
    expect(clientComponentsImportingCloudinary).toEqual([]);
  });

  it("keeps the API secret inside src/lib/cloudinary/ only (FR-100)", () => {
    const referencing = filesContaining(/CLOUDINARY_API_SECRET/);
    expect(referencing).toEqual(["src/lib/cloudinary/config.ts"]);
  });
});
