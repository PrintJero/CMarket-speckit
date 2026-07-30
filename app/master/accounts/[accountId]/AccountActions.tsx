"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MasterButton } from "../../_components/MasterButton";
import { MasterConfirmDialog } from "../../_components/MasterConfirmDialog";
import { MasterTemporaryPasswordPanel } from "../../_components/MasterTemporaryPasswordPanel";
import { MasterFormField, MasterFormMessage, masterFieldSelectClassName } from "../../_components/MasterFormField";

interface EligibleMember {
  membershipId: string;
  label: string;
}

type DestructiveAction = "suspend" | "delete";

export function AccountActions({
  accountId,
  status,
  deleted,
}: {
  accountId: string;
  status: "ACTIVE" | "SUSPENDED";
  deleted: boolean;
}) {
  const router = useRouter();

  // Suspend and delete share the exact same two-step flow: attempt the
  // action; if the backend reports would_orphan_communities, reveal a
  // replacement-administrator select for each affected community inside
  // the SAME open dialog, then let the caller confirm again with
  // replacementAdministratorAssignments included.
  const [destructiveDialog, setDestructiveDialog] = useState<DestructiveAction | null>(null);
  const [affected, setAffected] = useState<{ communityId: string; communityName: string }[] | null>(null);
  const [eligibleByCommunity, setEligibleByCommunity] = useState<Record<string, EligibleMember[]>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [destructiveBusy, setDestructiveBusy] = useState(false);
  const [destructiveError, setDestructiveError] = useState<string | null>(null);

  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [reactivateBusy, setReactivateBusy] = useState(false);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  function openDestructive(action: DestructiveAction) {
    setDestructiveError(null);
    setAffected(null);
    setEligibleByCommunity({});
    setChosen({});
    setDestructiveDialog(action);
  }

  function closeDestructive() {
    setDestructiveDialog(null);
    setAffected(null);
    setEligibleByCommunity({});
    setChosen({});
    setDestructiveError(null);
  }

  async function attempt(action: DestructiveAction, assignments?: { communityId: string; membershipId: string }[]) {
    setDestructiveBusy(true);
    setDestructiveError(null);
    const response = await fetch(`/api/master/accounts/${accountId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replacementAdministratorAssignments: assignments }),
    });
    const data = await response.json();

    if (data.ok) {
      setDestructiveBusy(false);
      closeDestructive();
      router.refresh();
      return;
    }

    if (data.reason === "would_orphan_communities") {
      const communities = await Promise.all(
        (data.affectedCommunityIds as string[]).map(async (id: string) => {
          const detailResponse = await fetch(`/api/master/communities/${id}`);
          const detail = await detailResponse.json();
          setEligibleByCommunity((prev) => ({
            ...prev,
            [id]: detail.ok
              ? detail.memberships
                  .filter((m: { accountId: string; isCurrent: boolean }) => m.accountId !== accountId && m.isCurrent)
                  .map((m: { id: string; displayName: string | null; email: string }) => ({
                    membershipId: m.id,
                    label: m.displayName ?? m.email,
                  }))
              : [],
          }));
          return { communityId: id, communityName: detail.ok ? detail.community.name : id };
        }),
      );
      setAffected(communities);
      setDestructiveBusy(false);
      return;
    }

    setDestructiveBusy(false);
    setDestructiveError(`Failed: ${data.reason}`);
  }

  const destructiveAssignmentsIncomplete = affected !== null && affected.some((c) => !chosen[c.communityId]);

  function onDestructiveConfirm() {
    if (!destructiveDialog) return;
    if (affected) {
      if (destructiveAssignmentsIncomplete) return;
      const assignments = affected.map((c) => ({ communityId: c.communityId, membershipId: chosen[c.communityId] }));
      void attempt(destructiveDialog, assignments);
      return;
    }
    void attempt(destructiveDialog);
  }

  async function reactivate() {
    setReactivateBusy(true);
    setReactivateError(null);
    const response = await fetch(`/api/master/accounts/${accountId}/reactivate`, { method: "POST" });
    const data = await response.json();
    setReactivateBusy(false);
    if (!data.ok) {
      setReactivateError(`Failed: ${data.reason}`);
      router.refresh();
      return;
    }
    setReactivateOpen(false);
    router.refresh();
  }

  async function resetPassword() {
    setResetBusy(true);
    setResetError(null);
    const response = await fetch(`/api/master/accounts/${accountId}/reset-password`, { method: "POST" });
    const data = await response.json();
    setResetBusy(false);
    if (data.ok) {
      setTemporaryPassword(data.temporaryPassword);
      setResetOpen(false);
    } else {
      setResetError(`Failed: ${data.reason}`);
    }
    router.refresh();
  }

  if (deleted) {
    return <p className="text-[13px] text-ink-muted">This account has been permanently deleted.</p>;
  }

  const destructiveTitle = destructiveDialog === "delete" ? "Delete account permanently" : "Suspend account";
  const destructiveConfirmLabel = affected
    ? `Confirm ${destructiveDialog}`
    : destructiveDialog === "delete"
      ? "Delete account permanently"
      : "Suspend account";

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status === "ACTIVE" ? (
          <MasterButton variant="dangerOutline" onClick={() => openDestructive("suspend")}>
            Suspend
          </MasterButton>
        ) : (
          <MasterButton variant="secondary" onClick={() => setReactivateOpen(true)}>
            Reactivate
          </MasterButton>
        )}
        <MasterButton variant="secondary" onClick={() => setResetOpen(true)}>
          Reset password
        </MasterButton>
        <MasterButton variant="dangerOutline" onClick={() => openDestructive("delete")}>
          Delete permanently
        </MasterButton>
      </div>

      {temporaryPassword && (
        <div className="mt-4">
          <MasterTemporaryPasswordPanel password={temporaryPassword} label="New temporary password" />
        </div>
      )}

      {/* Suspend / delete — shared two-step orphan-replacement flow. */}
      <MasterConfirmDialog
        open={destructiveDialog !== null}
        title={destructiveTitle}
        description={
          affected ? (
            <>
              This account is the last active administrator of {affected.length}{" "}
              {affected.length === 1 ? "community" : "communities"}. Choose a replacement administrator for each
              before continuing — every community listed below will gain that member as its new administrator.
            </>
          ) : destructiveDialog === "delete" ? (
            "This permanently deletes the account. Its email address is released for reuse and it can never sign in again. Listings, messages, and membership history are retained for audit purposes."
          ) : (
            "This immediately revokes sign-in access for this account. It can be reactivated later."
          )
        }
        tone="danger"
        confirmLabel={destructiveConfirmLabel}
        confirmDisabled={destructiveAssignmentsIncomplete}
        busy={destructiveBusy}
        typedConfirmationPhrase={destructiveDialog === "delete" ? "DELETE" : undefined}
        onConfirm={onDestructiveConfirm}
        onClose={closeDestructive}
      >
        {affected && (
          <div className="flex flex-col gap-1">
            {affected.map((c) => (
              <MasterFormField key={c.communityId} label={c.communityName}>
                <select
                  className={masterFieldSelectClassName}
                  value={chosen[c.communityId] ?? ""}
                  onChange={(e) => setChosen((prev) => ({ ...prev, [c.communityId]: e.target.value }))}
                >
                  <option value="">Select a replacement…</option>
                  {(eligibleByCommunity[c.communityId] ?? []).map((m) => (
                    <option key={m.membershipId} value={m.membershipId}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </MasterFormField>
            ))}
          </div>
        )}
        {destructiveError && <MasterFormMessage tone="error">{destructiveError}</MasterFormMessage>}
      </MasterConfirmDialog>

      <MasterConfirmDialog
        open={reactivateOpen}
        title="Reactivate account"
        description="This restores sign-in access for this account immediately."
        tone="warning"
        confirmLabel="Reactivate account"
        busy={reactivateBusy}
        onConfirm={reactivate}
        onClose={() => setReactivateOpen(false)}
      >
        {reactivateError && <MasterFormMessage tone="error">{reactivateError}</MasterFormMessage>}
      </MasterConfirmDialog>

      <MasterConfirmDialog
        open={resetOpen}
        title="Reset password"
        description="Generates a new temporary password for this account and invalidates the current one. The account is signed out everywhere."
        tone="neutral"
        confirmLabel="Reset password"
        busy={resetBusy}
        onConfirm={resetPassword}
        onClose={() => setResetOpen(false)}
      >
        {resetError && <MasterFormMessage tone="error">{resetError}</MasterFormMessage>}
      </MasterConfirmDialog>
    </div>
  );
}
