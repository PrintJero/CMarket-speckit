import type { Metadata } from "next";

/**
 * 018-pwa-installable, FR-014: the page the service worker serves when a
 * navigation fails for lack of network.
 *
 * - force-static: rendered once at build time, never per request, so it can
 *   never carry account or community data. The worker also precaches it with
 *   credentials omitted (public/sw.js).
 * - No AppShell: the root layout is bare; the authenticated shell is per page.
 * - "Try again" is a plain link to the current URL: the worker answers the
 *   ORIGINAL navigation with this HTML, so the address bar still holds the page
 *   the member asked for, and a reload retries exactly that. It works with no
 *   JavaScript, so missing route chunks cannot break it.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Offline · CMarket",
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-5 py-12">
      <div className="w-full max-w-sm text-center">
        <p className="mb-6 text-[1.25rem] font-extrabold tracking-tight text-brand">CMarket</p>
        <h1 className="mb-2 text-[1.375rem] font-bold text-ink">You&apos;re offline</h1>
        <p className="mb-6 text-[14px] leading-relaxed text-ink-muted">
          CMarket needs a connection to show your communities.
        </p>
        <a
          href=""
          className="inline-flex items-center justify-center rounded-pill bg-brand px-5 py-3 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Try again
        </a>
      </div>
    </main>
  );
}
