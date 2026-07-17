"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
  initialPriceCents?: number;
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
  currentDisplayName = null,
}: ListingFormProps) {
  const router = useRouter();
  const isEditMode = listingId !== undefined;
  const needsDisplayName = !isEditMode && !currentDisplayName;
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [price, setPrice] = useState(
    initialPriceCents !== undefined ? (initialPriceCents / 100).toFixed(2) : "",
  );
  const [displayName, setDisplayName] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function uploadPhotos(targetListingId: string) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("photo", file);
      await fetch(`/api/communities/${communityId}/listings/${targetListingId}/photos`, {
        method: "POST",
        body: formData,
      });
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const priceCents = Math.round(Number(price) * 100);

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
        body: JSON.stringify({ title, description, priceCents }),
      });
      const data: UpdateListingResponse = await response.json();

      if (!data.ok) {
        setError(`Failed: ${data.reason}`);
        setSubmitting(false);
        return;
      }

      await uploadPhotos(listingId);
      setSubmitting(false);
      router.refresh();
      return;
    }

    const response = await fetch(`/api/communities/${communityId}/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description, priceCents }),
    });
    const data: CreateListingResponse = await response.json();

    if (!data.ok) {
      setError(`Failed: ${data.reason}`);
      setSubmitting(false);
      return;
    }

    await uploadPhotos(data.listing.id);
    router.push(`/communities/${communityId}/listings`);
  }

  return (
    <form onSubmit={onSubmit}>
      {needsDisplayName && (
        <label className="field">
          <span className="field__label">Display name</span>
          <input
            className="field__input"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
      )}
      <label className="field">
        <span className="field__label">Title</span>
        <input className="field__input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Description</span>
        <input
          className="field__input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Price (MXN)</span>
        <input
          className="field__input"
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Photos (optional)</span>
        <input
          className="field__input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => setFiles(e.target.files)}
        />
      </label>
      {error && (
        <p className="form-error" role="status">
          {error}
        </p>
      )}
      <button className="btn-primary" type="submit" disabled={submitting}>
        {isEditMode ? "Save changes" : "Create listing"}
      </button>
    </form>
  );
}
