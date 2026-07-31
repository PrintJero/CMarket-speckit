"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "./FormField";
import { Button } from "./Button";

type CancelProposalResponse = { ok: true } | { ok: false; reason: string };

export interface CancelProposalButtonProps {
  communityId: string;
  transactionId: string;
}

/** 013-purchase-flow-stock, FR-018: rendered only for the account named as a PENDING proposal's buyer. */
export function CancelProposalButton({ communityId, transactionId }: CancelProposalButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onClick() {
    setError(null);
    setSubmitting(true);
    const response = await fetch(`/api/communities/${communityId}/transactions/${transactionId}/cancel`, {
      method: "POST",
    });
    const data: CancelProposalResponse = await response.json();
    setSubmitting(false);
    if (!data.ok) {
      setError(`Failed: ${data.reason}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-2">
      {error && <FormError>{error}</FormError>}
      <Button type="button" variant="secondary" disabled={submitting} onClick={onClick}>
        Cancel
      </Button>
    </div>
  );
}
