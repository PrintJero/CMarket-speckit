"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MasterFormField,
  MasterFormMessage,
  masterFieldTextareaClassName,
  masterFieldSelectClassName,
} from "../../_components/MasterFormField";
import { MasterButton } from "../../_components/MasterButton";
import { MasterConfirmDialog } from "../../_components/MasterConfirmDialog";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  // Preserves the current contract exactly: POST to the same endpoint with
  // the same body, and router.refresh() unconditionally afterward (both on
  // success and failure), matching the pre-redesign behavior.
  async function post(path: string, body?: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    const response = await fetch(`/api/master/communities/${communityId}${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    setBusy(false);
    setError(data.ok ? null : `Failed: ${data.reason}`);
    router.refresh();
    return data.ok;
  }

  async function onConfirmSuspend() {
    const ok = await post("/suspend", { reason });
    setSuspendOpen(false);
    if (ok) setReason("");
  }

  async function onConfirmReactivate() {
    await post("/reactivate");
    setReactivateOpen(false);
  }

  async function onConfirmRestore() {
    await post("/restore", { administratorMembershipId: restoreTarget });
    setRestoreOpen(false);
  }

  if (status === "ACTIVE") {
    return (
      <div>
        <MasterFormField label="Suspension reason" required>
          <textarea
            className={masterFieldTextareaClassName}
            rows={3}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </MasterFormField>
        {error && <MasterFormMessage tone="error">{error}</MasterFormMessage>}
        <MasterButton
          type="button"
          variant="dangerOutline"
          disabled={busy || !reason.trim()}
          onClick={() => setSuspendOpen(true)}
        >
          Suspend
        </MasterButton>

        <MasterConfirmDialog
          open={suspendOpen}
          title="Suspend this community?"
          description="Every member immediately loses marketplace access. If it is not reactivated, this community is automatically archived after 30 days."
          tone="danger"
          confirmLabel="Suspend community"
          busy={busy}
          onConfirm={onConfirmSuspend}
          onClose={() => setSuspendOpen(false)}
        />
      </div>
    );
  }

  if (status === "SUSPENDED") {
    return (
      <div>
        {error && <MasterFormMessage tone="error">{error}</MasterFormMessage>}
        <MasterButton type="button" variant="secondary" disabled={busy} onClick={() => setReactivateOpen(true)}>
          Reactivate
        </MasterButton>

        <MasterConfirmDialog
          open={reactivateOpen}
          title="Reactivate this community?"
          description="Marketplace access is restored immediately for every current member, and the scheduled automatic archival is cancelled."
          tone="warning"
          confirmLabel="Reactivate community"
          busy={busy}
          onConfirm={onConfirmReactivate}
          onClose={() => setReactivateOpen(false)}
        />
      </div>
    );
  }

  // ARCHIVED
  const selectedLabel = eligibleAdministrators.find((a) => a.membershipId === restoreTarget)?.label;
  return (
    <div>
      <MasterFormField label="Restore with administrator">
        <select
          className={masterFieldSelectClassName}
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
      </MasterFormField>
      {error && <MasterFormMessage tone="error">{error}</MasterFormMessage>}
      <MasterButton
        type="button"
        variant="secondary"
        disabled={busy || !restoreTarget}
        onClick={() => setRestoreOpen(true)}
      >
        Restore
      </MasterButton>

      <MasterConfirmDialog
        open={restoreOpen}
        title="Restore this community?"
        description={
          <>
            Exactly one administrator{selectedLabel ? ` — ${selectedLabel}` : ""} becomes active again. Every other
            membership stays archived. Previous listings, chats, and invitations remain historical records. This does
            not recreate a new community.
          </>
        }
        tone="warning"
        confirmLabel="Restore community"
        confirmDisabled={!restoreTarget}
        busy={busy}
        onConfirm={onConfirmRestore}
        onClose={() => setRestoreOpen(false)}
      />
    </div>
  );
}
