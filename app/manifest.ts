import type { MetadataRoute } from "next";

/**
 * 018-pwa-installable, FR-001/FR-002: served by Next at /manifest.webmanifest
 * and linked from every page's <head>. Public; contains no user data.
 * Colors are the design tokens --color-bg and --color-brand (app/globals.css).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CMarket",
    short_name: "CMarket",
    description: "Community marketplaces",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7f9",
    theme_color: "#7c1ff2",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
