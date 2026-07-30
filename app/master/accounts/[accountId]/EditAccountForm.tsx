"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MasterFormField, MasterFormMessage, masterFieldInputClassName } from "../../_components/MasterFormField";
import { MasterButton } from "../../_components/MasterButton";

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
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSubmitting(true);

    const response = await fetch(`/api/master/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, displayName }),
    });
    const data = await response.json();
    setSubmitting(false);

    if (data.ok) {
      setMessage({ tone: "success", text: "Saved." });
      router.refresh();
      return;
    }
    setMessage({ tone: "error", text: `Failed: ${data.reason}` });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md">
      <MasterFormField label="Email" required>
        <input
          className={masterFieldInputClassName}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </MasterFormField>
      <MasterFormField label="Display name">
        <input
          className={masterFieldInputClassName}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </MasterFormField>
      {message && <MasterFormMessage tone={message.tone}>{message.text}</MasterFormMessage>}
      <MasterButton type="submit" variant="secondary" disabled={submitting}>
        {submitting ? "Saving…" : "Save"}
      </MasterButton>
    </form>
  );
}
