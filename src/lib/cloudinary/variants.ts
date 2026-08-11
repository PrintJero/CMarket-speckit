/**
 * The frozen listing-image variant catalogue (017-cloudinary-listing-media,
 * FR-059, FR-060, FR-061; research.md #6).
 *
 * This file is a LOOKUP TABLE, never a transformation builder. Nothing here
 * interpolates a request-supplied value into a transformation string — that is
 * the whole reason the catalogue is a frozen constant rather than a function
 * taking width/height. A client names a variant; it never supplies dimensions.
 *
 * Every entry uses `c_limit`, never `c_fill` or `c_scale`: `c_limit` only ever
 * shrinks and always preserves the source aspect ratio, so FR-064 (no
 * distortion) is guaranteed at the transformation layer rather than relying on
 * CSS. `f_auto,q_auto` lets Cloudinary negotiate format and quality (FR-054).
 *
 * Pure and dependency-free by design — no `node:` imports, no config read — so
 * it can be unit-tested in isolation and reasoned about at a glance.
 */

export const LISTING_IMAGE_VARIANTS = {
  /** Detail-page gallery tiles (rendered ~140x105; 320 covers 2x density). */
  thumbnail: "c_limit,w_320,f_auto,q_auto",
  /** Listing cards in community feeds and discovery. */
  card: "c_limit,w_640,f_auto,q_auto",
  /**
   * Full-size view. Defined but not yet requested by any surface — there is no
   * lightbox today (research.md #2). It is one table entry, not speculative UI.
   */
  detail: "c_limit,w_1280,f_auto,q_auto",
} as const;

export type ListingImageVariant = keyof typeof LISTING_IMAGE_VARIANTS;

/** The variant used when a request names none, or names one that does not exist. */
export const DEFAULT_LISTING_IMAGE_VARIANT: ListingImageVariant = "card";

export const LISTING_IMAGE_VARIANT_NAMES = Object.keys(
  LISTING_IMAGE_VARIANTS,
) as ListingImageVariant[];

export function isListingImageVariant(value: unknown): value is ListingImageVariant {
  return typeof value === "string" && value in LISTING_IMAGE_VARIANTS;
}

/**
 * FR-060, FR-061: resolve a client-supplied variant NAME through the allowlist.
 *
 * An unrecognized name resolves to the default rather than erroring, so a stale
 * client renders something instead of broken images. Critically, the supplied
 * value is only ever used as a lookup key — it is never concatenated into the
 * returned transformation, so a caller sending `?v=w_9999,c_crop` gets the
 * `card` transformation and their string reaches Cloudinary nowhere.
 */
export function resolveVariant(name: unknown): {
  variant: ListingImageVariant;
  transformation: string;
} {
  const variant = isListingImageVariant(name) ? name : DEFAULT_LISTING_IMAGE_VARIANT;
  return { variant, transformation: LISTING_IMAGE_VARIANTS[variant] };
}
