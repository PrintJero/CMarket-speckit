"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListingMediaTile, type MediaItem } from "./ListingMediaTile";

/**
 * The custom CMarket multi-image uploader (017-cloudinary-listing-media,
 * FR-001–FR-013).
 *
 * Explicitly NOT the Cloudinary Upload Widget (FR-002): nothing here loads any
 * Cloudinary script. Bytes go browser-to-Cloudinary directly using short-lived
 * signed parameters this app's own server issues.
 *
 * Two invariants worth stating because they are easy to break:
 *
 *   1. PER-FILE STATE IS SEPARATE FROM DISPLAY ORDER. State lives in a Map keyed
 *      by a generated file id; order is the `order` array. That separation IS
 *      FR-017 — the member's chosen order survives regardless of which upload
 *      finishes first.
 *   2. A RETRY REUSES THE ISSUED publicId. Re-authorizing from scratch would
 *      mint a second asset identity and double-count the eight-photo cap, so
 *      retrying the eighth photo would fail for no comprehensible reason
 *      (research.md #7).
 */

export const MAX_LISTING_PHOTOS = 8;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const UPLOAD_CONCURRENCY = 3;

export interface SavedPhoto {
  id: string;
  width: number;
  height: number;
  isCover: boolean;
}

export interface ListingMediaUploaderProps {
  communityId: string;
  /** Present in edit mode; equals the draftId used for authorization. */
  listingId?: string;
  initialPhotos?: SavedPhoto[];
  /** Reports the ordered public-ID set plus cover, for the form to submit. */
  onChange: (state: {
    photos: { publicId: string; displayOrder: number }[];
    coverPublicId?: string;
    savedPhotoIds: string[];
    coverSavedPhotoId?: string;
    busy: boolean;
    hasFailures: boolean;
    draftId: string;
  }) => void;
}

interface AuthorizeResponse {
  ok: true;
  upload: {
    url: string;
    apiKey: string;
    timestamp: number;
    signature: string;
    publicId: string;
    type: string;
    context: string;
  };
}

