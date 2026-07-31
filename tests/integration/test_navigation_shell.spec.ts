import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { uniqueEmail, signIn } from "./helpers";

async function createVerifiedAccount(email: string, password: string) {
  return prisma.account.create({
    data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
  });
}

async function createCommunityWithAdmin(
  request: import("@playwright/test").APIRequestContext,
  name: string,
  adminEmail: string,
  password: string,
) {
  await createVerifiedAccount(adminEmail, password);
  const response = await request.post("/api/operator/create-community", {
    data: { name, founderEmail: adminEmail, invokedBy: "playwright-test" },
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`expected community creation to succeed, got ${JSON.stringify(body)}`);
  return body.community as { id: string; name: string };
}

async function addMember(communityId: string, email: string, password: string) {
  const account = await createVerifiedAccount(email, password);
  await prisma.membership.create({ data: { accountId: account.id, communityId, role: "MEMBER" } });
  return account;
}

async function seedListing(
  communityId: string,
  ownerId: string,
  spec: { title: string; description: string; priceCents: number; kind?: "FOR_SALE" | "WANTED" },
) {
  return prisma.listing.create({ data: { communityId, ownerId, ...spec } });
}

/**
 * 015-navigation-shell-community-selector, T013 (US3 / FR-009–FR-011 / SC-003)
 * — the one guarantee this feature requires automated coverage for regardless
 * of the general test-optionality default (spec.md's Testing note).
 */
test("the selection screen lists exactly the member's own current communities, and selecting one lands on its main view", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const memberEmail = uniqueEmail("navshell-selector-member");
  const communityA = await createCommunityWithAdmin(
    page.request,
    `Nav Shell Selector A ${Date.now()}`,
    uniqueEmail("navshell-selector-admin-a"),
    password,
  );
  const communityB = await createCommunityWithAdmin(
    page.request,
    `Nav Shell Selector B ${Date.now()}`,
    uniqueEmail("navshell-selector-admin-b"),
    password,
  );
  const memberAccount = await createVerifiedAccount(memberEmail, password);
  await prisma.membership.createMany({
    data: [
      { accountId: memberAccount.id, communityId: communityA.id, role: "MEMBER" },
      { accountId: memberAccount.id, communityId: communityB.id, role: "MEMBER" },
    ],
  });
  await seedListing(communityA.id, memberAccount.id, {
    title: "A-only bicycle",
    description: "generic",
    priceCents: 1000,
  });

  await signIn(page, memberEmail, password);

  await expect(page.getByText(communityA.name)).toBeVisible();
  await expect(page.getByText(communityB.name)).toBeVisible();

  await page.getByRole("button", { name: communityA.name }).click();
  await page.waitForURL(`/communities/${communityA.id}`);
  await expect(page.getByText("A-only bicycle")).toBeVisible();
});

test("a member with exactly one community still sees the selector once, with no other community to leak from (FR-005)", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const memberEmail = uniqueEmail("navshell-single-member");
  const community = await createCommunityWithAdmin(
    page.request,
    `Nav Shell Single ${Date.now()}`,
    uniqueEmail("navshell-single-admin"),
    password,
  );
  const memberAccount = await createVerifiedAccount(memberEmail, password);
  await prisma.membership.create({
    data: { accountId: memberAccount.id, communityId: community.id, role: "MEMBER" },
  });

  await signIn(page, memberEmail, password);
  await expect(page.getByRole("button", { name: community.name })).toBeVisible();

  await page.getByRole("button", { name: community.name }).click();
  await page.waitForURL(`/communities/${community.id}`);
});

test("the active community's feed, search, and toggle never leak another community's data, and reset with zero carryover after switching (Principle II)", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const memberEmail = uniqueEmail("navshell-isolation-member");
  const communityA = await createCommunityWithAdmin(
    page.request,
    `Nav Shell Isolation A ${Date.now()}`,
    uniqueEmail("navshell-isolation-admin-a"),
    password,
  );
  const communityB = await createCommunityWithAdmin(
    page.request,
    `Nav Shell Isolation B ${Date.now()}`,
    uniqueEmail("navshell-isolation-admin-b"),
    password,
  );
  const memberAccount = await createVerifiedAccount(memberEmail, password);
  await prisma.membership.createMany({
    data: [
      { accountId: memberAccount.id, communityId: communityA.id, role: "MEMBER" },
      { accountId: memberAccount.id, communityId: communityB.id, role: "MEMBER" },
    ],
  });
  await seedListing(communityA.id, memberAccount.id, {
    title: "Community A exclusive item",
    description: "generic",
    priceCents: 1000,
  });
  await seedListing(communityA.id, memberAccount.id, {
    title: "Community A wanted item",
    description: "generic",
    priceCents: 0,
    kind: "WANTED",
  });
  await seedListing(communityB.id, memberAccount.id, {
    title: "Community B exclusive item",
    description: "generic",
    priceCents: 2000,
  });

  await signIn(page, memberEmail, password);
  await page.goto(`/communities/${communityA.id}`);

  // Feed: only A's listing, never B's.
  await expect(page.getByText("Community A exclusive item")).toBeVisible();
  await expect(page.getByText("Community B exclusive item")).toHaveCount(0);

  // Search: still scoped to A, and to whichever kind is toggled.
  await page.getByPlaceholder("Search this community").fill("exclusive");
  await page.keyboard.press("Enter");
  await page.waitForURL(/q=exclusive/);
  await expect(page.getByText("Community A exclusive item")).toBeVisible();
  await expect(page.getByText("Community B exclusive item")).toHaveCount(0);

  // Toggle: Wanted shows only A's wanted post.
  await page.goto(`/communities/${communityA.id}`);
  await page.getByRole("button", { name: "Wanted" }).click();
  await page.waitForURL(/kind=WANTED/);
  await expect(page.getByText("Community A wanted item")).toBeVisible();
  await expect(page.getByText("Community A exclusive item")).toHaveCount(0);
  await expect(page.getByText("Community B exclusive item")).toHaveCount(0);

  // Switch to B via the sidebar: search term/results reset, and B's own data — never A's — appears.
  await page.getByRole("button", { name: communityA.name }).click();
  await page.getByRole("button", { name: communityB.name }).click();
  await page.waitForURL(`/communities/${communityB.id}`);
  await expect(page.getByText("Community B exclusive item")).toBeVisible();
  await expect(page.getByText("Community A exclusive item")).toHaveCount(0);
  await expect(page.getByText("Community A wanted item")).toHaveCount(0);
  await expect(page.getByPlaceholder("Search this community")).toHaveValue("");
});

