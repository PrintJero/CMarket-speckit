import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { archiveDueSuspendedCommunities } from "@/server/services/communityLifecycleService";
import { signIn } from "./helpers";

async function createMasterFixture(masterId: string, password: string) {
  return prisma.masterIdentity.create({
    data: { masterId, email: `${masterId}@example.com`, passwordHash: await hashPassword(password), mustChangePassword: false },
  });
}

async function signInAsMaster(page: import("@playwright/test").Page, masterId: string, password: string) {
  await page.goto("/master/sign-in");
  await page.getByLabel("Master ID").fill(masterId);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/master");
}

test.describe("Community creation, both founder modes (User Story 4)", () => {
  test("creates a community with an existing verified account as founder", async ({ page }) => {
    const masterId = `us4-a-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
    await createMasterFixture(masterId, "master-password-1");

    const founderEmail = `us4-founder-${process.pid}-${Math.floor(Math.random() * 1e9)}@example.com`;
    await prisma.account.create({
      data: { email: founderEmail, passwordHash: "irrelevant", emailVerifiedAt: new Date() },
    });

    await signInAsMaster(page, masterId, "master-password-1");
    await page.goto("/master/communities/new");

    const communityName = `US4 Existing Community ${Math.floor(Math.random() * 1e9)}`;
    await page.getByLabel("Community name").fill(communityName);
    await page.getByLabel("Email").fill(founderEmail);
    await page.getByRole("button", { name: "Create community" }).click();

    await page.waitForURL(/\/master\/communities\/.+/);
    await expect(page.getByText(communityName)).toBeVisible();
    await expect(page.getByText(founderEmail)).toBeVisible();
  });

  test("provisions a new account as founder when none exists", async ({ page }) => {
    const masterId = `us4-b-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
    await createMasterFixture(masterId, "master-password-1");

    await signInAsMaster(page, masterId, "master-password-1");
    await page.goto("/master/communities/new");

    const communityName = `US4 Provisioned Community ${Math.floor(Math.random() * 1e9)}`;
    const founderEmail = `us4-provisioned-${process.pid}-${Math.floor(Math.random() * 1e9)}@example.com`;
    await page.getByLabel("Community name").fill(communityName);
    await page.getByLabel("Founding administrator").selectOption("provision");
    await page.getByLabel("Email").fill(founderEmail);
    await page.getByLabel("Display name").fill("Provisioned Founder");
    await page.getByRole("button", { name: "Create community" }).click();

    await page.waitForURL(/\/master\/communities\/.+/);
    await expect(page.getByText(communityName)).toBeVisible();

    const account = await prisma.account.findUnique({ where: { email: founderEmail } });
    expect(account?.emailVerifiedAt).not.toBeNull();

    // The MASTER never becomes a member of any community it creates.
    const masterAccountMembership = await prisma.membership.findFirst({ where: { accountId: masterId } });
    expect(masterAccountMembership).toBeNull();
  });
});

