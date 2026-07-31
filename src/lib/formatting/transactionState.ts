import type { TransactionPaymentPath, TransactionState } from "@prisma/client";

/** User-facing label for a transaction's state — never the raw enum value. */
const STATE_LABELS: Record<TransactionState, string> = {
  PENDING: "Pending",
  ACCEPTED: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export function transactionStateLabel(state: TransactionState): string {
  return STATE_LABELS[state];
}

/**
 * Only ACCEPTED gets its own verb here ("Accepted on ...") — its state badge
 * reads "Completed", so this is the one place that word still needs to
 * appear. REJECTED/CANCELLED already show their own word as the badge
 * itself, so this caption stays neutral for them to avoid repeating it.
 */
export function transactionResolvedCaption(state: TransactionState, resolvedAt: Date | null): string | null {
  if (state === "PENDING" || !resolvedAt) return null;
  const verb = state === "ACCEPTED" ? "Accepted" : "Resolved";
  return `${verb} on ${new Date(resolvedAt).toLocaleDateString()}`;
}

/** Only OFF_PLATFORM exists today (Constitution Principle IV), but the label is kept out of the enum's own name regardless. */
export function paymentPathLabel(_path: TransactionPaymentPath): string {
  return "Off-platform payment";
}
