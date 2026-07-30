"use client";

import { useEffect, useState } from "react";
import { FormError } from "../../../_components/FormField";
import { Button } from "../../../_components/Button";

type CreateReviewResponse = { ok: true } | { ok: false; reason: string };

export interface RatingModalProps {
  communityId: string;
  transactionId: string;
  /** Called after a successful submit, and also when dismissed via "Maybe later", Escape, or the backdrop — the caller decides what to refresh. */
  onClose: () => void;
}

/**
 * Shown immediately after a transaction is confirmed (post-ride-style prompt),
 * for the confirming participant to rate the other one. Rating remains
 * optional: dismissing via "Maybe later" leaves the transaction unrated, still
 * ratable afterward from the transaction page's own inline form — this modal
 * calls the exact same review-creation endpoint, no new eligibility/uniqueness
 * rule is introduced.
 */
export function RatingModal({ communityId, transactionId, onClose }: RatingModalProps) {
  const [rating, setRating] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function onSubmit() {
    if (rating === null) return;
    setSubmitting(true);
    setError(null);
    const response = await fetch(`/api/communities/${communityId}/transactions/${transactionId}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    });
    const data: CreateReviewResponse = await response.json();
    setSubmitting(false);
    if (!data.ok) {
      setError(`Failed: ${data.reason}`);
      return;
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={() => onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Rate this transaction"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-card bg-surface p-6 shadow-card"
      >
        <p className="mb-1 text-center text-[16px] font-bold text-ink">Rate this transaction</p>
        <p className="mb-5 text-center text-[13px] text-ink-muted">How did it go with the other person?</p>

        <div className="mb-5 flex justify-center gap-1.5" role="radiogroup" aria-label="Rating, 1 to 5 stars">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rating === value}
              aria-label={`${value} star${value === 1 ? "" : "s"}`}
              onClick={() => setRating(value)}
              className="text-[32px] leading-none transition-colors"
            >
              <span className={rating !== null && value <= rating ? "text-brand" : "text-border"}>
                {rating !== null && value <= rating ? "★" : "☆"}
              </span>
            </button>
          ))}
        </div>

        {error && <FormError>{error}</FormError>}

        <div className="flex flex-col gap-2">
          <Button type="button" fullWidth disabled={rating === null || submitting} onClick={onSubmit}>
            Submit
          </Button>
          <Button type="button" variant="secondary" fullWidth disabled={submitting} onClick={() => onClose()}>
            Maybe later
          </Button>
        </div>
      </div>
    </div>
  );
}
