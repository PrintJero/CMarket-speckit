"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 015-navigation-shell-community-selector, FR-006/FR-007. Search input + a
 * two-way For sale/Wanted segmented control, GET-form submission (no client
 * fetch, no client-side filtering — the server component re-reads the query
 * string), matching the existing ListingDiscoveryControls.tsx's own pattern.
 *
 * Also owns the deep-link "become active" sync: a post-hydration effect only,
 * never a write during the page's server render — see contracts/
 * navigation-shell-api.md's `GET /communities/{communityId}` section and
 * research.md #4a for why (Next.js Link prefetching / crawler GETs must never
 * silently reassign a member's active community).
 */
export function MainViewControls({
  communityId,
  activeCommunityId,
  initialQuery,
  initialKind,
}: {
  communityId: string;
  activeCommunityId: string | null;
  initialQuery: string;
  initialKind: "FOR_SALE" | "WANTED";
}) {
  const router = useRouter();

  useEffect(() => {
    if (activeCommunityId === communityId) return;
    let cancelled = false;
    fetch("/api/active-community", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ communityId }),
    }).then(() => {
      // This page already rendered this community's own data (listListings()
      // already passed its own requireCommunityMembership() gate) — the
      // refresh exists only so AppShell's sidebar (which reads the account's
      // activeCommunityId from the same server render) stops showing the
      // now-stale previous value instead of this one.
      if (!cancelled) router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [communityId, activeCommunityId, router]);

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
