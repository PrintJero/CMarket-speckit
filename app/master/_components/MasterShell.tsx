import type { ReactNode } from "react";
import type { CurrentMasterPayload } from "@/lib/auth/currentMaster";
import { MasterSidebarNav } from "./MasterSidebarNav";
import { MasterMobileNav } from "./MasterMobileNav";

/**
 * Deliberately NOT a variant of AppShell — a MASTER is not an Account and
 * must never share chrome/state with the marketplace shell (Constitution
 * Principle IX). Persistent left sidebar on desktop; a compact top bar +
 * drawer below lg. font-master-sans (IBM Plex Sans) is set once here so
 * every authenticated MASTER page inherits it — the marketplace's own
 * --font-sans (Manrope) is untouched outside this subtree.
 */
export function MasterShell({
  master,
  children,
}: {
  master: CurrentMasterPayload;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-bg font-master-sans text-ink">
      <MasterSidebarNav master={master} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MasterMobileNav master={master} />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-9">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
