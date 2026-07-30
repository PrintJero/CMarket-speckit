"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "../../../../_components/FormField";
import { Button } from "../../../../_components/Button";

type CreateReviewResponse =
  | { ok: true; review: { id: string; rating: number; createdAt: string } }
  | { ok: false; reason: string };

export interface ReviewFormProps {
  communityId: string;
  transactionId: string;
}

/** Lets the caller leave a 1-5 rating for a CONFIRMED transaction's other participant (FR-010). Rendered only while the caller hasn't already rated it. */
export function ReviewForm({ communityId, transactionId }: ReviewFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitRating(rating: number) {
    setError(null);
    setSubmitting(true);
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
    router.refresh();
  }

  return (
    <div className="mt-3" data-testid="review-form">
      <p className="mb-2 text-[13px] font-semibold text-ink">Rate this transaction</p>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((rating) => (
          <Button
            key={rating}
            type="button"
            variant="secondary"
            className="!px-4 !py-2"
            disabled={submitting}
            onClick={() => submitRating(rating)}
          >
            {rating}
          </Button>
        ))}
      </div>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
