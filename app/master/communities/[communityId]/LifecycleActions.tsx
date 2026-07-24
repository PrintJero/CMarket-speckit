"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormField, fieldInputClassName } from "../../../_components/FormField";
import { Button } from "../../../_components/Button";

type CommunityStatus = "ACTIVE" | "SUSPENDED" | "ARCHIVED";

export function LifecycleActions({
  communityId,
  status,
  eligibleAdministrators,
}: {
  communityId: string;
  status: CommunityStatus;
  eligibleAdministrators: { membershipId: string; label: string }[];
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [restoreTarget, setRestoreTarget] = useState(eligibleAdministrators[0]?.membershipId ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function post(path: string, body?: Record<string, unknown>) {
    setSubmitting(true);
    const response = await fetch(`/api/master/communities/${communityId}${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    setSubmitting(false);
    if (!data.ok) {
      window.alert(`Failed: ${data.reason}`);
    }
    router.refresh();
  }

  async function onSuspend(event: FormEvent) {
    event.preventDefault();
    await post("/suspend", { reason });
    setReason("");
  }

  if (status === "ACTIVE") {
    return (
      <form onSubmit={onSuspend} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <FormField label="Suspension reason">
            <input
              className={fieldInputClassName}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
        </div>
        <Button type="submit" variant="dangerOutline" disabled={submitting}>
          Suspend
        </Button>
      </form>
    );
  }

  if (status === "SUSPENDED") {
    return (
      <Button variant="secondary" disabled={submitting} onClick={() => post("/reactivate")}>
        Reactivate
      </Button>
    );
  }

  // ARCHIVED
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[240px]">
        <FormField label="Restore with administrator">
          <select
            className={fieldInputClassName}
            value={restoreTarget}
            onChange={(e) => setRestoreTarget(e.target.value)}
          >
            {eligibleAdministrators.length === 0 && <option value="">No eligible administrator</option>}
            {eligibleAdministrators.map((a) => (
              <option key={a.membershipId} value={a.membershipId}>
                {a.label}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <Button
        variant="secondary"
        disabled={submitting || !restoreTarget}
        onClick={() => post("/restore", { administratorMembershipId: restoreTarget })}
      >
        Restore
      </Button>
    </div>
  );
}
