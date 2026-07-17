"use client";

import { useState } from "react";
import { Button } from "../../_components/Button";
import { FormError } from "../../_components/FormField";

type AcceptResponse =
  | { ok: true; membership: { communityId: string; role: "MEMBER" } }
  | { ok: false; reason: "invalid_or_consumed" | "email_mismatch" | "not_verified" | "already_member" };

export function AcceptButton({ token }: { token: string }) {
  const [result, setResult] = useState<AcceptResponse | null>(null);

  async function onAccept() {
    const response = await fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data: AcceptResponse = await response.json();
    setResult(data);
  }

  if (result?.ok) {
    return <p className="text-center">You&apos;re now a member of this community.</p>;
  }

  return (
    <>
      <Button type="button" fullWidth onClick={onAccept}>
        Accept invitation
      </Button>
      {result && !result.ok && (
        <FormError>
          {result.reason === "email_mismatch"
            ? "This invitation was sent to a different email than your account's."
            : result.reason === "not_verified"
              ? "Verify your email before accepting this invitation."
              : result.reason === "already_member"
                ? "You already belong to this community."
                : "This invitation is no longer valid."}
        </FormError>
      )}
    </>
  );
}
