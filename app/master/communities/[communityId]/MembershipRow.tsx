"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MasterButton } from "../../_components/MasterButton";
import { MasterConfirmDialog } from "../../_components/MasterConfirmDialog";
import { MasterStatusBadge } from "../../_components/MasterStatusBadge";
import { MasterFormMessage } from "../../_components/MasterFormField";
import { masterTdClassName, masterTrClassName } from "../../_components/MasterTable";

interface Membership {
  id: string;
  accountId: string;
  displayName: string | null;
  email: string;
  role: "ADMINISTRATOR" | "MEMBER";
  isCurrent: boolean;
}

type Disposition = "demote" | "revoke_membership" | "disable_account" | "delete_account";

export function MembershipRow({ communityId, membership }: { communityId: string; membership: Membership }) {
  const router = useRouter();
  const [showRemove, setShowRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState<Disposition | null>(null);

  async function promote() {
    setBusy(true);
    setError(null);
    const response = await fetch(
      `/api/master/communities/${communityId}/memberships/${membership.id}/promote`,
      { method: "POST" },
    );
    const data = await response.json();
    setBusy(false);
    if (!data.ok) setError(`Failed: ${data.reason}`);
    router.refresh();
  }

  async function remove(disposition: Disposition) {
    setBusy(true);
    const response = await fetch(`/api/master/communities/${communityId}/memberships/${membership.id}/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disposition }),
    });
    const data = await response.json();
    setBusy(false);
    setOpenDialog(null);
    if (!data.ok) {
      setError(`Failed: ${data.reason}`);
    } else {
      setError(null);
      setShowRemove(false);
    }
    router.refresh();
  }

  const name = membership.displayName ?? membership.email;

  return (
    <tr className={masterTrClassName}>
      <td className={masterTdClassName}>{name}</td>
      <td className={masterTdClassName}>
        <MasterStatusBadge status={membership.role} />
      </td>
      <td className={masterTdClassName}>
        {membership.isCurrent ? (
          <span className="text-ink-muted">Current</span>
        ) : (
          <MasterStatusBadge status="HISTORICAL" />
        )}
      </td>
      <td className={masterTdClassName}>
        {membership.isCurrent && (
          <div className="flex flex-col gap-2">
            {error && <MasterFormMessage tone="error">{error}</MasterFormMessage>}
            <div className="flex flex-wrap gap-2">
              {membership.role === "MEMBER" && (
                <MasterButton variant="secondary" disabled={busy} onClick={promote}>
                  Promote
                </MasterButton>
              )}
              {!showRemove ? (
                <MasterButton variant="dangerOutline" disabled={busy} onClick={() => setShowRemove(true)}>
                  Remove…
                </MasterButton>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <MasterButton variant="secondary" disabled={busy} onClick={() => setOpenDialog("demote")}>
                    Demote
                  </MasterButton>
                  <MasterButton variant="secondary" disabled={busy} onClick={() => setOpenDialog("revoke_membership")}>
                    Revoke membership
                  </MasterButton>
                  <MasterButton variant="dangerOutline" disabled={busy} onClick={() => setOpenDialog("disable_account")}>
                    Disable account
                  </MasterButton>
                  <MasterButton variant="dangerOutline" disabled={busy} onClick={() => setOpenDialog("delete_account")}>
                    Delete account
                  </MasterButton>
                </div>
              )}
            </div>
          </div>
        )}

        <MasterConfirmDialog
          open={openDialog === "demote"}
          title="Demote this administrator?"
          description={`${name} becomes a regular member and loses administrator privileges in this community. Their membership itself is not removed.`}
          tone="warning"
          confirmLabel="Demote"
          busy={busy}
          onConfirm={() => remove("demote")}
          onClose={() => setOpenDialog(null)}
        />
        <MasterConfirmDialog
          open={openDialog === "revoke_membership"}
          title="Revoke this membership?"
          description={`${name} is removed from this community entirely. Their account itself is untouched and keeps access to every other community.`}
          tone="warning"
          confirmLabel="Revoke membership"
          busy={busy}
          onConfirm={() => remove("revoke_membership")}
          onClose={() => setOpenDialog(null)}
        />
        <MasterConfirmDialog
          open={openDialog === "disable_account"}
          title="Disable this account?"
          description={`${name}'s account is suspended platform-wide — marketplace access is revoked in every community, not only this one, until a MASTER reactivates it.`}
          tone="danger"
          confirmLabel="Disable account"
          busy={busy}
          onConfirm={() => remove("disable_account")}
          onClose={() => setOpenDialog(null)}
        />
        <MasterConfirmDialog
          open={openDialog === "delete_account"}
          title="Delete this account?"
          description={`${name}'s account is permanently deactivated platform-wide. This cannot be undone: sign-in is disabled and the email address is freed for reuse, though historical listings, messages, and this membership record are retained.`}
          tone="danger"
          confirmLabel="Delete account"
          typedConfirmationPhrase="DELETE"
          busy={busy}
          onConfirm={() => remove("delete_account")}
          onClose={() => setOpenDialog(null)}
        />
      </td>
    </tr>
  );
}
