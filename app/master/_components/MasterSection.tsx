import type { ComponentProps, ReactNode } from "react";

/**
 * The one card/panel surface for the authenticated MASTER area — white,
 * 1px border, restrained 12px radius, no elevation. Deliberately not the
 * marketplace's Card (16px radius + visible shadow-card): MASTER reads as a
 * denser, flatter administrative surface.
 */
export function MasterSection({
  title,
  description,
  actions,
  className = "",
  children,
  ...props
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
} & ComponentProps<"section">) {
  return (
    <section className={`rounded-xl border border-border bg-surface ${className}`} {...props}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
          <div>
            {title && <h2 className="text-[14px] font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-[12.5px] text-ink-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
