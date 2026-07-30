"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { CurrentAccountPayload } from "@/lib/auth/currentAccount";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { SignOutButton } from "./SignOutButton";
import { MenuIcon, CloseIcon } from "./icons";

function isNavPathActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function navLinkClassName(active: boolean): string {
  return `mb-0.5 flex items-center rounded-lg px-2.5 py-2 text-[13.5px] font-semibold transition-colors ${
    active ? "bg-brand-tint text-brand-dark" : "text-ink hover:bg-bg"
  }`;
}

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
  const pathname = usePathname();
  const displayName = account ? resolveDisplayName(account.displayName) : "";
  const avatarInitial = displayName.charAt(0).toUpperCase();

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
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-[#4c1d95] text-base font-bold text-white">
              C
            </span>
            <span className="text-[15px] font-bold tracking-tight text-ink">CMarket</span>
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
            <div className="mt-5 flex items-center gap-2.5">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-tint text-[15px] font-bold text-brand-dark">
                {avatarInitial}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink"
                title={displayName}
              >
                {displayName}
              </span>
            </div>

            <nav className="mt-4 border-t border-border pt-4" aria-label="Main">
              <Link href="/chats" className={navLinkClassName(isNavPathActive(pathname, "/chats"))}>
                Chats
              </Link>
              <Link
                href="/my-listings"
                className={navLinkClassName(isNavPathActive(pathname, "/my-listings"))}
              >
                My listings
              </Link>

              {account.memberships.length > 0 && (
                <div className="mt-4 border-t border-border pt-4">
                  <span className="block px-2.5 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                    Your communities
                  </span>
                  <ul className="mt-2 flex flex-col gap-0.5">
                    {account.memberships.map((membership) => {
                      const active = isNavPathActive(pathname, `/communities/${membership.communityId}`);
                      return (
                        <li key={membership.communityId}>
                          <div
                            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13.5px] font-semibold transition-colors ${
                              active ? "bg-brand-tint text-brand-dark" : "text-ink hover:bg-bg"
                            }`}
                          >
                            <Link
                              href={`/communities/${membership.communityId}/listings`}
                              className="min-w-0 flex-1 truncate"
                            >
                              {membership.communityName}
                            </Link>
                            {membership.role === "ADMINISTRATOR" && (
                              <Link
                                href={`/communities/${membership.communityId}/admin`}
                                className="flex-none text-[11px] font-medium text-ink-muted hover:text-ink"
                              >
                                Admin
                              </Link>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="mt-4 border-t border-border pt-4">
                <Link href="/account" className={navLinkClassName(isNavPathActive(pathname, "/account"))}>
                  Account
                </Link>
              </div>
            </nav>

            <div className="mt-4 border-t border-border pb-2 pt-4 md:mt-auto">
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
