import type { ReactNode } from "react";

/**
 * The one table container for the authenticated MASTER area — white
 * surface, 1px border, restrained radius, horizontal scroll on overflow
 * rather than ever clipping content. Pages compose a normal semantic
 * `<table>` inside it using the shared cell classNames below, so table
 * semantics (thead/tbody/th scope) stay exactly what screen readers and
 * keyboard users expect.
 */
export function MasterTable({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-xl border border-border bg-surface ${className}`}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export const masterThClassName =
  "whitespace-nowrap border-b border-border bg-bg px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted";

export const masterTdClassName = "border-b border-border px-4 py-3 align-middle text-ink";

/** Applied to each `<tr>` in `<tbody>` for a consistent hover affordance. */
export const masterTrClassName = "transition-colors hover:bg-bg focus-within:bg-bg";
