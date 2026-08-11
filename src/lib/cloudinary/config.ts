/**
 * Cloudinary configuration access (017-cloudinary-listing-media, FR-097, FR-106).
 *
 * Server-only. Nothing in this directory may be imported from a Client
 * Component: the browser never constructs a Cloudinary URL, so no Cloudinary
 * value belongs in the client bundle (FR-099). That is also why there is
 * deliberately no NEXT_PUBLIC_CLOUDINARY_* variable to read here.
 */

export type ListingImageCacheMode = "no-cache" | "no-store";

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /**
   * Top-level PATH SEGMENT of every generated public ID, not a Cloudinary
   * `folder` upload parameter (research.md #5). This prefix is what makes it
   * impossible for a staging deployment to address production assets
   * (FR-102, FR-103).
   */
  envFolder: string;
  cacheMode: ListingImageCacheMode;
}

function readRequired(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    // FR-106: fail loudly rather than degrading into an image-less app. The
    // message names the variable so the failure is actionable, and never
    // echoes any value — a "got: ..." would eventually print the secret.
    throw new Error(
      `[cloudinary] Missing required environment variable ${name}. ` +
        `Listing media cannot be uploaded or delivered until it is set. See .env.example.`,
    );
  }
  return value;
}

/**
 * FR-106. Throws on FIRST USE, deliberately — not at module load and not as a
 * startup assertion. `next build` runs without production secrets, so a
 * build-time check would break the Docker build. A first-use throw surfaces a
 * loud, actionable failure on the first upload or delivery attempt instead.
 *
 * Not cached: the throw must remain reproducible, and reading five env vars is
 * not a cost worth memoising.
 */
export function requireCloudinaryConfig(): CloudinaryConfig {
  const rawCacheMode = process.env.LISTING_IMAGE_CACHE_MODE ?? "no-cache";
  if (rawCacheMode !== "no-cache" && rawCacheMode !== "no-store") {
    // A `max-age` value is rejected outright: permitting cached reuse without
    // revalidation is exactly what FR-058 prohibits, so it must not be
    // reachable through configuration.
    throw new Error(
      `[cloudinary] LISTING_IMAGE_CACHE_MODE must be "no-cache" or "no-store", got ` +
        `${JSON.stringify(rawCacheMode)}. A max-age is not offered: FR-058 forbids ` +
        `cached reuse without revalidation.`,
    );
  }

  return {
    cloudName: readRequired("CLOUDINARY_CLOUD_NAME"),
    apiKey: readRequired("CLOUDINARY_API_KEY"),
    apiSecret: readRequired("CLOUDINARY_API_SECRET"),
    envFolder: readRequired("CLOUDINARY_ENV_FOLDER"),
    cacheMode: rawCacheMode,
  };
}

/** The signed direct-upload endpoint. Returned to authorized clients (FR-108). */
export function uploadEndpoint(cloudName: string): string {
  // `resource_type` lives here, in the URL path — NOT in the string to sign
  // (research.md #3).
  return `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
}
