"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentMasterPayload } from "@/lib/auth/currentMaster";
import { MasterSignOutButton } from "./MasterSignOutButton";
import { MasterBadge } from "./MasterBadge";
import { MASTER_NAV_ITEMS, isMasterNavItemActive } from "./masterNavItems";

/** Persistent desktop sidebar — hidden below lg, where MasterMobileNav takes over. */
export function MasterSidebarNav({ master }: { master: CurrentMasterPayload }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-61 flex-none flex-col border-r border-border bg-surface lg:flex">
      <div className="flex items-center gap-2.5 px-[18px] pb-4 pt-5">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-[#4c1d95] text-base font-bold text-white">
          C
        </span>
        <span className="text-[15px] font-bold tracking-tight text-ink">CMarket</span>
        <MasterBadge />
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 py-2" aria-label="Platform administration">
        {MASTER_NAV_ITEMS.map((item) => {
          const active = isMasterNavItemActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-semibold transition-colors ${
                active ? "bg-master-tint text-master-dark" : "text-ink hover:bg-bg"
              }`}
            >
              <Icon className={active ? "text-master" : "text-ink-muted"} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-bg px-2.5 py-2">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-master-tint font-master-mono text-[12px] font-semibold text-master-dark">
            {master.masterIdValue.slice(-2).toUpperCase()}
          </span>
          <span
            className="min-w-0 flex-1 truncate font-master-mono text-[12px] font-semibold text-ink"
            title={master.masterIdValue}
          >
            {master.masterIdValue}
          </span>
          <MasterSignOutButton />
        </div>
      </div>
    </aside>
  );
}
