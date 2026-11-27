import type { Metadata, Viewport } from "next";
import { Manrope, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { ServiceWorkerRegistrar } from "./_components/ServiceWorkerRegistrar";
import "./globals.css";

const brandFont = Manrope({
  subsets: ["latin"],
  variable: "--font-brand",
  display: "swap",
});

/**
 * MASTER (platform administration) typography only — exposed as their own
 * CSS vars and consumed exclusively by --font-master-sans/--font-master-mono
 * in globals.css, so the marketplace's own --font-sans (Manrope) is
 * untouched. Loaded here, alongside brandFont, because next/font/google
 * loaders must run at module scope in a Server Component.
 */
const masterSansFont = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

const masterMonoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CMarket",
  description: "CMarket — community marketplaces",
  // 018-pwa-installable, FR-003: iOS "Add to Home Screen" title, standalone
  // mode and icon. The web app manifest itself comes from app/manifest.ts.
  appleWebApp: { capable: true, title: "CMarket", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

// FR-003: since Next 15, themeColor belongs to the viewport export, not metadata.
export const viewport: Viewport = {
  themeColor: "#7c1ff2",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${brandFont.variable} ${masterSansFont.variable} ${masterMonoFont.variable}`}
    >
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
