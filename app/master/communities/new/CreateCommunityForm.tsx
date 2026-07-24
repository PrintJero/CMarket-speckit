"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormField, FormError, fieldInputClassName } from "../../../_components/FormField";
import { Button } from "../../../_components/Button";

export function CreateCommunityForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"existing" | "provision">("existing");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const response = await fetch("/api/master/communities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        administrator:
          mode === "existing" ? { mode, email } : { mode, email, displayName },
      }),
    });
    const data = await response.json();
    setSubmitting(false);

    if (data.ok) {
      const passwordNote = data.temporaryPassword
        ? ` Temporary password (shown once): ${data.temporaryPassword}`
        : "";
      setMessage({ kind: "success", text: `Created "${data.community.name}".${passwordNote}` });
      setName("");
      setEmail("");
      setDisplayName("");
      router.push(`/master/communities/${data.community.id}`);
      return;
    }
    setMessage({ kind: "error", text: `Failed: ${data.reason}` });
  }

  return (
    <form onSubmit={onSubmit}>
      <FormField label="Community name">
        <input className={fieldInputClassName} required value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>

      <FormField label="Founding administrator">
        <select
          className={fieldInputClassName}
          value={mode}
          onChange={(e) => setMode(e.target.value as "existing" | "provision")}
        >
          <option value="existing">Existing verified account</option>
          <option value="provision">Provision a new account</option>
        </select>
      </FormField>

      <FormField label="Email">
        <input
          className={fieldInputClassName}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </FormField>

      {mode === "provision" && (
        <FormField label="Display name">
          <input
            className={fieldInputClassName}
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </FormField>
      )}

      {message && (
        <FormError role={message.kind === "error" ? "alert" : "status"}>{message.text}</FormError>
      )}
      <Button type="submit" disabled={submitting}>
        Create community
      </Button>
    </form>
  );
}
