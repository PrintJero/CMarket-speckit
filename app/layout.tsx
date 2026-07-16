import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const brandFont = Manrope({
  subsets: ["latin"],
  variable: "--font-brand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CMarket",
  description: "CMarket — community marketplaces",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={brandFont.variable}>
      <body>{children}</body>
    </html>
  );
}
