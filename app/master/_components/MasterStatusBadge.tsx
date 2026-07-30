export type MasterStatusKey =
  | "ACTIVE"
  | "SUSPENDED"
  | "ARCHIVED"
  | "DISABLED"
  | "DELETED"
  | "HISTORICAL"
  | "SUCCESS"
  | "FAILURE"
  | "SYSTEM"
  | "ADMINISTRATOR"
  | "MEMBER";

// Each className is a complete literal string (never assembled by
// interpolating a variable inside it) so Tailwind's build-time content
// scanner can find every one of them.
const STATUS: Record<MasterStatusKey, { label: string; wrapClassName: string; dotClassName: string }> = {
  ACTIVE: {
    label: "Active",
    wrapClassName: "border-success-border bg-success-tint text-success-dark",
    dotClassName: "bg-success",
  },
  SUSPENDED: {
    label: "Suspended",
    wrapClassName: "border-warning-border bg-warning-tint text-warning-dark",
    dotClassName: "bg-warning",
  },
  ARCHIVED: {
    label: "Archived",
    wrapClassName: "border-border bg-bg text-ink-muted",
    dotClassName: "bg-ink-muted",
  },
  DISABLED: {
    label: "Disabled",
    wrapClassName: "border-danger/25 bg-danger-tint text-danger",
    dotClassName: "bg-danger",
  },
  DELETED: {
    label: "Deleted",
    wrapClassName: "border-border bg-bg text-ink-muted",
    dotClassName: "bg-ink-muted",
  },
  HISTORICAL: {
    label: "Historical",
    wrapClassName: "border-border bg-bg text-ink-muted",
    dotClassName: "bg-ink-muted",
  },
  SUCCESS: {
    label: "Success",
    wrapClassName: "border-success-border bg-success-tint text-success-dark",
    dotClassName: "bg-success",
  },
  FAILURE: {
    label: "Failure",
    wrapClassName: "border-danger/25 bg-danger-tint text-danger",
    dotClassName: "bg-danger",
  },
  SYSTEM: {
    label: "System",
    wrapClassName: "border-master-border bg-master-tint text-master-dark",
    dotClassName: "bg-master",
  },
  ADMINISTRATOR: {
    label: "Administrator",
    wrapClassName: "border-master-border bg-master-tint text-master-dark",
    dotClassName: "bg-master",
  },
  MEMBER: {
    label: "Member",
    wrapClassName: "border-border bg-bg text-ink-muted",
    dotClassName: "bg-ink-muted",
  },
};

/**
 * One status badge for the whole authenticated MASTER area — never rely on
 * color alone: every instance pairs a dot with a text label, and the label
 * itself (not just an icon) always renders.
 */
export function MasterStatusBadge({ status, className = "" }: { status: MasterStatusKey; className?: string }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${s.wrapClassName} ${className}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 flex-none rounded-full ${s.dotClassName}`} />
      {s.label}
    </span>
  );
}
