"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormField, FormError, fieldInputClassName, fieldTextareaClassName } from "../../../../_components/FormField";
import { Button } from "../../../../_components/Button";

type SendThreadMessageResponse = { ok: true } | { ok: false; reason: string };

type SetDisplayNameResponse =
  | { ok: true; account: { id: string; displayName: string } }
  | { ok: false; reason: "invalid_display_name" };

export interface ThreadReplyFormProps {
  communityId: string;
  threadId: string;
  /** See MessageOwnerForm.tsx's prop of the same name — same gate, same sequencing (FR-010). */
  currentDisplayName?: string | null;
}

/** Replies within an existing thread, from either the buyer or the listing's owner (FR-003). */
export function ThreadReplyForm({ communityId, threadId, currentDisplayName = null }: ThreadReplyFormProps) {
  const router = useRouter();
  const needsDisplayName = !currentDisplayName;
  const [body, setBody] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

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

    const response = await fetch(`/api/communities/${communityId}/threads/${threadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const data: SendThreadMessageResponse = await response.json();

    if (!data.ok) {
      setError(`Failed: ${data.reason}`);
      setSubmitting(false);
      return;
    }

    setBody("");
    setSubmitting(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      {needsDisplayName && (
        <FormField label="Display name">
          <input
            className={fieldInputClassName}
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </FormField>
      )}
      <FormField label="Reply">
        <textarea
          className={fieldTextareaClassName}
          required
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </FormField>
      {error && <FormError>{error}</FormError>}
      <Button type="submit" fullWidth disabled={submitting}>
        Send reply
      </Button>
    </form>
  );
}
