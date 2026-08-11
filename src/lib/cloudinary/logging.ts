/**
 * Cloudinary failure logging (017-cloudinary-listing-media, FR-100, FR-104).
 *
 * Records enough to act on a failure and nothing that would leak a credential
 * or a read capability. Specifically NEVER logged:
 *
 *   - CLOUDINARY_API_SECRET (obviously)
 *   - the API key
 *   - an upload signature
 *   - a SIGNED DELIVERY URL — a proxy that logs one undoes the entire point of
 *     not sending it to the browser, and is the same reasoning that forbids
 *     redirecting to one (FR-107)
 *
 * A bare `publicId` IS safe here: FR-056 governs browser-reachable responses,
 * not server-side diagnostics, and without it a failure is unactionable.
 */

export interface CloudinaryFailure {
  operation: "upload-authorize" | "verify" | "destroy" | "deliver";
  publicId: string;
  status?: number;
  message?: string;
}

export function logCloudinaryFailure(failure: CloudinaryFailure): void {
  const parts = [
    `[cloudinary] operation=${failure.operation}`,
    `publicId=${failure.publicId}`,
  ];
  if (failure.status !== undefined) parts.push(`status=${failure.status}`);
  if (failure.message) parts.push(`message=${JSON.stringify(failure.message)}`);
  console.error(parts.join(" "));
}