test.describe("Community management from outside (User Story 5)", () => {
  test("edits a community, promotes a member, and removing the last administrator without a replacement is rejected", async ({
    page,
  }) => {
    const masterId = `us5-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
    await createMasterFixture(masterId, "master-password-1");

    const founderEmail = `us5-founder-${process.pid}-${Math.floor(Math.random() * 1e9)}@example.com`;
    const founder = await prisma.account.create({
      data: { email: founderEmail, passwordHash: "irrelevant", emailVerifiedAt: new Date() },
    });
    const memberEmail = `us5-member-${process.pid}-${Math.floor(Math.random() * 1e9)}@example.com`;
    const member = await prisma.account.create({
      data: { email: memberEmail, passwordHash: "irrelevant", emailVerifiedAt: new Date(), displayName: "US5 Member" },
    });

    const community = await prisma.community.create({
      data: { name: `US5 Community ${Math.floor(Math.random() * 1e9)}`, createdByOperator: "test" },
    });
    await prisma.membership.create({
      data: { accountId: founder.id, communityId: community.id, role: "ADMINISTRATOR", operationalEpoch: 1 },
    });
    await prisma.membership.create({
      data: { accountId: member.id, communityId: community.id, role: "MEMBER", operationalEpoch: 1 },
    });

    await signInAsMaster(page, masterId, "master-password-1");
    await page.goto(`/master/communities/${community.id}`);

    // Edit.
    const newName = `${community.name} Renamed`;
    await page.getByLabel("Community name").fill(newName);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    // Promote the member.
    const memberRow = page.locator("tr", { hasText: "US5 Member" });
    await memberRow.getByRole("button", { name: "Promote" }).click();
    await expect(memberRow.getByText("ADMINISTRATOR")).toBeVisible();

    // Remove one administrator (revoke) — succeeds since two now exist.
    const founderRow = page.locator("tr", { hasText: founderEmail });
    await founderRow.getByRole("button", { name: "Remove…" }).click();
    await founderRow.getByRole("button", { name: "Revoke membership" }).click();
    await expect(founderRow).toHaveCount(0);

    // Attempting to remove the sole remaining administrator without a replacement is rejected.
    const remainingAdminRow = page.locator("tr", { hasText: "US5 Member" });
    await remainingAdminRow.getByRole("button", { name: "Remove…" }).click();
    const alert = page.waitForEvent("dialog");
    await remainingAdminRow.getByRole("button", { name: "Revoke membership" }).click();
    expect((await alert).message()).toContain("would_orphan_community");
    await (await alert).dismiss().catch(() => undefined);
    await expect(remainingAdminRow).toBeVisible();
  });
});

test.describe("Community suspension (User Story 8)", () => {
  test("suspending blocks new-listing creation while an existing listing remains viewable, and reactivation restores normal function", async ({
    page,
    browser,
  }) => {
    const masterId = `us8-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
    await createMasterFixture(masterId, "master-password-1");

    const founderEmail = `us8-founder-${process.pid}-${Math.floor(Math.random() * 1e9)}@example.com`;
    const founderPassword = "founder-password-1";
    const founder = await prisma.account.create({
      data: {
        email: founderEmail,
        passwordHash: await hashPassword(founderPassword),
        emailVerifiedAt: new Date(),
        displayName: "US8 Founder",
      },
    });
    const community = await prisma.community.create({
      data: { name: `US8 Community ${Math.floor(Math.random() * 1e9)}`, createdByOperator: "test" },
    });
    await prisma.membership.create({
      data: { accountId: founder.id, communityId: community.id, role: "ADMINISTRATOR", operationalEpoch: 1 },
    });
    const listing = await prisma.listing.create({
      data: {
        communityId: community.id,
        ownerId: founder.id,
        title: "Pre-suspension listing",
        description: "d",
        priceCents: 100,
      },
    });

    await signInAsMaster(page, masterId, "master-password-1");
    await page.goto(`/master/communities/${community.id}`);
    await page.getByLabel("Suspension reason").fill("Payment overdue");
    await page.getByRole("button", { name: "Suspend" }).click();
    await expect(page.getByText("Status: SUSPENDED")).toBeVisible();

    // The founder, in a separate browser context, still sees the pre-existing listing.
    const founderContext = await browser.newContext();
    const founderPage = await founderContext.newPage();
    await signIn(founderPage, founderEmail, founderPassword);
    await founderPage.goto(`/communities/${community.id}/listings/${listing.id}`);
    await expect(founderPage.getByText("Pre-suspension listing")).toBeVisible();

    // But creating a new listing is blocked.
    const createResponse = await founderPage.request.post(`/api/communities/${community.id}/listings`, {
      data: { title: "New listing while suspended", description: "d", priceCents: 100 },
    });
    expect(createResponse.status()).toBe(403);
    await founderContext.close();

    await page.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByText("Status: ACTIVE")).toBeVisible();
  });
});

