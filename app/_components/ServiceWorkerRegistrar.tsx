"use client";

import { useEffect } from "react";

/**
 * 018-pwa-installable, FR-012: registers public/sw.js in production builds
 * only. NODE_ENV is inlined at build time, so `next dev` never registers a
 * worker and developers never debug against stale assets.
 *
 * A failed registration is not an error for the member: CMarket keeps working
 * as a plain website (spec edge case), so it is logged, never rethrown.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
      console.warn("[pwa] service worker registration failed", error);
    });
  }, []);

  return null;
}
