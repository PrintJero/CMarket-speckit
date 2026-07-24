import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentMasterPayload } from "@/lib/auth/currentMaster";
import { MasterSignOutButton } from "./MasterSignOutButton";

/**
 * Deliberately NOT a variant of AppShell — a MASTER is not an Account and
 * must never share chrome/state with the marketplace shell (Constitution
 * Principle IX). Simple top-bar + nav, no community/membership concepts.
 */
export function MasterShell({
  master,
  children,
}: {
  master: CurrentMasterPayload;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
        <div className="flex items-center gap-6">
          <Link href="/master" className="text-lg font-extrabold tracking-tight text-brand">
            CMarket — Platform Administration
          </Link>
          <nav className="hidden gap-4 text-sm font-semibold md:flex">
            <Link href="/master/communities" className="text-ink hover:text-brand">
              Communities
            </Link>
            <Link href="/master/accounts" className="text-ink hover:text-brand">
              Accounts
            </Link>
            <Link href="/master/masters" className="text-ink hover:text-brand">
              Masters
            </Link>
            <Link href="/master/audit-log" className="text-ink hover:text-brand">
              Audit log
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-ink-muted">{master.masterIdValue}</span>
          <MasterSignOutButton />
        </div>
      </header>
      <main className="px-6 py-10">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
