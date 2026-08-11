"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormField, FormError, fieldInputClassName } from "../../../_components/FormField";
import { Button } from "../../../_components/Button";
import { ListingMediaUploader, type SavedPhoto } from "./ListingMediaUploader";

interface MediaState {
  photos: { publicId: string; displayOrder: number }[];
  coverPublicId?: string;
  savedPhotoIds: string[];
  coverSavedPhotoId?: string;
  busy: boolean;
  hasFailures: boolean;
  draftId: string;
}

type CreateListingResponse =
  | { ok: true; listing: { id: string } }
  | { ok: false; reason: "invalid_input" | "not_a_member" | "display_name_required" };

type UpdateListingResponse =
  | { ok: true; listing: { id: string } }
  | { ok: false; reason: "invalid_input" | "not_owner" | "not_found" };

type SetDisplayNameResponse =
  | { ok: true; account: { id: string; displayName: string } }
  | { ok: false; reason: "invalid_display_name" };

export interface ListingFormProps {
  communityId: string;
  /** When set, the form edits this existing listing instead of creating a new one. */
  listingId?: string;
  initialTitle?: string;
  initialDescription?: string;
  initialPriceCents?: number | null;
  /**
   * 011-wanted-posts: only meaningful in create mode — kind is immutable
   * after creation (research.md #5), so edit mode never shows the selector,
   * it just labels the price field according to the listing's existing kind.
   */
  initialKind?: "FOR_SALE" | "WANTED";
  /** 013-purchase-flow-stock, FR-001: seller-declared; null/undefined means not specified. */
  initialStockQuantity?: number | null;
  /**
   * 017-cloudinary-listing-media: already-saved Cloudinary photos, in display
   * order. Edit mode only — they preview through the authenticated proxy while
   * newly selected files preview from local object URLs.
   */
  initialPhotos?: SavedPhoto[];
  /**
   * The signed-in account's current display name (006-user-display-names,
   * FR-008). When null in create mode, a required "Display name" field is
   * shown and set before the listing itself is created — never in edit mode,
   * since an account that already has a listing to edit already has a name.
   */
  currentDisplayName?: string | null;
}

