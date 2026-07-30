"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "../../../_components/FormField";
import { Button } from "../../../_components/Button";
import { RatingModal } from "./RatingModal";

type ConfirmTransactionResponse = { ok: true } | { ok: false; reason: string };

export interface ConfirmTransactionButtonProps {
  communityId: string;
  transactionId: string;
}

/**
 * Confirms a transaction — rendered only for the account named as its
 * counterpart while UNCONFIRMED (FR-005). Confirming immediately prompts the
 * confirming participant to rate the other one (post-ride-style), via the
 * exact same optional, already-eligible review-creation action available
 * later on the transaction page — no new eligibility/uniqueness rule.
 */
export function ConfirmTransactionButton({ communityId, transactionId }: ConfirmTransactionButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);

  async function onClick() {
    setError(null);
    setSubmitting(true);
    const response = await fetch(`/api/communities/${communityId}/transactions/${transactionId}/confirm`, {
      method: "POST",
    });
    const data: ConfirmTransactionResponse = await response.json();
    setSubmitting(false);
    if (!data.ok) {
      setError(`Failed: ${data.reason}`);
      return;
    }
    setShowRatingModal(true);
  }

  function onModalClose() {
    setShowRatingModal(false);
    router.refresh();
  }

  return (
    <div className="mt-2">
      {error && <FormError>{error}</FormError>}
      <Button type="button" disabled={submitting} onClick={onClick}>
        Confirm transaction
      </Button>
      {showRatingModal && (
        <RatingModal communityId={communityId} transactionId={transactionId} onClose={onModalClose} />
      )}
    </div>
  );
}
