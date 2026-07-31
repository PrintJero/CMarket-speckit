"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "./FormField";
import { Button } from "./Button";
import { RatingModal } from "./RatingModal";

type ResolveProposalResponse = { ok: true } | { ok: false; reason: string };

export interface AcceptRejectButtonsProps {
  communityId: string;
  transactionId: string;
  /** The buyer's displayName, shown in the post-accept rating prompt. */
  counterpartDisplayName?: string | null;
}

/**
 * 013-purchase-flow-stock, FR-013: rendered only for the account named as a
 * PENDING proposal's seller. Accepting immediately prompts the seller to rate
 * the buyer (the same post-ride-style prompt 010/012 showed after
 * confirming — 012's own amendment note: "UI-only... not any eligibility,
 * uniqueness, confirmation, or reputation rule"), reusing the exact same
 * review-creation action. Rejecting has no further prompt (FR-016).
 */
export function AcceptRejectButtons({
  communityId,
  transactionId,
  counterpartDisplayName,
}: AcceptRejectButtonsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);

  async function resolve(action: "accept" | "reject") {
    setError(null);
    setSubmitting(true);
    const response = await fetch(`/api/communities/${communityId}/transactions/${transactionId}/${action}`, {
      method: "POST",
    });
    const data: ResolveProposalResponse = await response.json();
    setSubmitting(false);
    if (!data.ok) {
      setError(`Failed: ${data.reason}`);
      return;
    }
    if (action === "accept") {
      // Deliberately not router.refresh()'d yet: this component (and the seller's rating
      // prompt it's about to show) is only rendered by the parent page while
      // transaction.state === "PENDING" — refreshing now would re-render the parent with
      // state === "ACCEPTED" and unmount this component (and the modal) mid-flow. The
      // refresh happens once the modal itself closes (onModalClose).
      setShowRatingModal(true);
    } else {
      router.refresh();
    }
  }

  function onModalClose() {
    setShowRatingModal(false);
    router.refresh();
  }

  return (
    <div className="mt-2 flex gap-2">
      {error && <FormError>{error}</FormError>}
      <Button type="button" disabled={submitting} onClick={() => resolve("accept")}>
        Accept
      </Button>
      <Button type="button" variant="secondary" disabled={submitting} onClick={() => resolve("reject")}>
        Reject
      </Button>
      {showRatingModal && (
        <RatingModal
          communityId={communityId}
          transactionId={transactionId}
          counterpartDisplayName={counterpartDisplayName}
          onClose={onModalClose}
        />
      )}
    </div>
  );
}
