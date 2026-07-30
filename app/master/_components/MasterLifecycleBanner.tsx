import type { ReactNode } from "react";
import { AlertIcon, ArchiveIcon } from "../../_components/icons";

/**
 * The community lifecycle banner — amber for suspended (prominent but not
 * overwhelming), neutral gray for archived (clearly non-operational).
 * Rendered at the top of the community detail page regardless of which
 * tab is active, since lifecycle state is page-level context.
 */
export function MasterLifecycleBanner({
  tone,
  title,
  children,
  action,
}: {
  tone: "warning" | "neutral";
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const toneClassName =
    tone === "warning" ? "border-warning-border bg-warning-tint text-warning-dark" : "border-border bg-bg text-ink-muted";
  const Icon = tone === "warning" ? AlertIcon : ArchiveIcon;

  return (
    <div className={`mb-5 rounded-xl border p-4 ${toneClassName}`}>
      <div className="flex gap-3">
        <Icon className="mt-0.5 flex-none" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">{title}</p>
          <div className="mt-1.5 text-[13px] leading-relaxed">{children}</div>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}
