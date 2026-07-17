"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormField, FormError, fieldInputClassName } from "../../../../_components/FormField";
import { Button } from "../../../../_components/Button";

type SendMessageResponse =
  | { ok: true; thread: { id: string } }
  | { ok: false; reason: string };

type SetDisplayNameResponse =
  | { ok: true; account: { id: string; displayName: string } }
  | { ok: false; reason: "invalid_display_name" };

export interface MessageOwnerFormProps {
  communityId: string;
  listingId: string;
  /**
   * The signed-in account's current display name (006-user-display-names,
   * FR-008 / 008-listing-messaging FR-010). When null, a required "Display
   * name" field is shown and set before the message itself is sent — same
   * sequencing as ListingForm.tsx.
   */
  currentDisplayName?: string | null;
}

/** Sends the caller's (buyer's) first or next message to this listing's owner (FR-001, FR-002). */
export function MessageOwnerForm({ communityId, listingId, currentDisplayName = null }: MessageOwnerFormProps) {
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

    const response = await fetch(`/api/communities/${communityId}/listings/${listingId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const data: SendMessageResponse = await response.json();

    if (!data.ok) {
      setError(`Failed: ${data.reason}`);
      setSubmitting(false);
      return;
    }

    router.push(`/communities/${communityId}/threads/${data.thread.id}`);
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
      <FormField label="Message">
        <textarea
          className={fieldInputClassName}
          required
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </FormField>
      {error && <FormError>{error}</FormError>}
      <Button type="submit" fullWidth disabled={submitting}>
        Send message
      </Button>
    </form>
  );
}
