"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormField, FormError, fieldInputClassName } from "../../_components/FormField";
import { Button } from "../../_components/Button";

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
        <FormField label="Master ID">
          <input
            className={fieldInputClassName}
            required
            value={masterId}
            onChange={(e) => setMasterId(e.target.value)}
          />
        </FormField>
        <FormField label="Operational email">
          <input
            className={fieldInputClassName}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        {error && <FormError role="alert">{error}</FormError>}
        <Button type="submit" disabled={submitting}>
          Create MASTER
        </Button>
      </form>
      {temporaryPassword && (
        <p className="mt-3 rounded-card bg-brand-tint p-3 text-[13px] font-semibold text-brand-dark" role="status">
          Temporary password (shown once, copy it now): <code>{temporaryPassword}</code>
        </p>
      )}
    </div>
  );
}
