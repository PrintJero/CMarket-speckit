"use client";

import { useState } from "react";
import { CopyIcon, CheckIcon } from "../../_components/icons";

/**
 * The one place a temporary password is ever displayed — MASTER creation,
 * MASTER reset, community founding-admin provisioning, account reset.
 * Monospace, copyable, explicit "shown once" warning. The password only
 * ever lives in the caller's own transient state (cleared/unmounted after
 * navigation) — this panel never persists or re-fetches it, and it is
 * never written to the audit log.
 */
export function MasterTemporaryPasswordPanel({
  password,
  label = "Temporary password",
}: {
  password: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (permissions, insecure context) —
      // the password stays visible and selectable either way.
    }
  }

  return (
    <div className="rounded-xl border border-warning-border bg-warning-tint p-4">
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-warning-dark">{label} — shown once</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg border border-warning-border bg-surface px-3 py-2 font-master-mono text-[14px] font-semibold text-ink">
          {password}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex flex-none items-center gap-1.5 rounded-lg border border-warning-border bg-surface px-3 py-2 text-[12.5px] font-semibold text-ink transition-colors hover:bg-bg"
        >
          {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-warning-dark">
        Copy this now — it cannot be recovered or shown again once you leave this screen.
      </p>
    </div>
  );
}
