"use client";

import { useState } from "react";

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
      <label className="field">
        <span className="field__label">Community name</span>
        <input
          className="field__input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Founding administrator email</span>
        <input
          className="field__input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Your operator identifier</span>
        <input
          className="field__input"
          value={operator}
          onChange={(event) => setOperator(event.target.value)}
        />
      </label>
      {message && (
        <p className="form-error" role="status">
          {message}
        </p>
      )}
      <button className="btn-primary" type="submit">
        Create community
      </button>
    </form>
  );
}
