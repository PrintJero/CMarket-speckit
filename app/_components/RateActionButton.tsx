"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./Button";
import { RatingModal } from "./RatingModal";
import { resolveDisplayName } from "@/lib/formatting/displayName";

export interface RateActionButtonProps {
  communityId: string;
  transactionId: string;
  counterpartDisplayName: string | null;
  /** The caller's own rating of the counterpart on this transaction, if already submitted. */
  myRating: number | null;
}

/**
 * The Transactions list's per-row rating control for an ACCEPTED transaction:
 * a "Rate {name}" prompt that opens the same RatingModal used right after
 * accepting, or — once `myRating` is set — a read-only "You rated {name}
 * N/5" line instead. Reuses the existing review-creation endpoint; no new
 * rating rule.
 */
export function RateActionButton({
  communityId,
  transactionId,
  counterpartDisplayName,
  myRating,
}: RateActionButtonProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const name = resolveDisplayName(counterpartDisplayName);

  if (myRating !== null) {
    return (
      <p className="text-[13px] font-semibold text-ink-muted" data-testid="my-rating">
        You rated {name} {myRating}/5
      </p>
    );
  }

  return (
    <>
      <Button type="button" variant="secondary" className="!px-4 !py-2" onClick={() => setShowModal(true)}>
        Rate {name}
      </Button>
      {showModal && (
        <RatingModal
          communityId={communityId}
          transactionId={transactionId}
          counterpartDisplayName={counterpartDisplayName}
          onClose={() => {
            setShowModal(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
