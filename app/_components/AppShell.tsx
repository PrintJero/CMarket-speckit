import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentAccountPayload } from "@/lib/auth/currentAccount";
import { SignOutButton } from "./SignOutButton";
import { MenuIcon, CloseIcon } from "./icons";

/**
 * Persistent navigation shell for every authenticated screen — the sidebar
 * used to exist only inline in app/page.tsx; every other screen had no way
 * back to it. `account` is nullable only for app/operator (dev-only, gated
 * by an env flag rather than a session) so it still gets consistent chrome.
 */
export function AppShell({
  account,
  children,
}: {
  account: CurrentAccountPayload | null;
  children: ReactNode;
}) {
  const avatarInitial = account ? account.email.charAt(0).toUpperCase() : "C";

  return (
    <div className="min-h-dvh bg-bg md:flex">
      <input type="checkbox" id="sidebar-toggle" className="peer hidden" />

      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
        <Link href="/" className="text-lg font-extrabold tracking-tight text-brand">
          CMarket
        </Link>
        <label
          htmlFor="sidebar-toggle"
          className="cursor-pointer rounded-full p-2 text-ink hover:bg-bg"
        >
          <MenuIcon />
          <span className="sr-only">Open menu</span>
        </label>
      </div>

      {/* Mobile-only dimmed backdrop, closes the drawer when tapped */}
      <label
        htmlFor="sidebar-toggle"
        aria-hidden="true"
        className="fixed inset-0 z-30 hidden bg-black/30 peer-checked:block md:hidden"
      />

      <aside
        className="fixed inset-y-0 left-0 z-40 flex w-[280px] -translate-x-full flex-col overflow-y-auto
          bg-surface p-6 transition-transform duration-200 peer-checked:translate-x-0
          md:sticky md:top-0 md:z-auto md:h-dvh md:w-[260px] md:translate-x-0 md:border-r md:border-border"
      >
        <div className="flex items-center justify-between">
          <Link href="/" className="text-lg font-extrabold tracking-tight text-brand">
            CMarket
          </Link>
          <label
            htmlFor="sidebar-toggle"
            className="cursor-pointer rounded-full p-2 text-ink hover:bg-bg md:hidden"
          >
            <CloseIcon />
            <span className="sr-only">Close menu</span>
          </label>
        </div>

        {account && (
          <>
            <div className="mt-4 flex items-center gap-2.5">
              <span
                title={account.email}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-tint text-[13px] font-bold text-brand-dark"
              >
                {avatarInitial}
              </span>
              <span className="truncate text-[13px] font-semibold">{account.email}</span>
            </div>

            {account.memberships.length > 0 && (
              <nav className="mt-4 border-t border-border pt-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                  Your communities
                </span>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {account.memberships.map((membership) => (
                    <li key={membership.communityId} className="flex items-center gap-2 text-sm">
                      <Link
                        href={`/communities/${membership.communityId}/listings`}
                        className="font-semibold text-brand"
                      >
                        {membership.communityName}
                      </Link>
                      {membership.role === "ADMINISTRATOR" && (
                        <Link
                          href={`/communities/${membership.communityId}/admin`}
                          className="text-xs font-medium text-ink-muted hover:text-ink"
                        >
                          Admin
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            )}

            <div className="mt-4 flex flex-col items-start gap-2 border-t border-border pb-2 pt-4 md:mt-auto">
              <span className="max-w-full truncate text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                Signed in as {account.email}
              </span>
              <Link href="/account" className="text-sm font-semibold text-brand">
                Account
              </Link>
              <SignOutButton />
            </div>
          </>
        )}
      </aside>

      <main className="flex-1 px-5 py-8 md:px-10 md:py-12">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
