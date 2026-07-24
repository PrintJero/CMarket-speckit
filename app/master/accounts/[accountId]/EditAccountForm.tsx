"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormField, FormError, fieldInputClassName } from "../../../_components/FormField";
import { Button } from "../../../_components/Button";

export function EditAccountForm({
  accountId,
  initialEmail,
  initialDisplayName,
}: {
  accountId: string;
  initialEmail: string;
  initialDisplayName: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [displayName, setDisplayName] = useState(initialDisplayName ?? "");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);

    const response = await fetch(`/api/master/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, displayName }),
    });
    const data = await response.json();

    if (data.ok) {
      setMessage("Saved.");
      router.refresh();
      return;
    }
    setMessage(`Failed: ${data.reason}`);
  }

  return (
    <form onSubmit={onSubmit}>
      <FormField label="Email">
        <input
          className={fieldInputClassName}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </FormField>
      <FormField label="Display name">
        <input className={fieldInputClassName} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </FormField>
      {message && <FormError role="status">{message}</FormError>}
      <Button type="submit" variant="secondary">
        Save
      </Button>
    </form>
  );
}
