"use client";

import { ListingImage } from "../../../_components/ListingImage";

/**
 * One tile in the custom listing-media uploader (017-cloudinary-listing-media).
 *
 * Presentational only — every piece of state and every action lives in
 * ListingMediaUploader. Split out because a single component owning the promise
 * pool AND eight tiles' worth of state is the kind of file nobody wants to review.
 */

export type MediaItemState = "queued" | "uploading" | "uploaded" | "failed" | "rejected";

export interface MediaItem {
  /** Client-generated. Keyed by this, NOT by filename or index, so duplicate
   *  selections stay distinct and reordering never disturbs an in-flight upload. */
  id: string;
  state: MediaItemState;
  /** Local object URL for a pending file; null for an already-saved photo. */
  previewUrl: string | null;
  /** Set for an already-saved photo (edit mode), which previews via the proxy. */
  savedPhotoId?: string;
  savedWidth?: number;
  savedHeight?: number;
  fileName: string;
  progress: number;
  /** The public ID the server issued. Kept so a RETRY reuses the same asset
   *  identity rather than minting a new one (research.md #7). */
  publicId?: string;
  error?: string;
}

export interface ListingMediaTileProps {
  item: MediaItem;
  communityId: string;
  index: number;
  total: number;
  isCover: boolean;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onSetCover: (id: string) => void;
}

const STATE_LABEL: Record<MediaItemState, string> = {
  queued: "Waiting",
  uploading: "Uploading",
  uploaded: "Ready",
  failed: "Failed",
  rejected: "Rejected",
};

export function ListingMediaTile({
  item,
  communityId,
  index,
  total,
  isCover,
  onRemove,
  onRetry,
  onMove,
  onSetCover,
}: ListingMediaTileProps) {
  if (item.state === "rejected") {
    return (
      <li
        data-testid="media-tile-rejected"
        className="flex w-full items-start justify-between gap-2 rounded-[10px] border border-border bg-surface px-3 py-2"
      >
        <p className="text-[13px] text-ink">
          <span className="font-semibold">{item.fileName}</span> — {item.error}
        </p>
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          className="text-[13px] font-semibold text-ink-muted hover:text-ink"
        >
          Dismiss
        </button>
      </li>
    );
  }

  return (
    <li
      data-testid="media-tile"
      data-state={item.state}
      className="w-[140px] rounded-[10px] border border-border bg-surface p-1.5"
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-[6px] bg-bg">
        {item.previewUrl ? (
          /* A local object-URL preview of a file that has no ListingPhoto row
             yet, so it is unreachable through the delivery proxy — ListingImage
             cannot render it. Not listing media in the FR-049 sense. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
        ) : item.savedPhotoId ? (
          <ListingImage
            communityId={communityId}
            photoId={item.savedPhotoId}
            variant="thumbnail"
            width={item.savedWidth ?? 4}
            height={item.savedHeight ?? 3}
            alt={`Saved photo ${index + 1} of ${total}`}
            className="h-full w-full object-cover"
          />
        ) : null}

        {item.state === "uploading" && (
          <div className="absolute bottom-0 left-0 h-1 bg-brand" style={{ width: `${item.progress}%` }} />
        )}
      </div>

      <p data-testid="media-tile-state" className="mt-1 truncate text-[11px] font-semibold text-ink-muted">
        {STATE_LABEL[item.state]}
        {isCover ? " · Cover" : ""}
      </p>

      {item.error && item.state === "failed" && (
        <p className="mt-0.5 text-[11px] text-ink">{item.error}</p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-1">
        {/* FR-010 / Principle V: move buttons, never drag-and-drop. Native drag
            events do not fire on touch, so a drag-only reorder would make a core
            interaction desktop-only. Buttons are keyboard-reachable for free. */}
        <button
          type="button"
          aria-label="Move left"
          data-testid="media-move-left"
          disabled={index === 0}
          onClick={() => onMove(item.id, -1)}
          className="rounded px-1.5 text-[13px] font-semibold text-ink disabled:opacity-30"
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Move right"
          data-testid="media-move-right"
          disabled={index === total - 1}
          onClick={() => onMove(item.id, 1)}
          className="rounded px-1.5 text-[13px] font-semibold text-ink disabled:opacity-30"
        >
          →
        </button>
        {!isCover && item.state === "uploaded" && (
          <button
            type="button"
            data-testid="media-set-cover"
            onClick={() => onSetCover(item.id)}
            className="rounded px-1.5 text-[11px] font-semibold text-brand-dark"
          >
            Cover
          </button>
        )}
        {item.state === "failed" && (
          <button
            type="button"
            data-testid="media-retry"
            onClick={() => onRetry(item.id)}
            className="rounded px-1.5 text-[11px] font-semibold text-brand-dark"
          >
            Retry
          </button>
        )}
        <button
          type="button"
          data-testid="media-remove"
          onClick={() => onRemove(item.id)}
          className="rounded px-1.5 text-[11px] font-semibold text-ink-muted"
        >
          Remove
        </button>
      </div>
    </li>
  );
}
