"use client";

/**
 * 015-navigation-shell-community-selector, FR-006/FR-007. Search input + a
 * two-way For sale/Wanted segmented control, GET-form submission (no client
 * fetch, no client-side filtering — the server component re-reads the query
 * string), matching the existing ListingDiscoveryControls.tsx's own pattern.
 *
 * The deep-link "become active" sync used to live here, but now lives in
 * AppShell.tsx instead (2026-07-31 amendment) — AppShell wraps every
 * community-scoped page, not just this one, so centralizing it there keeps
 * the sidebar's shown active community honest no matter which page a member
 * actually lands on (see AppShell.tsx's own comment and research.md #4a).
 */
export function MainViewControls({
  communityId,
  initialQuery,
  initialKind,
}: {
  communityId: string;
  initialQuery: string;
  initialKind: "FOR_SALE" | "WANTED";
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-4">
      <form method="GET" action={`/communities/${communityId}`} className="min-w-[220px] flex-1">
        <input type="hidden" name="kind" value={initialKind} />
        <input
          className="w-full rounded-pill border border-border bg-surface px-4 py-2.5 text-sm text-ink placeholder:text-ink-muted"
          type="text"
          name="q"
          defaultValue={initialQuery}
          placeholder="Search this community"
        />
      </form>

      <div className="inline-flex rounded-pill border border-border bg-surface p-1">
        {(["FOR_SALE", "WANTED"] as const).map((kind) => (
          <form key={kind} method="GET" action={`/communities/${communityId}`}>
            <input type="hidden" name="q" value={initialQuery} />
            <button
              type="submit"
              name="kind"
              value={kind}
              className={`rounded-pill px-4 py-1.5 text-[13px] font-bold transition-colors ${
                initialKind === kind ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
              }`}
            >
              {kind === "FOR_SALE" ? "For sale" : "Wanted"}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
