"use client";

import { useState } from "react";
import { FormField, FormError, fieldInputClassName } from "../_components/FormField";
import { Button } from "../_components/Button";

type CreateCommunityResponse =
  | { ok: true; community: { id: string; name: string; createdAt: string } }
  | { ok: false; reason: "invalid_name" | "account_not_found" | "account_not_verified" };

/** FR-016: dev-only panel, posts to the one allow-listed route (app/api/operator/create-community). */
export function OperatorCreateCommunityForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [operator, setOperator] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const response = await fetch("/api/operator/create-community", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, founderEmail: email, invokedBy: operator }),
    });

    if (response.status === 404) {
      setMessage("This panel is disabled.");
      return;
    }

    const data: CreateCommunityResponse = await response.json();
    if (data.ok) {
      setMessage(`Created community ${data.community.id} ("${data.community.name}").`);
      setName("");
      setEmail("");
    } else {
      setMessage(`Failed: ${data.reason}`);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <FormField label="Community name">
        <input
          className={fieldInputClassName}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <FormField label="Founding administrator email">
        <input
          className={fieldInputClassName}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </FormField>
      <FormField label="Your operator identifier">
        <input
          className={fieldInputClassName}
          value={operator}
          onChange={(event) => setOperator(event.target.value)}
        />
      </FormField>
      {message && <FormError>{message}</FormError>}
      <Button type="submit">Create community</Button>
    </form>
  );
}
