"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MasterButton } from "../_components/MasterButton";
import { MasterConfirmDialog } from "../_components/MasterConfirmDialog";
import { MasterTemporaryPasswordPanel } from "../_components/MasterTemporaryPasswordPanel";

type MasterAction = "disable" | "reactivate" | "reset-password";

// Friendlier phrasing for the two documented disable rejections
// (masterAuthService.disableMaster) — falls back to the raw reason for
// anything unanticipated, same information the old window.alert showed.
const DISABLE_FAILURE_MESSAGES: Record<string, string> = {
  cannot_disable_self: "You cannot disable your own MASTER identity while signed in as it.",
  last_active_master: "This is the last active MASTER operator — reactivate or create another before disabling this one.",
};

export function MasterActions({ masterId, status }: { masterId: string; status: "ACTIVE" | "DISABLED" }) {
  const router = useRouter();
  const [openAction, setOpenAction] = useState<MasterAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  function openDialog(action: MasterAction) {
    setDialogError(null);
    setOpenAction(action);
  }

  function closeDialog() {
    if (busy) return;
    setOpenAction(null);
    setDialogError(null);
  }

  async function confirm(action: MasterAction) {
    setBusy(true);
    setDialogError(null);

    const response = await fetch(`/api/master/masters/${masterId}/${action}`, { method: "POST" });
    const data = await response.json();
    setBusy(false);
    // Matches the pre-redesign handler: server data is refreshed after every
    // attempt, success or failure, not only on success.
    router.refresh();

    if (!data.ok) {
      setDialogError(action === "disable" ? (DISABLE_FAILURE_MESSAGES[data.reason] ?? `Failed: ${data.reason}`) : `Failed: ${data.reason}`);
      return;
    }

    if (action === "reset-password") {
      setTemporaryPassword(data.temporaryPassword);
    }
    setOpenAction(null);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status === "ACTIVE" ? (
          <MasterButton variant="dangerOutline" onClick={() => openDialog("disable")}>
            Disable
          </MasterButton>
        ) : (
          <MasterButton variant="secondary" onClick={() => openDialog("reactivate")}>
            Reactivate
          </MasterButton>
        )}
        <MasterButton variant="secondary" onClick={() => openDialog("reset-password")}>
          Reset password
        </MasterButton>
      </div>

      {temporaryPassword && (
        <div className="mt-3 max-w-xs">
          <MasterTemporaryPasswordPanel password={temporaryPassword} label="Temporary password" />
        </div>
      )}

      <MasterConfirmDialog
        open={openAction === "disable"}
        title="Disable this MASTER?"
        description="Every active session for this MASTER identity is invalidated immediately and it can no longer sign in. This is reversible — reactivate it at any time from this same table."
        tone="danger"
        confirmLabel="Disable this MASTER"
        busy={busy}
        onConfirm={() => confirm("disable")}
        onClose={closeDialog}
      >
        {dialogError && (
          <p role="alert" className="text-[12.5px] font-semibold text-danger">
            {dialogError}
          </p>
        )}
      </MasterConfirmDialog>

      <MasterConfirmDialog
        open={openAction === "reactivate"}
        title="Reactivate this MASTER?"
        description="This MASTER identity will immediately be able to sign in again."
        tone="neutral"
        confirmLabel="Reactivate"
        busy={busy}
        onConfirm={() => confirm("reactivate")}
        onClose={closeDialog}
      >
        {dialogError && (
          <p role="alert" className="text-[12.5px] font-semibold text-danger">
            {dialogError}
          </p>
        )}
      </MasterConfirmDialog>

      <MasterConfirmDialog
        open={openAction === "reset-password"}
        title="Reset password?"
        description="A new temporary password is generated, every existing session for this MASTER identity is invalidated, and it must change its password on next sign-in."
        tone="neutral"
        confirmLabel="Reset password"
        busy={busy}
        onConfirm={() => confirm("reset-password")}
        onClose={closeDialog}
      >
        {dialogError && (
          <p role="alert" className="text-[12.5px] font-semibold text-danger">
            {dialogError}
          </p>
        )}
      </MasterConfirmDialog>
    </div>
  );
}
