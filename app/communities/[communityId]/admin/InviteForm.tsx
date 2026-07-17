"use client";

import { useState } from "react";
import { FormField, FormError, fieldInputClassName } from "../../../_components/FormField";
import { Button } from "../../../_components/Button";

type InviteResponse =
  | { ok: true; invitation: { id: string; email: string } }
  | { ok: false; reason: "invalid_email" | "not_administrator" | "already_member" };

export function InviteForm({ communityId }: { communityId: string }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const response = await fetch(`/api/communities/${communityId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const data: InviteResponse = await response.json();
    if (data.ok) {
      setMessage(`Invitation sent to ${data.invitation.email}.`);
      setEmail("");
    } else {
      setMessage(`Failed: ${data.reason}`);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <FormField label="Invite by email">
        <input
          className={fieldInputClassName}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </FormField>
      {message && <FormError>{message}</FormError>}
      <Button type="submit">Send invitation</Button>
    </form>
  );
}
