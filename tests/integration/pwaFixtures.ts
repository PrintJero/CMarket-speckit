import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { signIn, uniqueEmail } from "./helpers";

/**
 * 018-pwa-installable: one community with a seller (its founding admin), a
 * buyer, a listing WITH a photo, a message thread and a pending purchase
 * proposal. Every core surface (feed, listing, chat, transactions, account) then
 * has real content to render, so the cache-allowlist and mobile-viewport tests
 * exercise the screens a member actually uses.
 */
export interface Marketplace {
  communityId: string;
  listingId: string;
  listingTitle: string;
  threadId: string;
  transactionId: string;
  buyer: { email: string; password: string; displayName: string };
}

const PASSWORD = "correct-horse-battery-staple";

async function createVerifiedAccount(email: string, displayName: string) {
  return prisma.account.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
      displayName,
    },
  });
}

export async function seedMarketplace(page: Page, label: string): Promise<Marketplace> {
  const request: APIRequestContext = page.request;
  const sellerEmail = uniqueEmail(`pwa-${label}-seller`);
  const buyerEmail = uniqueEmail(`pwa-${label}-buyer`);
  const buyerName = `PWA Buyer ${label}`;

  const seller = await createVerifiedAccount(sellerEmail, `PWA Seller ${label}`);
  const response = await request.post("/api/operator/create-community", {
    data: {
      name: `PWA ${label} Community ${Date.now()}`,
      founderEmail: sellerEmail,
      invokedBy: "playwright-test",
    },
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`community creation failed: ${JSON.stringify(body)}`);
  const communityId = (body.community as { id: string }).id;

  const buyer = await createVerifiedAccount(buyerEmail, buyerName);
  await prisma.membership.create({
    data: { accountId: buyer.id, communityId, role: "MEMBER" },
  });

  const listingTitle = `PWA ${label} Lamp`;
  const listing = await prisma.listing.create({
    data: {
      communityId,
      ownerId: seller.id,
      title: listingTitle,
      description: "A lamp with a photo",
      priceCents: 12000,
      kind: "FOR_SALE",
      stockQuantity: 5,
    },
  });
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const photo = await prisma.listingPhoto.create({
    data: {
      listingId: listing.id,
      // 017-cloudinary-listing-media: a Cloudinary reference; delivery is
      // stubbed server-side by CLOUDINARY_TEST_STUB.
      cloudinaryAssetId: `pwa-asset-${stamp}`,
      cloudinaryPublicId: `cmarket/test/listings/pwa-${stamp}`,
      width: 1600,
      height: 1200,
      format: "jpg",
      bytes: 4,
      displayOrder: 0,
    },
  });
  await prisma.listing.update({ where: { id: listing.id }, data: { coverPhotoId: photo.id } });

  const thread = await prisma.messageThread.create({
    data: { listingId: listing.id, buyerId: buyer.id },
  });
  await prisma.message.create({
    data: { threadId: thread.id, senderId: buyer.id, body: "Is the lamp still available?" },
  });

  await signIn(page, buyerEmail, PASSWORD);
  // Make this community the session's active one up front, through the same
  // validated route the community selector uses. Otherwise AppShell syncs it
  // on the first community page (POST + router.refresh()), and that in-flight
  // refresh can collide with a test that drops the network or navigates.
  const activate = await request.post("/api/active-community", { data: { communityId } });
  if (!activate.ok()) throw new Error(`active-community failed: ${activate.status()}`);
  const proposal = await request.post(
    `/api/communities/${communityId}/listings/${listing.id}/proposals`,
    { data: { quantity: 1, totalCents: 12000 } },
  );
  const proposalBody = await proposal.json();
  if (!proposalBody.ok) throw new Error(`proposal failed: ${JSON.stringify(proposalBody)}`);

  return {
    communityId,
    listingId: listing.id,
    listingTitle,
    threadId: thread.id,
    transactionId: (proposalBody.transaction as { id: string }).id,
    buyer: { email: buyerEmail, password: PASSWORD, displayName: buyerName },
  };
}

/** The core member screens (feed, listing, chat, transactions, account). */
export function coreScreens(m: Marketplace): { name: string; path: string }[] {
  return [
    { name: "feed", path: `/communities/${m.communityId}/listings` },
    { name: "listing", path: `/communities/${m.communityId}/listings/${m.listingId}` },
    { name: "chat", path: `/communities/${m.communityId}/threads/${m.threadId}` },
    { name: "transactions", path: "/transactions" },
    { name: "account", path: "/account" },
  ];
}

/**
 * Resolves once a service worker is active for this page and the page is
 * controlled by it (a first visit is not controlled until a reload, or until
 * clients.claim() runs). Fails with a clear message instead of hanging.
 */
export async function ensureControlledByWorker(page: Page): Promise<void> {
  const active = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000));
    const registration = await Promise.race([navigator.serviceWorker.ready, timeout]);
    return Boolean(registration?.active);
  });
  expect(active, "a service worker should become active").toBe(true);
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
  }
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
}

/** Every Cache Storage name and every cached request path, read in the page. */
export async function readCacheStorage(page: Page): Promise<{ names: string[]; paths: string[] }> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const paths: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
    }
    return { names, paths };
  });
}
