"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MasterFormField, MasterFormMessage, masterFieldInputClassName } from "../../_components/MasterFormField";
import { MasterButton } from "../../_components/MasterButton";

export function EditCommunityForm({ communityId, initialName }: { communityId: string; initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
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
      setMessage({ kind: "success", text: "Saved." });
      router.refresh();
      return;
    }
    setMessage({ kind: "error", text: `Failed: ${data.reason}` });
  }

  return (
    <form onSubmit={onSubmit}>
      <MasterFormField label="Community name" required>
        <input
          className={masterFieldInputClassName}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </MasterFormField>
      {message && (
        <MasterFormMessage tone={message.kind === "error" ? "error" : "success"}>{message.text}</MasterFormMessage>
      )}
      <MasterButton type="submit" variant="secondary" disabled={submitting}>
        Save
      </MasterButton>
    </form>
  );
}
