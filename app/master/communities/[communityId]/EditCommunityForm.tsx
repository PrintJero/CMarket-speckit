"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormField, FormError, fieldInputClassName } from "../../../_components/FormField";
import { Button } from "../../../_components/Button";

export function EditCommunityForm({ communityId, initialName }: { communityId: string; initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const response = await fetch(`/api/master/communities/${communityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await response.json();
    setSubmitting(false);

    if (data.ok) {
      setMessage("Saved.");
      router.refresh();
      return;
    }
    setMessage(`Failed: ${data.reason}`);
  }

  return (
    <form onSubmit={onSubmit}>
      <FormField label="Community name">
        <input className={fieldInputClassName} required value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      {message && <FormError role="status">{message}</FormError>}
      <Button type="submit" variant="secondary" disabled={submitting}>
        Save
      </Button>
    </form>
  );
}