test.describe("Automatic archival (User Story 9)", () => {
  test("a suspended community past its deadline archives automatically; a former member is denied while a MASTER still sees full history", async ({
    page,
    browser,
  }) => {
    const masterId = `us9-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
    await createMasterFixture(masterId, "master-password-1");

    const memberEmail = `us9-member-${process.pid}-${Math.floor(Math.random() * 1e9)}@example.com`;
    const memberPassword = "member-password-1";
    const founder = await prisma.account.create({
      data: {
        email: memberEmail,
        passwordHash: await hashPassword(memberPassword),
        emailVerifiedAt: new Date(),
        displayName: "US9 Founder",
      },
    });
    const community = await prisma.community.create({
      data: {
        name: `US9 Community ${Math.floor(Math.random() * 1e9)}`,
        createdByOperator: "test",
        status: "SUSPENDED",
        suspendedAt: new Date(),
        suspensionReason: "Payment overdue",
        archiveScheduledAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.membership.create({
      data: { accountId: founder.id, communityId: community.id, role: "ADMINISTRATOR", operationalEpoch: 1 },
    });

    await archiveDueSuspendedCommunities();

    // Former member denied ordinary marketplace access.
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, memberEmail, memberPassword);
    const listingsResponse = await memberPage.request.get(`/api/communities/${community.id}/listings`);
    expect(listingsResponse.status()).toBe(403);
    await memberContext.close();

    // MASTER still sees full history.
    await signInAsMaster(page, masterId, "master-password-1");
    await page.goto(`/master/communities/${community.id}`);
    await expect(page.getByText("Status: ARCHIVED")).toBeVisible();
    await expect(page.getByRole("cell", { name: "US9 Founder" })).toBeVisible();

    // Re-running the archival process is a harmless no-op.
    const secondRun = await archiveDueSuspendedCommunities();
    expect(secondRun.archivedCommunityIds).not.toContain(community.id);
  });
});

test.describe("Restoring an archived community (User Story 10)", () => {
  test("restores exactly one selected administrator; every other former member/listing/thread remains invisible, and normal operation resumes", async ({
    page,
    browser,
  }) => {
    const masterId = `us10-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
    await createMasterFixture(masterId, "master-password-1");

    const adminEmail = `us10-admin-${process.pid}-${Math.floor(Math.random() * 1e9)}@example.com`;
    const adminPassword = "admin-password-1";
    const admin = await prisma.account.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword(adminPassword),
        emailVerifiedAt: new Date(),
        displayName: "US10 Admin",
      },
    });
    const otherMemberEmail = `us10-member-${process.pid}-${Math.floor(Math.random() * 1e9)}@example.com`;
    const otherMember = await prisma.account.create({
      data: { email: otherMemberEmail, passwordHash: await hashPassword("member-password-1"), emailVerifiedAt: new Date(), displayName: "US10 Member" },
    });

    const community = await prisma.community.create({
      data: {
        name: `US10 Community ${Math.floor(Math.random() * 1e9)}`,
        createdByOperator: "test",
        status: "SUSPENDED",
        suspendedAt: new Date(),
        suspensionReason: "Payment overdue",
        archiveScheduledAt: new Date(Date.now() - 1000),
      },
    });
    const adminMembership = await prisma.membership.create({
      data: { accountId: admin.id, communityId: community.id, role: "ADMINISTRATOR", operationalEpoch: 1 },
    });
    await prisma.membership.create({
      data: { accountId: otherMember.id, communityId: community.id, role: "MEMBER", operationalEpoch: 1 },
    });

    await archiveDueSuspendedCommunities();

    await signInAsMaster(page, masterId, "master-password-1");
    await page.goto(`/master/communities/${community.id}`);
    await expect(page.getByText("Status: ARCHIVED")).toBeVisible();

    await page.getByLabel("Restore with administrator").selectOption({ label: "US10 Admin" });
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Status: ACTIVE")).toBeVisible();

    // The restored administrator regains ordinary marketplace access.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await signIn(adminPage, adminEmail, adminPassword);
    const adminListResponse = await adminPage.request.get(`/api/communities/${community.id}/listings`);
    expect(adminListResponse.status()).toBe(200);
    await adminContext.close();

    // The other former member does NOT automatically regain access.
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await signIn(otherPage, otherMemberEmail, "member-password-1");
    const otherListResponse = await otherPage.request.get(`/api/communities/${community.id}/listings`);
    expect(otherListResponse.status()).toBe(403);
    await otherContext.close();

    // Restoring an already-ACTIVE community is rejected.
    const reRestoreResponse = await page.request.post(`/api/master/communities/${community.id}/restore`, {
      data: { administratorMembershipId: adminMembership.id },
    });
    expect(reRestoreResponse.status()).toBe(409);
  });
});
