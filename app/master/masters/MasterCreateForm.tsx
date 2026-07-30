"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MasterFormField, MasterFormMessage, masterFieldInputClassName } from "../_components/MasterFormField";
import { MasterButton } from "../_components/MasterButton";
import { MasterTemporaryPasswordPanel } from "../_components/MasterTemporaryPasswordPanel";

export function MasterCreateForm() {
  const router = useRouter();
  const [masterId, setMasterId] = useState("");
  const [email, setEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/master/masters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ masterId, email }),
    });
    const data = await response.json();
    setSubmitting(false);

    if (data.ok) {
      setTemporaryPassword(data.temporaryPassword);
      setMasterId("");
      setEmail("");
      router.refresh();
      return;
    }
    setError(`Failed: ${data.reason}`);
  }

  return (
    <div>
      <form onSubmit={onSubmit}>
        <MasterFormField label="Master ID" required>
          <input
            className={masterFieldInputClassName}
            required
            value={masterId}
            onChange={(e) => setMasterId(e.target.value)}
          />
        </MasterFormField>
        <MasterFormField label="Operational email" required>
          <input
            className={masterFieldInputClassName}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </MasterFormField>
        {error && <MasterFormMessage tone="error">{error}</MasterFormMessage>}
        <MasterButton type="submit" disabled={submitting} fullWidth>
          {submitting ? "Creating…" : "Create MASTER"}
        </MasterButton>
      </form>
      {temporaryPassword && (
        <div className="mt-4">
          <MasterTemporaryPasswordPanel password={temporaryPassword} label="Temporary password" />
        </div>
      )}
    </div>
  );
}