function newId(): string {
  return `m${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Server reasons mapped to something a member can act on. */
const AUTHORIZE_ERRORS: Record<string, string> = {
  // The one that is NOT the member's fault and that retrying cannot fix.
  provider_unconfigured:
    "Image uploads are not configured on the server. If you are running locally, restart the dev server after setting the CLOUDINARY_* variables in .env.",
  photo_limit_reached: `You can attach at most ${MAX_LISTING_PHOTOS} photos to a listing.`,
  not_a_member: "You are no longer a member of this community.",
  not_owner: "Only the listing's owner can add photos to it.",
  community_not_active: "This community is suspended, so listings cannot be edited right now.",
  not_authorized: "This account cannot upload listing photos.",
  authorization_expired: "That upload took too long to start. Remove the file and add it again.",
  unauthorized_asset: "That upload could not be verified. Remove the file and add it again.",
  invalid_input: "Something is wrong with this upload request. Reload the page and try again.",
};

export function ListingMediaUploader({
  communityId,
  listingId,
  initialPhotos = [],
  onChange,
}: ListingMediaUploaderProps) {
  // In edit mode the draftId IS the listingId, so the server can check ownership
  // at authorization time. In create mode it is a stable per-session opaque id.
  const draftIdRef = useRef<string>(listingId ?? newId());

  const [items, setItems] = useState<Map<string, MediaItem>>(() => {
    const initial = new Map<string, MediaItem>();
    for (const photo of initialPhotos) {
      const id = newId();
      initial.set(id, {
        id,
        state: "uploaded",
        previewUrl: null,
        savedPhotoId: photo.id,
        savedWidth: photo.width,
        savedHeight: photo.height,
        fileName: "",
        progress: 100,
      });
    }
    return initial;
  });
  const [order, setOrder] = useState<string[]>(() => []);
  const [coverId, setCoverId] = useState<string | null>(null);

  // Files and abort handles never belong in React state — they are not rendered
  // and must not trigger re-renders.
  const filesRef = useRef<Map<string, File>>(new Map());
  const abortsRef = useRef<Map<string, AbortController>>(new Map());
  /** The server-issued public ID per file. A ref, not state, because uploadOne
   *  is memoised and its captured state can be a render behind — reading a
   *  stale undefined here would make a retry mint a second asset identity. */
  const issuedPublicIdRef = useRef<Map<string, string>>(new Map());

  // Seed order/cover from the saved photos exactly once.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const ids = [...items.keys()];
    setOrder(ids);
    const coverIndex = initialPhotos.findIndex((photo) => photo.isCover);
    setCoverId(coverIndex >= 0 ? (ids[coverIndex] ?? null) : (ids[0] ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback((id: string, patch: Partial<MediaItem>) => {
    setItems((prev) => {
      const existing = prev.get(id);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(id, { ...existing, ...patch });
      return next;
    });
  }, []);

  /**
   * Returns the signed params, or a HUMAN-READABLE reason for the failure.
   *
   * Surfacing the server's actual reason matters: a generic "could not
   * authorize" hides the difference between "the server has no Cloudinary
   * credentials" (a deploy/config problem, retrying forever will not help) and
   * "you already have 8 photos" (a user problem with an obvious action).
   */
  const authorize = useCallback(
    async (
      existingPublicId?: string,
    ): Promise<{ upload: AuthorizeResponse["upload"] } | { error: string }> => {
      let response: Response;
      try {
        response = await fetch("/api/listing-media/authorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            communityId,
            draftId: draftIdRef.current,
            ...(listingId ? { listingId } : {}),
            // Retry mode: reuse the asset identity already issued for this file.
            ...(existingPublicId ? { publicId: existingPublicId } : {}),
          }),
        });
      } catch {
        return { error: "Network error contacting CMarket. Check your connection and retry." };
      }

      if (response.ok) {
        const data = (await response.json()) as AuthorizeResponse;
        if (!data.ok) return { error: "Upload authorization was refused." };

        // Validate the shape before trusting it. Cloudinary decides signed vs
        // UNSIGNED by whether api_key is present, so posting a response with a
        // missing or empty api_key gets the baffling "Upload preset must be
        // specified when using unsigned upload" — an error that says nothing
        // about the real cause. Catching it here names the actual problem.
        const missing = (["url", "apiKey", "signature", "publicId", "type"] as const).filter(
          (key) => !data.upload?.[key],
        );
        if (missing.length > 0 || !data.upload?.timestamp) {
          return {
            error:
              `The server returned incomplete upload credentials (missing: ${[...missing, ...(data.upload?.timestamp ? [] : ["timestamp"])].join(", ")}). ` +
              `This is a server configuration problem, not something retrying will fix — check the CLOUDINARY_* variables and restart the server.`,
          };
        }
        return { upload: data.upload };
      }

      const reason = await response
        .json()
        .then((body: { reason?: string }) => body.reason)
        .catch(() => undefined);

      return { error: AUTHORIZE_ERRORS[reason ?? ""] ?? `Upload authorization failed (${response.status}).` };
    },
    [communityId, listingId],
  );

  const uploadOne = useCallback(
    async (id: string) => {
      const file = filesRef.current.get(id);
      if (!file) return;

      update(id, { state: "uploading", progress: 0, error: undefined });

      // Read the issued public ID from the ref, not from `items`: uploadOne is
      // memoised, so its captured `items` can be a render behind — and on a
      // retry that would look like "no public ID yet" and silently fall back to
      // initial mode, minting a second asset identity for one file.
      const publicIdRef = issuedPublicIdRef.current.get(id);

      // Retry mode whenever this file already has a server-issued public ID.
      // Reusing it is what stops a retry double-counting the photo cap
      // (research.md #7).
      //
      // Authorization happens immediately before EVERY attempt, so signed params
      // are never stale — which is why there is no client-side refresh
      // threshold: a file that sat queued behind the concurrency pool simply
      // gets freshly signed params when its turn comes (FR-009).
      const authorized = await authorize(publicIdRef);
      if ("error" in authorized) {
        update(id, { state: "failed", error: authorized.error });
        return;
      }
      const upload = authorized.upload;
      issuedPublicIdRef.current.set(id, upload.publicId);
      update(id, { publicId: upload.publicId });

      const controller = new AbortController();
      abortsRef.current.set(id, controller);

      await new Promise<void>((resolve) => {
        // XMLHttpRequest, not fetch: `fetch` still exposes no upload-progress
        // event, and FR-007 requires per-file progress. Do not "modernize" this
        // to fetch — doing so silently removes the progress bar.
        const xhr = new XMLHttpRequest();
        xhr.open("POST", upload.url);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            update(id, { progress: Math.round((event.loaded / event.total) * 100) });
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            update(id, { state: "uploaded", progress: 100 });
          } else {
            update(id, { state: "failed", error: `Upload failed (${xhr.status}). Retry.` });
          }
          resolve();
        };
        xhr.onerror = () => {
          update(id, { state: "failed", error: "Upload failed. Retry." });
          resolve();
        };
        xhr.onabort = () => resolve();
        controller.signal.addEventListener("abort", () => xhr.abort());

        const form = new FormData();
        form.append("file", file);
        form.append("api_key", upload.apiKey);
        form.append("timestamp", String(upload.timestamp));
        form.append("signature", upload.signature);
        form.append("public_id", upload.publicId);
        form.append("type", upload.type);
        form.append("context", upload.context);
        // Exactly the parameters the server signed, byte-identical. Adding a
        // signable extra here — max_file_size, for instance — changes the
        // string-to-sign and Cloudinary rejects the upload with 401.
        form.append("allowed_formats", "jpg,png,webp");
        xhr.send(form);
      });

      abortsRef.current.delete(id);
    },
    [authorize, update],
  );

  /** FR-011: bounded concurrency via a promise pool — three workers draining a
   *  queue. Structural, not a timing coincidence. */
  const pump = useCallback(
    async (ids: string[]) => {
      const queue = [...ids];
      const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          await uploadOne(next);
        }
      });
      await Promise.all(workers);
    },
    [uploadOne],
  );

  const onSelect = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;

      const accepted: string[] = [];
      setItems((prev) => {
        const next = new Map(prev);
        let liveCount = [...prev.values()].filter((item) => item.state !== "rejected").length;

        for (const file of Array.from(fileList)) {
          const id = newId();

          if (!ACCEPTED_MIME.has(file.type)) {
            next.set(id, {
              id,
              state: "rejected",
              previewUrl: null,
              fileName: file.name,
              progress: 0,
              error: "unsupported file type. Use JPEG, PNG, or WebP.",
            });
            continue;
          }
          if (file.size > MAX_FILE_SIZE_BYTES) {
            next.set(id, {
              id,
              state: "rejected",
              previewUrl: null,
              fileName: file.name,
              progress: 0,
              error: "larger than 10 MB.",
            });
            continue;
          }
          if (liveCount >= MAX_LISTING_PHOTOS) {
            next.set(id, {
              id,
              state: "rejected",
              previewUrl: null,
              fileName: file.name,
              progress: 0,
              error: `not added — a listing can have at most ${MAX_LISTING_PHOTOS} photos.`,
            });
            continue;
          }

          liveCount += 1;
          filesRef.current.set(id, file);
          next.set(id, {
            id,
            state: "queued",
            previewUrl: URL.createObjectURL(file),
            fileName: file.name,
            progress: 0,
          });
          accepted.push(id);
        }
        return next;
      });

      if (accepted.length > 0) {
        setOrder((prev) => [...prev, ...accepted]);
        setCoverId((prev) => prev ?? accepted[0]);
        void pump(accepted);
      }
    },
    [pump],
  );

  const onRemove = useCallback((id: string) => {
    // Abort any in-flight upload, then release the object URL so the preview
    // does not leak.
    abortsRef.current.get(id)?.abort();
    abortsRef.current.delete(id);
    filesRef.current.delete(id);
    issuedPublicIdRef.current.delete(id);

    setItems((prev) => {
      const item = prev.get(id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setOrder((prev) => prev.filter((entry) => entry !== id));
    setCoverId((prev) => (prev === id ? null : prev));
  }, []);

  const onRetry = useCallback(
    (id: string) => {
      void pump([id]);
    },
    [pump],
  );

  /** Reorders the display array only — in-flight uploads are untouched, which is
   *  what keeps FR-017 true. */
  const onMove = useCallback((id: string, direction: -1 | 1) => {
    setOrder((prev) => {
      const index = prev.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const visible = useMemo(
    () => order.map((id) => items.get(id)).filter((item): item is MediaItem => item !== undefined),
    [order, items],
  );
  const rejected = useMemo(
    () => [...items.values()].filter((item) => item.state === "rejected"),
    [items],
  );

  const effectiveCoverId = coverId ?? order[0] ?? null;

  // Report upward so the form knows what to submit and whether it may.
  useEffect(() => {
    const busy = visible.some((item) => item.state === "queued" || item.state === "uploading");
    const hasFailures = visible.some((item) => item.state === "failed");

    const pendingPhotos: { publicId: string; displayOrder: number }[] = [];
    const savedPhotoIds: string[] = [];
    visible.forEach((item, index) => {
      if (item.publicId && item.state === "uploaded") {
        pendingPhotos.push({ publicId: item.publicId, displayOrder: index });
      } else if (item.savedPhotoId) {
        savedPhotoIds.push(item.savedPhotoId);
      }
    });

    const coverItem = effectiveCoverId ? items.get(effectiveCoverId) : undefined;

    onChange({
      photos: pendingPhotos,
      coverPublicId: coverItem?.publicId,
      savedPhotoIds,
      coverSavedPhotoId: coverItem?.savedPhotoId,
      busy,
      hasFailures,
      draftId: draftIdRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, effectiveCoverId, items]);

  const liveCount = visible.length;

  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-[13px] font-semibold text-ink" htmlFor="listing-photos">
        Photos (optional, up to {MAX_LISTING_PHOTOS})
      </label>
      <input
        id="listing-photos"
        className="w-full text-sm text-ink"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={liveCount >= MAX_LISTING_PHOTOS}
        onChange={(event) => {
          onSelect(event.target.files);
          // Reset so selecting the same file again is a distinct entry.
          event.target.value = "";
        }}
      />

      {rejected.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {rejected.map((item) => (
            <ListingMediaTile
              key={item.id}
              item={item}
              communityId={communityId}
              index={0}
              total={0}
              isCover={false}
              onRemove={onRemove}
              onRetry={onRetry}
              onMove={onMove}
              onSetCover={setCoverId}
            />
          ))}
        </ul>
      )}

      {visible.length > 0 && (
        <ul data-testid="media-tiles" className="mt-2 flex flex-wrap gap-2">
          {visible.map((item, index) => (
            <ListingMediaTile
              key={item.id}
              item={item}
              communityId={communityId}
              index={index}
              total={visible.length}
              isCover={item.id === effectiveCoverId}
              onRemove={onRemove}
              onRetry={onRetry}
              onMove={onMove}
              onSetCover={setCoverId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
