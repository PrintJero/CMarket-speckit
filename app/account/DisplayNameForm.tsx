"use client";

import { useState } from "react";

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
      <label className="field">
        <span className="field__label">Display name</span>
        <input
          className="field__input"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="status">
          {error}
        </p>
      )}
      <button className="btn-primary" type="submit" disabled={submitting}>
        Save
      </button>
    </form>
  );
}
