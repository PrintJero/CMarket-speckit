"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentMasterPayload } from "@/lib/auth/currentMaster";
import { MenuIcon, CloseIcon } from "../../_components/icons";
import { MasterSignOutButton } from "./MasterSignOutButton";
import { MasterBadge } from "./MasterBadge";
import { MASTER_NAV_ITEMS, isMasterNavItemActive } from "./masterNavItems";

/** Compact top bar + slide-in drawer, shown only below lg (MasterSidebarNav covers desktop). */
export function MasterMobileNav({ master }: { master: CurrentMasterPayload }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // A route change always implies the drawer should close. Adjusted directly
  // during render (React's documented pattern for "state changed since last
  // render") rather than in an effect, which would cause an extra commit.
  const [renderedForPathname, setRenderedForPathname] = useState(pathname);
  if (pathname !== renderedForPathname) {
    setRenderedForPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="lg:hidden">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-ink hover:bg-bg"
        >
          <MenuIcon />
        </button>
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[#4c1d95] text-[13px] font-bold text-white">
          C
        </span>
        <span className="text-[14px] font-bold tracking-tight text-ink">CMarket</span>
        <MasterBadge />
      </header>

      {open && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Platform administration navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl"
          >
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-bold tracking-tight text-ink">CMarket</span>
                <MasterBadge />
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-bg"
              >
                <CloseIcon />
              </button>
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
                    className={`mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[14px] font-semibold ${
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
                <span
                  className="min-w-0 flex-1 truncate font-master-mono text-[12px] font-semibold text-ink"
                  title={master.masterIdValue}
                >
                  {master.masterIdValue}
                </span>
                <MasterSignOutButton />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
