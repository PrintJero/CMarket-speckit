import type { ListingImageVariant } from "@/lib/cloudinary/variants";

/**
 * The ONLY component that renders listing media (017-cloudinary-listing-media,
 * FR-049, FR-063–FR-070).
 *
 * `next/image` is deliberately NOT used. Listing images are delivered through an
 * authenticated CMarket proxy that re-checks session and membership on every
 * request, so there is no remote host to allowlist, no loader to configure, and
 * no benefit to a second optimization layer over bytes Cloudinary has already
 * sized to a predefined variant. A plain <img> is the decision, not an oversight
 * (research.md #6, #12).
 *
 * Consequently this file — and ONLY this file — carries an
 * @next/next/no-img-element suppression. A suppression anywhere else in listing
 * media is a review defect.
 *
 * Existing in exactly one place also means exactly one place knows how a listing
 * image is fetched. That is what keeps a future change to the delivery scheme a
 * contained edit rather than a sweep.
 */

export interface ListingImageProps {
  communityId: string;
  /** ListingPhoto.id. Never a Cloudinary public ID — that never reaches a browser (FR-056). */
  photoId: string;
  /** Closed union: the component cannot request an arbitrary size (FR-060). */
  variant: ListingImageVariant;
  /** Stored intrinsic dimensions, so the browser reserves the right ratio (FR-068). */
  width: number;
  height: number;
  /** Required, not optional — FR-066 has no exceptions. */
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
}

export function ListingImage({
  communityId,
  photoId,
  variant,
  width,
  height,
  alt,
  className,
  loading = "lazy",
}: ListingImageProps) {
  const src = `/api/communities/${communityId}/listing-photos/${photoId}?v=${variant}`;

  return (
    /* Listing media is delivered through an authenticated CMarket proxy
       (FR-049), so there is no remote host to allowlist and no benefit to a
       second optimization layer over bytes Cloudinary already sized to a
       predefined variant. next/image is deliberately not used (FR-063). */
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding="async"
      className={className}
    />
  );
}

/**
 * The existing no-photo placeholder (FR-069, SC-018). Markup and
 * data-testid are preserved verbatim so current tests keep passing, and so a
 * legacy listing whose photos the migration deleted renders cleanly rather than
 * erroring.
 */
export function ListingImagePlaceholder({ className }: { className?: string }) {
  return (
    <div
      data-testid="listing-cover-placeholder"
      className={
        className ??
        "flex h-full w-full items-center justify-center text-[13px] font-semibold text-ink-muted"
      }
    >
      No photo
    </div>
  );
}
