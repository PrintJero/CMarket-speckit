"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../../_components/Button";
import { FormError } from "../../../../_components/FormField";

export interface ListingActionsProps {
  communityId: string;
  listingId: string;
  initialStatus: "ACTIVE" | "PAUSED";
  /** True for the owner, or (from Phase 7) that community's administrator. */
  canModerate: boolean;
  /** True only for the owner — delete is never available to an administrator (FR-010). */
  isOwner: boolean;
}

export function ListingActions({
  communityId,
  listingId,
  initialStatus,
  canModerate,
  isOwner,
}: ListingActionsProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);

  async function onPause() {
    setError(null);
    const response = await fetch(`/api/communities/${communityId}/listings/${listingId}/pause`, {
      method: "POST",
    });
    if (response.ok) {
      setStatus("PAUSED");
    } else {
      const data = await response.json();
      setError(data.reason);
    }
  }

  async function onReactivate() {
    setError(null);
    const response = await fetch(`/api/communities/${communityId}/listings/${listingId}/reactivate`, {
      method: "POST",
    });
    if (response.ok) {
      setStatus("ACTIVE");
    } else {
      const data = await response.json();
      setError(data.reason);
    }
  }

  async function onDelete() {
    setError(null);
    const response = await fetch(`/api/communities/${communityId}/listings/${listingId}`, {
      method: "DELETE",
    });
    if (response.status === 204) {
      router.push(`/communities/${communityId}/listings`);
    } else {
      const data = await response.json();
      setError(data.reason);
    }
  }

  if (!canModerate) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === "ACTIVE" ? (
        <Button variant="secondary" type="button" onClick={onPause}>
          Pause
        </Button>
      ) : (
        <Button variant="secondary" type="button" onClick={onReactivate}>
          Reactivate
        </Button>
      )}
      {isOwner && (
        <Button variant="dangerOutline" type="button" onClick={onDelete}>
          Delete
        </Button>
      )}
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
