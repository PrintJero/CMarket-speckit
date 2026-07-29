"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "../../../_components/FormField";
import { Button } from "../../../_components/Button";

type RecordTransactionResponse = { ok: true } | { ok: false; reason: string };

export interface RecordTransactionButtonProps {
  communityId: string;
  threadId: string;
}

/** Records a transaction derived entirely from threadId — no counterpart/listing field to fill in (research.md #2, FR-001). */
export function RecordTransactionButton({ communityId, threadId }: RecordTransactionButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onClick() {
    setError(null);
    setSubmitting(true);
    const response = await fetch(`/api/communities/${communityId}/threads/${threadId}/transaction`, {
      method: "POST",
    });
    const data: RecordTransactionResponse = await response.json();
    setSubmitting(false);
    if (!data.ok) {
      setError(`Failed: ${data.reason}`);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {error && <FormError>{error}</FormError>}
      <Button type="button" variant="secondary" disabled={submitting} onClick={onClick}>
        Record transaction
      </Button>
    </div>
  );
}
