"use client";

import { useState, type FormEvent } from "react";
import { AuthShell } from "../../_components/AuthShell";
import { FormField, FormError, fieldInputClassName } from "../../_components/FormField";
import { Button } from "../../_components/Button";

export default function MasterSignInPage() {
  const [masterId, setMasterId] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("submitting");

    const response = await fetch("/api/master/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ masterId, password }),
    });

    if (response.ok) {
      const data = await response.json();
      window.location.href = data.mustChangePassword ? "/master/change-password" : "/master";
      return;
    }

    setStatus("error");
  }

  return (
    <AuthShell>
      <h1 className="mb-1 text-center text-[1.375rem] font-bold text-ink">Platform administration</h1>
      <p className="mb-5 text-center text-[13px] text-ink-muted">Separate from the marketplace sign-in.</p>
      <form onSubmit={onSubmit}>
        <FormField label="Master ID">
          <input
            className={fieldInputClassName}
            required
            autoComplete="username"
            value={masterId}
            onChange={(e) => setMasterId(e.target.value)}
          />
        </FormField>
        <FormField label="Password">
          <input
            className={fieldInputClassName}
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        {status === "error" && <FormError role="alert">Invalid Master ID or password.</FormError>}
        <Button type="submit" fullWidth disabled={status === "submitting"}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
