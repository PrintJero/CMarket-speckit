import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { coreScreens, seedMarketplace, type Marketplace } from "./pwaFixtures";

/**
 * 018-pwa-installable, US3 / FR-015 / SC-005 (Constitution Principle V): every
 * core screen is fully usable at the two reference phone sizes. Runs in
 * Chromium with each device's viewport, DPR, touch and user agent: enough for
 * layout overflow (WebKit is not installed in CI, research.md #11).
 */
test.use({ serviceWorkers: "allow" });

const PHONES = ["iPhone 13", "Pixel 7"] as const;

/** The control a member came to the screen to use. */
function primaryAction(page: Page, screen: string, m: Marketplace): Locator {
  switch (screen) {
    case "feed":
      return page.getByLabel("Search", { exact: true });
    case "listing":
      return page.getByRole("button", { name: "Send purchase proposal" });
    case "chat":
      return page.getByRole("button", { name: "Send reply" });
    case "transactions":
      // The row links to the transaction more than once (e.g. title and thumbnail).
      return page
        .locator(`a[href="/communities/${m.communityId}/transactions/${m.transactionId}"]`)
        .first();
    case "account":
      return page.getByRole("button", { name: "Change name" });
    default:
      throw new Error(`no primary action defined for ${screen}`);
  }
}

for (const phone of PHONES) {
  test(`core screens have no horizontal overflow and a visible primary action on ${phone} (FR-015)`, async ({
    page,
    browser,
  }) => {
    const marketplace = await seedMarketplace(page, phone.replace(/\s+/g, "-").toLowerCase());

    const context = await browser.newContext({ ...devices[phone] });
    const phonePage = await context.newPage();
    await signIn(phonePage, marketplace.buyer.email, marketplace.buyer.password);

    for (const screen of coreScreens(marketplace)) {
      await phonePage.goto(screen.path);
      const action = primaryAction(phonePage, screen.name, marketplace);
      await action.scrollIntoViewIfNeeded();
      await expect(action, `${phone} / ${screen.name}: primary action`).toBeVisible();

      // FR-015: the page body must never scroll horizontally. 1px tolerance for
      // sub-pixel rounding, as in 017's SC-014 test.
      const { scrollWidth, innerWidth } = await phonePage.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth, `${phone} / ${screen.name}: horizontal overflow`).toBeLessThanOrEqual(
        innerWidth + 1,
      );
    }

    await context.close();
  });
}
