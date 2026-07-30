"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  MasterFormField,
  MasterFormMessage,
  masterFieldInputClassName,
  masterFieldSelectClassName,
} from "../../_components/MasterFormField";
import { MasterButton, MasterLinkButton } from "../../_components/MasterButton";
import { MasterTemporaryPasswordPanel } from "../../_components/MasterTemporaryPasswordPanel";

export function CreateCommunityForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"existing" | "provision">("existing");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string; temporaryPassword?: string } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/master/communities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        administrator: mode === "existing" ? { mode, email } : { mode, email, displayName },
      }),
    });
    const data = await response.json();
    setSubmitting(false);

    if (data.ok) {
      if (data.temporaryPassword) {
        // Provisioned a brand-new account: surface the one-time password
        // inline instead of redirecting immediately — an immediate
        // router.push here would unmount this component before the password
        // could ever be read or copied, defeating the point of showing it.
        setCreated({ id: data.community.id, name: data.community.name, temporaryPassword: data.temporaryPassword });
        return;
      }
      // Existing-account mode: nothing to reveal, so the original
      // immediate-redirect behavior is preserved exactly.
      router.push(`/master/communities/${data.community.id}`);
      return;
    }
    setError(`Failed: ${data.reason}`);
  }

  if (created) {
    return (
      <div>
        <MasterFormMessage tone="success">{`Created "${created.name}".`}</MasterFormMessage>
        {created.temporaryPassword && (
          <div className="mb-4">
            <MasterTemporaryPasswordPanel
              password={created.temporaryPassword}
              label="Founding administrator's temporary password"
            />
          </div>
        )}
        <MasterLinkButton href={`/master/communities/${created.id}`}>Continue to community</MasterLinkButton>
      </div>
    );
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

      <MasterFormField label="Founding administrator">
        <select
          className={masterFieldSelectClassName}
          value={mode}
          onChange={(e) => setMode(e.target.value as "existing" | "provision")}
        >
          <option value="existing">Existing verified account</option>
          <option value="provision">Provision a new account</option>
        </select>
      </MasterFormField>

      <MasterFormField label="Email" required>
        <input
          className={masterFieldInputClassName}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </MasterFormField>

      {mode === "provision" && (
        <MasterFormField label="Display name" required>
          <input
            className={masterFieldInputClassName}
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </MasterFormField>
      )}

      {error && <MasterFormMessage tone="error">{error}</MasterFormMessage>}
      <MasterButton type="submit" disabled={submitting}>
        Create community
      </MasterButton>
    </form>
  );
}
