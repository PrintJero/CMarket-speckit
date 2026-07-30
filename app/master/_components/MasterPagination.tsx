import Link from "next/link";

/**
 * Forward-only "Load more" control for cursor-paginated lists (currently
 * only the audit log, the one MASTER list whose service actually returns a
 * cursor). No backward page-jump is offered — cursor pagination has no
 * stable "page N" to jump to; the browser's own back button already
 * returns to the prior cursor's URL.
 */
export function MasterPagination({ hasMore, nextHref }: { hasMore: boolean; nextHref?: string }) {
  if (!hasMore || !nextHref) return null;

  return (
    <div className="flex items-center justify-center border-t border-border px-4 py-3">
      <Link
        href={nextHref}
        className="rounded-lg border border-border bg-surface px-3.5 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-bg"
      >
        Load more
      </Link>
    </div>
  );
}
