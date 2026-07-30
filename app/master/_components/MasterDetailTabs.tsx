"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export interface MasterTab {
  key: string;
  label: string;
}

/**
 * Underline tab navigation driven by a `?tab=` query param rather than
 * client-only state, so every tab is a real, shareable/bookmarkable,
 * refresh-safe URL. The detail page (a server component) reads the same
 * `searchParams.tab` to decide what to render — see e.g.
 * app/master/communities/[communityId]/page.tsx.
 */
export function MasterDetailTabs({ tabs, paramName = "tab" }: { tabs: MasterTab[]; paramName?: string }) {
  return (
    <Suspense fallback={<div className="mb-5 h-10 border-b border-border" />}>
      <MasterDetailTabsInner tabs={tabs} paramName={paramName} />
    </Suspense>
  );
}

function MasterDetailTabsInner({ tabs, paramName }: { tabs: MasterTab[]; paramName: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get(paramName) ?? tabs[0]?.key;

  return (
    <div className="mb-5 flex gap-5 overflow-x-auto border-b border-border" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        const params = new URLSearchParams(searchParams.toString());
        if (tab.key === tabs[0]?.key) {
          params.delete(paramName);
        } else {
          params.set(paramName, tab.key);
        }
        const query = params.toString();
        return (
          <Link
            key={tab.key}
            href={query ? `${pathname}?${query}` : pathname}
            role="tab"
            aria-selected={isActive}
            className={`whitespace-nowrap border-b-2 px-0.5 py-2.5 text-[13px] font-semibold transition-colors ${
              isActive ? "border-master text-master-dark" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
