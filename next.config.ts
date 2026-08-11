import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emit a self-contained server bundle in `.next/standalone` for the Docker
   * image. Without this the runtime stage has to carry the full production
   * `node_modules` (~1 GB); with it the image is a few hundred MB.
   *
   * Note for 017-cloudinary-listing-media: that feature's task list says "do not
   * modify next.config.ts", meaning do not add an `images` block — the browser
   * never requests a Cloudinary host, so there is nothing to allowlist. This is
   * a deployment concern, not an image-delivery one, and does not reintroduce
   * next/image.
   */
  output: "standalone",

  // The dev-mode route indicator defaults to bottom-left, exactly where
  // AppShell's sidebar places the "Sign out" button on every authenticated
  // screen (and top-left collides with the sidebar's own wordmark) — bottom-
  // right is the one corner nothing in AppShell ever occupies.
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
