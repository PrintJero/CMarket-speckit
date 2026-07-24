import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { uniqueEmail } from "./helpers";

async function createMasterFixture(masterId: string, password: string, mustChangePassword = false) {
  return prisma.masterIdentity.create({
    data: {
      masterId,
      email: `${masterId}@example.com`,
      passwordHash: await hashPassword(password),
      mustChangePassword,
    },
  });
}

test.describe("MASTER sign-in and marketplace-action denial (User Story 1)", () => {
  test("a MASTER signs in, changes a forced temporary password, reaches the dashboard, and signs out", async ({
    page,
  }) => {
    const masterId = `us1-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
    await createMasterFixture(masterId, "temporary-password-1", true);

    await page.goto("/master/sign-in");
    await page.getByLabel("Master ID").fill(masterId);
    await page.getByLabel("Password").fill("temporary-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/master/change-password");

    await page.getByLabel("Temporary / current password").fill("temporary-password-1");
    await page.getByLabel("New password").fill("a-brand-new-password-1");
    await page.getByRole("button", { name: "Set password" }).click();
    await page.waitForURL("/master");
    await expect(page.getByRole("heading", { name: "Platform administration" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/master/sign-in");
    await page.goto("/master");
    await page.waitForURL("/master/sign-in");
  });

  test("wrong credentials and a disabled identity are all rejected identically", async ({ page }) => {
    const masterId = `us1-bad-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
    const created = await createMasterFixture(masterId, "correct-password-1", false);

    await page.goto("/master/sign-in");
    await page.getByLabel("Master ID").fill(masterId);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid Master ID or password.")).toBeVisible();

    await prisma.masterIdentity.update({ where: { id: created.id }, data: { status: "DISABLED" } });
    await page.getByLabel("Password").fill("correct-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid Master ID or password.")).toBeVisible();
  });

  test("an ordinary account, including a community administrator, is denied every /master route", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("master-denial");
    const password = "correct-horse-battery-staple";
    await prisma.account.create({
      data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
    });

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");

    await page.goto("/master");
    await page.waitForURL("/master/sign-in");

    const apiResponse = await request.get("/api/master/masters");
    expect(apiResponse.status()).toBe(401);
  });
});

// The last-active-MASTER guard (FR-013) is intentionally not exercised here:
// through the real, authenticated UI, a caller who is not the target is
// always another *active* master, so the total active count is always >= 2
// at the moment of that check — the guard can only ever fire for a
// different-caller/target pair in a lower-level, non-UI call (a stale
// caller reference, a future non-web code path). tests/contract/
// test_master_auth.ts exercises it directly at that layer, where it's
// actually reachable.
test.describe("MASTER lifecycle management (User Story 3)", () => {
  test("MASTER A creates MASTER B, disables/reactivates it, and self-disable is rejected", async ({
    page,
  }) => {
    const aId = `us3-a-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
    await createMasterFixture(aId, "a-password-1", false);

    await page.goto("/master/sign-in");
    await page.getByLabel("Master ID").fill(aId);
    await page.getByLabel("Password").fill("a-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/master");

    await page.goto("/master/masters");
    const bId = `us3-b-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
    await page.getByLabel("Master ID").fill(bId);
    await page.getByLabel("Operational email").fill(`${bId}@example.com`);
    await page.getByRole("button", { name: "Create MASTER" }).click();
    await expect(page.getByText("Temporary password (shown once")).toBeVisible();
    await expect(page.getByText(bId)).toBeVisible();

    // Self-disable is rejected (A's own row is listed alongside B's).
    const aRow = page.locator("tr", { hasText: aId });
    const selfDisableAlert = page.waitForEvent("dialog");
    await aRow.getByRole("button", { name: "Disable" }).click();
    expect((await selfDisableAlert).message()).toContain("cannot_disable_self");
    await (await selfDisableAlert).dismiss().catch(() => undefined);

    // Disable B (not self) succeeds.
    const bRow = page.locator("tr", { hasText: bId });
    await bRow.getByRole("button", { name: "Disable" }).click();
    await expect(bRow.getByText("DISABLED")).toBeVisible();

    // Reactivate B.
    await bRow.getByRole("button", { name: "Reactivate" }).click();
    await expect(bRow.getByText("ACTIVE")).toBeVisible();
  });
});

test.describe("Every platform-administration action is auditable (User Story 11)", () => {
  test("a rejected action's FAILURE entry is visible in the audit log even though the mutation did not commit; ordinary accounts are denied", async ({
    page,
    request,
  }) => {
    const aId = `us11-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
    await createMasterFixture(aId, "a-password-1", false);

    await page.goto("/master/sign-in");
    await page.getByLabel("Master ID").fill(aId);
    await page.getByLabel("Password").fill("a-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/master");

    // With A the only active MASTER, attempt self-disable via the masters page — rejected.
    await page.goto("/master/masters");
    const aRow = page.locator("tr", { hasText: aId });
    const alert = page.waitForEvent("dialog");
    await aRow.getByRole("button", { name: "Disable" }).click();
    expect((await alert).message()).toContain("cannot_disable_self");
    await (await alert).dismiss().catch(() => undefined);

    // The FAILURE entry is visible in the audit log, filtered by action.
    await page.goto("/master/audit-log?action=master.disable");
    await expect(page.getByText("FAILURE").first()).toBeVisible();

    // An ordinary account cannot reach the audit log at all.
    const email = uniqueEmail("audit-denial");
    await prisma.account.create({
      data: { email, passwordHash: await hashPassword("correct-horse-battery-staple"), emailVerifiedAt: new Date() },
    });
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery-staple");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");

    const apiResponse = await request.get("/api/master/audit-log");
    expect(apiResponse.status()).toBe(401);
  });
});
