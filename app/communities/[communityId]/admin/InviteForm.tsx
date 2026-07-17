"use client";

import { useState } from "react";

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
      <label className="field">
        <span className="field__label">Invite by email</span>
        <input
          className="field__input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {message && (
        <p className="form-error" role="status">
          {message}
        </p>
      )}
      <button className="btn-primary" type="submit">
        Send invitation
      </button>
    </form>
  );
}
