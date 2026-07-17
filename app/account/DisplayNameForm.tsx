"use client";

import { useState } from "react";
import { FormField, FormError, fieldInputClassName } from "../_components/FormField";
import { Button } from "../_components/Button";

type SetDisplayNameResponse =
  | { ok: true; account: { id: string; displayName: string } }
  | { ok: false; reason: "invalid_display_name" };

export interface DisplayNameFormProps {
  currentDisplayName: string | null;
}

export function DisplayNameForm({ currentDisplayName }: DisplayNameFormProps) {
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
    setSubmitting(false);

    if (!data.ok) {
      setError(`Failed: ${data.reason}`);
      return;
    }
    setDisplayName(data.account.displayName);
  }

  return (
    <form onSubmit={onSubmit}>
      <FormField label="Display name">
        <input
          className={fieldInputClassName}
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </FormField>
      {error && <FormError>{error}</FormError>}
      <Button type="submit" disabled={submitting}>
        Save
      </Button>
    </form>
  );
}
