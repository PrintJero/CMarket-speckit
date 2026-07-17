import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-mode route indicator defaults to bottom-left, exactly where
  // AppShell's sidebar places the "Sign out" button on every authenticated
  // screen (and top-left collides with the sidebar's own wordmark) — bottom-
  // right is the one corner nothing in AppShell ever occupies.
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