test("the remembered active community survives a return visit to the top-level entry point (FR-001a)", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const memberEmail = uniqueEmail("navshell-remember-member");
  const community = await createCommunityWithAdmin(
    page.request,
    `Nav Shell Remember ${Date.now()}`,
    uniqueEmail("navshell-remember-admin"),
    password,
  );
  const memberAccount = await createVerifiedAccount(memberEmail, password);
  await prisma.membership.create({
    data: { accountId: memberAccount.id, communityId: community.id, role: "MEMBER" },
  });

  await signIn(page, memberEmail, password);
  await page.getByRole("button", { name: community.name }).click();
  await page.waitForURL(`/communities/${community.id}`);

  await page.goto("/");
  await page.waitForURL(`/communities/${community.id}`);
});

/**
 * Regression test: a direct deep-link navigation into a different community's
 * page (not via the selector/switcher) must still resynchronize the active
 * community — AppShell.tsx's own deep-link effect (research.md #4a) is the
 * one place this is enforced regardless of how the page was reached. Covers
 * both directions (A -> B and back to A) and the Admin sidebar entry updating
 * with the account's per-community role.
 */
test("a direct deep-link navigation into a different community resyncs Session.activeCommunityId and the sidebar, in both directions", async ({
  page,
}) => {
  const password = "correct-horse-battery-staple";
  const memberEmail = uniqueEmail("navshell-deeplink-member");
  const communityA = await createCommunityWithAdmin(
    page.request,
    `Nav Shell Deeplink A ${Date.now()}`,
    uniqueEmail("navshell-deeplink-admin-a"),
    password,
  );
  const communityB = await createCommunityWithAdmin(
    page.request,
    `Nav Shell Deeplink B ${Date.now()}`,
    uniqueEmail("navshell-deeplink-admin-b"),
    password,
  );
  const memberAccount = await createVerifiedAccount(memberEmail, password);
  // MEMBER in A, ADMINISTRATOR in B — so the sidebar's Admin entry must appear
  // only while B is active, and disappear again once A becomes active.
  await prisma.membership.createMany({
    data: [
      { accountId: memberAccount.id, communityId: communityA.id, role: "MEMBER" },
      { accountId: memberAccount.id, communityId: communityB.id, role: "ADMINISTRATOR" },
    ],
  });
  await seedListing(communityA.id, memberAccount.id, {
    title: "Deeplink A exclusive item",
    description: "generic",
    priceCents: 1000,
  });
  await seedListing(communityB.id, memberAccount.id, {
    title: "Deeplink B exclusive item",
    description: "generic",
    priceCents: 2000,
  });

  await signIn(page, memberEmail, password);

  // Given: navigate directly into A first (no prior active community at all).
  await page.goto(`/communities/${communityA.id}/listings`);
  await expect(page.getByText("Deeplink A exclusive item")).toBeVisible();
  await expect(page.getByRole("button", { name: /Switch community, currently/ })).toContainText(communityA.name);
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  let session = await prisma.session.findFirstOrThrow({ where: { accountId: memberAccount.id } });
  expect(session.activeCommunityId).toBe(communityA.id);

  // When: navigate directly to a route inside B (a deep link, not the switcher).
  await page.goto(`/communities/${communityB.id}/listings`);

  // Then: B's content is shown, Session.activeCommunityId becomes B, the sidebar displays B,
  // and the Admin entry appears since the account is ADMINISTRATOR only in B.
  await expect(page.getByText("Deeplink B exclusive item")).toBeVisible();
  await expect(page.getByText("Deeplink A exclusive item")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Switch community, currently/ })).toContainText(communityB.name);
  await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
  session = await prisma.session.findFirstOrThrow({ where: { accountId: memberAccount.id } });
  expect(session.activeCommunityId).toBe(communityB.id);

  // Then, in reverse: navigating back to A resyncs everything back.
  await page.goto(`/communities/${communityA.id}/listings`);
  await expect(page.getByText("Deeplink A exclusive item")).toBeVisible();
  await expect(page.getByText("Deeplink B exclusive item")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Switch community, currently/ })).toContainText(communityA.name);
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  session = await prisma.session.findFirstOrThrow({ where: { accountId: memberAccount.id } });
  expect(session.activeCommunityId).toBe(communityA.id);
});
