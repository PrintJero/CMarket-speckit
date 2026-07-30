"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertIcon } from "../../_components/icons";
import { MasterButton, type MasterButtonVariant } from "./MasterButton";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function subscribeNever() {
  return () => {};
}

/** True only once hydrated on the client — lets the portal skip rendering during SSR without a setState-in-effect. */
function useIsClient() {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

export interface MasterConfirmDialogProps {
  open: boolean;
  title: string;
  /** Plain-language consequence — what actually happens, including cross-community impact when relevant. */
  description: ReactNode;
  tone?: "danger" | "warning" | "neutral";
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: MasterButtonVariant;
  confirmDisabled?: boolean;
  busy?: boolean;
  /** For irreversible deletion: the confirm button stays disabled until this exact phrase is typed. */
  typedConfirmationPhrase?: string;
  onConfirm: () => void;
  onClose: () => void;
  /** Extra form content — a reason textarea, a replacement-administrator select, etc. */
  children?: ReactNode;
}

/**
 * The one destructive/high-impact confirmation pattern for the authenticated
 * MASTER area — real dialog semantics (not window.confirm/alert), a focus
 * trap, Escape-to-close, and focus restored to the trigger on close. Used
 * for every "are you sure" moment instead of a bespoke one per action.
 */
export function MasterConfirmDialog({
  open,
  title,
  description,
  tone = "neutral",
  confirmLabel,
  cancelLabel = "Cancel",
  confirmVariant,
  confirmDisabled = false,
  busy = false,
  typedConfirmationPhrase,
  onConfirm,
  onClose,
  children,
}: MasterConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [typedValue, setTypedValue] = useState("");
  const mounted = useIsClient();

  // Reset the typed-confirmation field when `open` flips closed. Adjusted
  // directly during render (React's documented pattern for "a prop changed
  // since last render") rather than in an effect.
  const [renderedForOpen, setRenderedForOpen] = useState(open);
  if (open !== renderedForOpen) {
    setRenderedForOpen(open);
    if (!open) setTypedValue("");
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const focusable = node?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    focusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const toneIconClassName =
    tone === "danger"
      ? "bg-danger-tint text-danger"
      : tone === "warning"
        ? "bg-warning-tint text-warning-dark"
        : "bg-master-tint text-master";

  const resolvedConfirmVariant: MasterButtonVariant = confirmVariant ?? (tone === "danger" ? "dangerOutline" : "primary");
  const typedGateBlocked = Boolean(typedConfirmationPhrase) && typedValue !== typedConfirmationPhrase;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/45" onClick={busy ? undefined : onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="master-confirm-dialog-title"
        className="relative flex w-full max-w-md flex-col rounded-xl bg-surface shadow-xl"
      >
        <div className="flex gap-3 border-b border-border px-5 py-4">
          <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${toneIconClassName}`}>
            <AlertIcon />
          </span>
          <div className="min-w-0">
            <h2 id="master-confirm-dialog-title" className="text-[15px] font-semibold text-ink">
              {title}
            </h2>
            <div className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</div>
          </div>
        </div>

        {children && <div className="px-5 py-4">{children}</div>}

        {typedConfirmationPhrase && (
          <div className="px-5 pb-1">
            <label className="mb-1.5 block text-[12.5px] font-semibold text-ink">
              Type <code className="rounded bg-bg px-1 py-0.5 font-master-mono">{typedConfirmationPhrase}</code> to
              confirm
            </label>
            <input
              value={typedValue}
              onChange={(event) => setTypedValue(event.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-master-mono text-[13px] outline-none focus:border-master focus:ring-2 focus:ring-master/25"
              autoComplete="off"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 px-5 py-4">
          <MasterButton type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </MasterButton>
          <MasterButton
            type="button"
            variant={resolvedConfirmVariant}
            onClick={onConfirm}
            disabled={confirmDisabled || busy || typedGateBlocked}
          >
            {busy ? "Working…" : confirmLabel}
          </MasterButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