export function ListingForm({
  communityId,
  listingId,
  initialTitle = "",
  initialDescription = "",
  initialPriceCents,
  initialKind = "FOR_SALE",
  initialStockQuantity,
  initialPhotos = [],
  currentDisplayName = null,
}: ListingFormProps) {
  const router = useRouter();
  const isEditMode = listingId !== undefined;
  const needsDisplayName = !isEditMode && !currentDisplayName;
  const [kind, setKind] = useState<"FOR_SALE" | "WANTED">(initialKind);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [price, setPrice] = useState(
    initialPriceCents !== undefined && initialPriceCents !== null ? (initialPriceCents / 100).toFixed(2) : "",
  );
  const [stockQuantity, setStockQuantity] = useState(
    initialStockQuantity !== undefined && initialStockQuantity !== null ? String(initialStockQuantity) : "",
  );
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isWanted = kind === "WANTED";

  /**
   * 017-cloudinary-listing-media: the uploader owns per-file state and reports
   * the ordered result up. The old per-file `POST` of raw bytes is gone —
   * uploads now go browser-to-Cloudinary directly, and this form only
   * ASSOCIATES the results after the listing is saved.
   */
  const [media, setMedia] = useState<MediaState>({
    photos: [],
    savedPhotoIds: [],
    busy: false,
    hasFailures: false,
    draftId: listingId ?? "",
  });

  async function associatePhotos(targetListingId: string) {
    // Nothing selected and nothing saved: no association call is needed.
    if (media.photos.length === 0 && media.savedPhotoIds.length === 0) return;

    const response = await fetch(
      `/api/communities/${communityId}/listings/${targetListingId}/photos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: media.draftId || targetListingId,
          photos: media.photos,
          ...(media.coverPublicId ? { coverPublicId: media.coverPublicId } : {}),
        }),
      },
    );

    if (!response.ok) {
      // FR-077: successful uploads are NOT lost. The pending rows survive until
      // they expire, so resubmitting succeeds without re-uploading anything.
      throw new Error(
        "Your photos uploaded, but saving them to the listing failed. Try submitting again — they will not need to be re-uploaded.",
      );
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // FR-012, FR-076: the form MUST NOT finish while any image is waiting or
    // uploading, and a failed image must be retried or removed first. The two
    // cases get distinct messages because they need different actions.
    if (media.busy) {
      setError("Photos are still uploading. Wait for them to finish before saving.");
      return;
    }
    if (media.hasFailures) {
      setError("One or more photos failed to upload. Retry or remove them before saving.");
      return;
    }

    setSubmitting(true);

    // 011-wanted-posts: a blank price is only ever valid for a WANTED post
    // (optional budget) — omit the field entirely rather than sending 0.
    const priceCents = price.trim() === "" ? undefined : Math.round(Number(price) * 100);
    // 013-purchase-flow-stock: a blank stock field means "not specified" (null),
    // distinct from a declared 0 — omit the field entirely rather than sending 0.
    const stockQuantityValue = !isWanted && stockQuantity.trim() !== "" ? Math.round(Number(stockQuantity)) : undefined;

    if (needsDisplayName) {
      const nameResponse = await fetch("/api/account/display-name", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const nameData: SetDisplayNameResponse = await nameResponse.json();
      if (!nameData.ok) {
        setError(`Failed: ${nameData.reason}`);
        setSubmitting(false);
        return;
      }
    }

    if (isEditMode) {
      const response = await fetch(`/api/communities/${communityId}/listings/${listingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, priceCents, stockQuantity: stockQuantityValue }),
      });
      const data: UpdateListingResponse = await response.json();

      if (!data.ok) {
        setError(`Failed: ${data.reason}`);
        setSubmitting(false);
        return;
      }

      try {
        await associatePhotos(listingId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Saving photos failed.");
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      router.refresh();
      return;
    }

    const response = await fetch(`/api/communities/${communityId}/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description, priceCents, kind, stockQuantity: stockQuantityValue }),
    });
    const data: CreateListingResponse = await response.json();

    if (!data.ok) {
      setError(`Failed: ${data.reason}`);
      setSubmitting(false);
      return;
    }

    try {
      await associatePhotos(data.listing.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving photos failed.");
      setSubmitting(false);
      return;
    }
    // Land on the tab that actually shows what was just created — the main
    // view defaults to "For sale" (FR-006), which would otherwise hide a
    // freshly created Wanted post and read as though it had disappeared.
    router.push(`/communities/${communityId}${kind === "WANTED" ? "?kind=WANTED" : ""}`);
  }

  return (
    <form onSubmit={onSubmit}>
      {needsDisplayName && (
        <FormField label="Display name">
          <input
            className={fieldInputClassName}
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </FormField>
      )}
      {!isEditMode && (
        <fieldset className="mb-4">
          <legend className="mb-1.5 block text-[13px] font-semibold text-ink">I&apos;m</legend>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="kind"
                checked={kind === "FOR_SALE"}
                onChange={() => setKind("FOR_SALE")}
              />
              Selling
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="kind" checked={kind === "WANTED"} onChange={() => setKind("WANTED")} />
              Looking for
            </label>
          </div>
        </fieldset>
      )}
      <FormField label="Title">
        <input className={fieldInputClassName} value={title} onChange={(e) => setTitle(e.target.value)} />
      </FormField>
      <FormField label="Description">
        <input
          className={fieldInputClassName}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </FormField>
      <FormField label={isWanted ? "Budget (optional, MXN)" : "Price (MXN)"}>
        <input
          className={fieldInputClassName}
          type="number"
          step="0.01"
          min="0"
          required={!isWanted}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </FormField>
      {!isWanted && (
        <FormField label="Stock (seller indicates N available; leave blank if not specified)">
          <input
            className={fieldInputClassName}
            type="number"
            step="1"
            min="0"
            value={stockQuantity}
            onChange={(e) => setStockQuantity(e.target.value)}
          />
        </FormField>
      )}
      <ListingMediaUploader
        communityId={communityId}
        listingId={listingId}
        initialPhotos={initialPhotos}
        onChange={setMedia}
      />
      {error && <FormError>{error}</FormError>}
      <Button type="submit" fullWidth disabled={submitting || media.busy || media.hasFailures}>
        {isEditMode ? "Save changes" : "Create listing"}
      </Button>
    </form>
  );
}
