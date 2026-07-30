"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../../_components/Button";
import { FormError } from "../../../../_components/FormField";

export interface ListingActionsProps {
  communityId: string;
  listingId: string;
  initialStatus: "ACTIVE" | "PAUSED" | "FULFILLED";
  kind: "FOR_SALE" | "WANTED";
  /** True for the owner, or (from Phase 7) that community's administrator. */
  canModerate: boolean;
  /** True only for the owner — delete is never available to an administrator (FR-010). */
  isOwner: boolean;
}

/**
 * 011-wanted-posts, research.md #3: a FULFILLED listing is
 * administrator-untouchable in either direction — only the owner sees any
 * status-change action while FULFILLED (a "Reverse to active" button, via
 * the same /reactivate route pauseListing/reactivateListing already use).
 * Marking WANTED at will (FR-006) is exposed only to the owner, from any
 * status, via the new /fulfill route — never to an administrator, even one
 * who canModerate.
 */
export function ListingActions({
  communityId,
  listingId,
  initialStatus,
  kind,
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

  async function onFulfill() {
    setError(null);
    const response = await fetch(`/api/communities/${communityId}/listings/${listingId}/fulfill`, {
      method: "POST",
    });
    if (response.ok) {
      setStatus("FULFILLED");
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

  if (!canModerate && !isOwner) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === "FULFILLED" ? (
        isOwner && (
          <Button variant="secondary" type="button" onClick={onReactivate}>
            Reverse to active
          </Button>
        )
      ) : (
        <>
          {canModerate &&
            (status === "ACTIVE" ? (
              <Button variant="secondary" type="button" onClick={onPause}>
                Pause
              </Button>
            ) : (
              <Button variant="secondary" type="button" onClick={onReactivate}>
                Reactivate
              </Button>
            ))}
          {isOwner && kind === "WANTED" && (
            <Button variant="secondary" type="button" onClick={onFulfill}>
              Mark as fulfilled
            </Button>
          )}
        </>
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
