"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormField, FormError, fieldInputClassName } from "../_components/FormField";
import { Button } from "../_components/Button";

type SetDisplayNameResponse =
  | { ok: true; account: { id: string; displayName: string } }
  | { ok: false; reason: "invalid_display_name" };

/**
 * 006-user-display-names' PATCH /api/account/display-name already existed,
 * but every existing caller only surfaces it as a one-time, action-blocking
 * prompt (ListingForm.tsx, ThreadReplyForm.tsx, MessageOwnerForm.tsx) —
 * there was previously no standalone way to change an already-set display
 * name from the Account page on its own. Same endpoint, same validation,
 * just a persistent entry point instead of a one-time gate.
 */
export function DisplayNameForm({ currentDisplayName }: { currentDisplayName: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(currentDisplayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const response = await fetch("/api/account/display-name", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    });
    const data: SetDisplayNameResponse = await response.json();

    if (!data.ok) {
      setError("That name isn't valid. Please try a different one.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDisplayName(currentDisplayName ?? "");
          setError(null);
          setEditing(true);
        }}
        className="mt-1 text-[13px] font-semibold text-brand hover:underline"
      >
        Change name
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 max-w-xs">
      <FormField label="Display name">
        <input
          className={fieldInputClassName}
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </FormField>
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          Save
        </Button>
        <Button type="button" variant="secondary" disabled={submitting} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
