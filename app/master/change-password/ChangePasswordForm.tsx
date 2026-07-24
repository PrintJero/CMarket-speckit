"use client";

import { useState, type FormEvent } from "react";
import { FormField, FormError, fieldInputClassName } from "../../_components/FormField";
import { Button } from "../../_components/Button";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage("");

    const response = await fetch("/api/master/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (response.ok) {
      window.location.href = "/master";
      return;
    }

    const data = await response.json().catch(() => null);
    setErrorMessage(
      data?.reason === "invalid_current_password"
        ? "Current password is incorrect."
        : "New password is too short or has appeared in a data breach.",
    );
    setStatus("error");
  }

  return (
    <form onSubmit={onSubmit}>
      <FormField label="Temporary / current password">
        <input
          className={fieldInputClassName}
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </FormField>
      <FormField label="New password">
        <input
          className={fieldInputClassName}
          type="password"
          required
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </FormField>
      {status === "error" && <FormError role="alert">{errorMessage}</FormError>}
      <Button type="submit" fullWidth disabled={status === "submitting"}>
        Set password
      </Button>
    </form>
  );
}
