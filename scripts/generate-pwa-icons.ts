/**
 * Renders public/icons/icon.svg into the PNG icons the PWA manifest and iOS
 * need (018-pwa-installable, research.md #2).
 *
 *   npx tsx scripts/generate-pwa-icons.ts
 *
 * Uses the Chromium that @playwright/test (an existing devDependency) already
 * installs, so no image library is added (SC-006). The PNGs are committed: the
 * build and the runtime never generate icons. Re-run only when icon.svg changes.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const ICONS_DIR = path.resolve(__dirname, "..", "public", "icons");

interface Variant {
  file: string;
  size: number;
  /** Rounded corners with a transparent outside ("any" icons). Maskable and
   *  Apple icons stay full-bleed: the OS applies its own mask. */
  rounded: boolean;
}

const VARIANTS: Variant[] = [
  { file: "icon-192.png", size: 192, rounded: true },
  { file: "icon-512.png", size: 512, rounded: true },
  { file: "icon-maskable-512.png", size: 512, rounded: false },
  { file: "apple-touch-icon.png", size: 180, rounded: false },
];

async function main(): Promise<void> {
  const svg = await readFile(path.join(ICONS_DIR, "icon.svg"), "utf8");
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  const browser = await chromium.launch();
  try {
    for (const variant of VARIANTS) {
      const page = await browser.newPage({
        viewport: { width: variant.size, height: variant.size },
        deviceScaleFactor: 1,
      });
      const radius = variant.rounded ? Math.round(variant.size * 0.22) : 0;
      await page.setContent(
        `<!doctype html><html><head><style>
          html, body { margin: 0; padding: 0; background: transparent; }
          img { display: block; width: ${variant.size}px; height: ${variant.size}px; border-radius: ${radius}px; }
        </style></head><body><img src="${svgDataUrl}" alt=""></body></html>`,
      );
      await page.locator("img").evaluate((img: HTMLImageElement) => img.decode());
      await page.screenshot({
        path: path.join(ICONS_DIR, variant.file),
        omitBackground: true,
        clip: { x: 0, y: 0, width: variant.size, height: variant.size },
      });
      await page.close();
      console.log(`wrote public/icons/${variant.file} (${variant.size}x${variant.size})`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
