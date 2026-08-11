import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_LISTING_IMAGE_VARIANT,
  LISTING_IMAGE_VARIANTS,
  LISTING_IMAGE_VARIANT_NAMES,
  isListingImageVariant,
  resolveVariant,
} from "@/lib/cloudinary/variants";

/**
 * T005 (017-cloudinary-listing-media): the variant catalogue is the file that
 * guarantees no request value ever reaches a Cloudinary transformation string
 * (FR-060) and that aspect ratio cannot be distorted (FR-064). Both are
 * properties of the table's SHAPE, so they are asserted structurally rather
 * than by exercising a route.
 */
describe("listing image variants", () => {
  it("exposes exactly thumbnail, card, and detail (FR-059)", () => {
    expect(LISTING_IMAGE_VARIANT_NAMES.sort()).toEqual(["card", "detail", "thumbnail"]);
  });

  it("uses c_limit in every entry, never c_fill or c_scale (FR-064)", () => {
    for (const [name, transformation] of Object.entries(LISTING_IMAGE_VARIANTS)) {
      expect(transformation, `${name} must use c_limit`).toContain("c_limit");
      expect(transformation, `${name} must not crop`).not.toContain("c_fill");
      expect(transformation, `${name} must not scale`).not.toContain("c_scale");
      expect(transformation, `${name} must not crop`).not.toContain("c_crop");
    }
  });

  it("requests automatic format and quality in every entry (FR-054)", () => {
    for (const [name, transformation] of Object.entries(LISTING_IMAGE_VARIANTS)) {
      expect(transformation, `${name} must use f_auto`).toContain("f_auto");
      expect(transformation, `${name} must use q_auto`).toContain("q_auto");
    }
  });

  it("orders the variants thumbnail < card < detail by width", () => {
    const width = (t: string) => Number(/w_(\d+)/.exec(t)![1]);
    expect(width(LISTING_IMAGE_VARIANTS.thumbnail)).toBeLessThan(
      width(LISTING_IMAGE_VARIANTS.card),
    );
    expect(width(LISTING_IMAGE_VARIANTS.card)).toBeLessThan(width(LISTING_IMAGE_VARIANTS.detail));
  });

  it("resolves every known name to its own transformation", () => {
    for (const name of LISTING_IMAGE_VARIANT_NAMES) {
      expect(resolveVariant(name)).toEqual({
        variant: name,
        transformation: LISTING_IMAGE_VARIANTS[name],
      });
    }
  });

  it("falls back to card for an unknown name rather than erroring (FR-061)", () => {
    for (const bogus of ["", "huge", "THUMBNAIL", null, undefined, 42, {}]) {
      expect(resolveVariant(bogus)).toEqual({
        variant: DEFAULT_LISTING_IMAGE_VARIANT,
        transformation: LISTING_IMAGE_VARIANTS[DEFAULT_LISTING_IMAGE_VARIANT],
      });
    }
  });

  it("never lets a client-supplied transformation string through (FR-060)", () => {
    // The exact attack the allowlist exists to stop: a caller passing a
    // transformation instead of a variant name. The supplied text must appear
    // nowhere in the result.
    const injected = "w_9999,c_crop,e_grayscale";
    const resolved = resolveVariant(injected);
    expect(resolved.variant).toBe(DEFAULT_LISTING_IMAGE_VARIANT);
    expect(resolved.transformation).not.toContain("9999");
    expect(resolved.transformation).not.toContain("c_crop");
    expect(resolved.transformation).not.toContain("e_grayscale");
    expect(isListingImageVariant(injected)).toBe(false);
  });

  it("builds transformations by lookup only — the source contains no interpolation (FR-060)", () => {
    // A structural guard: if someone later replaces the table with a builder,
    // the interpolation would reappear and this fails. Cheaper and more
    // durable than trying to enumerate every injection string at runtime.
    const source = readFileSync(
      path.resolve(__dirname, "../../src/lib/cloudinary/variants.ts"),
      "utf8",
    );
    const transformationLines = source
      .split("\n")
      .filter((line) => /c_limit|w_\d|f_auto|q_auto/.test(line) && !line.trimStart().startsWith("*"));
    for (const line of transformationLines) {
      expect(line, "transformation strings must be literals, not templates").not.toMatch(/\$\{/);
    }
  });

  it("keeps the module free of node: imports so it stays environment-agnostic", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../src/lib/cloudinary/variants.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from "node:/);
    expect(source).not.toMatch(/require\(/);
  });
});
