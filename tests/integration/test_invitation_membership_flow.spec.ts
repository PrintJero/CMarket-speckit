import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { assertEmailVerified } from "@/server/services/accountService";
import { getInvitationAcceptLink, getVerificationLink, signIn, uniqueEmail } from "./helpers";

async function createVerifiedAccount(email: string, password: string) {
  return prisma.account.create({
    data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
  });
}

async function createCommunityWithAdmin(request: import("@playwright/test").APIRequestContext, name: string, adminEmail: string) {
  const response = await request.post("/api/operator/create-community", {
    data: { name, founderEmail: adminEmail, invokedBy: "playwright-test" },
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`expected community creation to succeed, got ${JSON.stringify(body)}`);
  return body.community as { id: string; name: string };
}

// T009 (US1) — MVP: admin invites an already-verified account, who accepts through the real app.
test("administrator invites an already-verified account, who accepts (US1)", async ({
  page,
  browser,
  request,
}) => {
  const password = "correct-horse-battery-staple";
  const adminEmail = uniqueEmail("invite-admin");
  const inviteeEmail = uniqueEmail("invite-invitee");
  await createVerifiedAccount(adminEmail, password);
  await createVerifiedAccount(inviteeEmail, password);
  const community = await createCommunityWithAdmin(request, `Invite Flow Community ${Date.now()}`, adminEmail);

  await signIn(page, adminEmail, password);
  await page.goto(`/communities/${community.id}/admin`);
  await page.getByLabel("Invite by email").fill(inviteeEmail);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${inviteeEmail}`)).toBeVisible();

  const acceptLink = await getInvitationAcceptLink(request, inviteeEmail);

  const inviteeContext = await browser.newContext();
  const inviteePage = await inviteeContext.newPage();
  await signIn(inviteePage, inviteeEmail, password);
  await inviteePage.goto(acceptLink);
  await expect(inviteePage.getByRole("heading", { name: `Accept invitation to ${community.name}` })).toBeVisible();
  await inviteePage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(inviteePage.getByText("You're now a member of this community.")).toBeVisible();

  const invitee = await prisma.account.findUniqueOrThrow({ where: { email: inviteeEmail } });
  const membership = await prisma.membership.findUnique({
    where: { accountId_communityId: { accountId: invitee.id, communityId: community.id } },
  });
  expect(membership?.role).toBe("MEMBER");

  // SC-006: the same link is single-use — re-opening it now shows it's dead.
  await inviteePage.goto(acceptLink);
  await expect(inviteePage.getByRole("heading", { name: "Invitation no longer valid" })).toBeVisible();
  await inviteeContext.close();
});

// T015 (US2) — invite an email with no matching account; sign up + verify; return and accept.
test("administrator invites someone with no account yet, who signs up and verifies first (US2)", async ({
  page,
  browser,
  request,
}) => {
  const password = "correct-horse-battery-staple";
  const adminEmail = uniqueEmail("invite2-admin");
  const newPersonEmail = uniqueEmail("invite2-newperson");
  await createVerifiedAccount(adminEmail, password);
  const community = await createCommunityWithAdmin(request, `Invite Flow Community 2 ${Date.now()}`, adminEmail);

  await signIn(page, adminEmail, password);
  await page.goto(`/communities/${community.id}/admin`);
  await page.getByLabel("Invite by email").fill(newPersonEmail);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${newPersonEmail}`)).toBeVisible();

  const acceptLink = await getInvitationAcceptLink(request, newPersonEmail);

  // Signed-out attempt to accept: no crash, no silent no-op, no membership.
  const signedOutContext = await browser.newContext();
  const signedOutPage = await signedOutContext.newPage();
  await signedOutPage.goto(acceptLink);
  await expect(signedOutPage.getByText(newPersonEmail)).toBeVisible();
  await expect(signedOutPage.getByRole("link", { name: "Sign up" })).toBeVisible();

  // Sign up and verify with that exact email via the existing 002 flow.
  await signedOutPage.goto("/sign-up");
  await signedOutPage.getByLabel("Email").fill(newPersonEmail);
  await signedOutPage.getByLabel("Password", { exact: true }).fill(password);
  await signedOutPage.getByLabel("Confirm password").fill(password);
  await signedOutPage.getByRole("button", { name: "Create account" }).click();
  await expect(signedOutPage.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const verificationLink = await getVerificationLink(request, newPersonEmail);
  await signedOutPage.goto(verificationLink);
  await expect(signedOutPage.getByText("Your email is verified.")).toBeVisible();

  const newAccount = await prisma.account.findUniqueOrThrow({ where: { email: newPersonEmail } });
  expect(await assertEmailVerified(newAccount.id)).toBe(true);

  await signIn(signedOutPage, newPersonEmail, password);
  await signedOutPage.goto(acceptLink);
  await signedOutPage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(signedOutPage.getByText("You're now a member of this community.")).toBeVisible();
  await signedOutContext.close();

  const membership = await prisma.membership.findUnique({
    where: { accountId_communityId: { accountId: newAccount.id, communityId: community.id } },
  });
  expect(membership?.role).toBe("MEMBER");
});

// T020/T021 (US3/US5) — revoke a member through the real admin page; last-admin guard visible in the UI.
test("administrator revokes a member via the admin page; the last-admin guard rejects revoking the sole administrator (US3/US5)", async ({
  page,
  request,
}) => {
  const password = "correct-horse-battery-staple";
  const adminEmail = uniqueEmail("revoke-admin");
  const memberEmail = uniqueEmail("revoke-member");
  const admin = await createVerifiedAccount(adminEmail, password);
  const member = await createVerifiedAccount(memberEmail, password);
  const community = await createCommunityWithAdmin(request, `Revoke Flow Community ${Date.now()}`, adminEmail);
  await prisma.membership.create({
    data: { accountId: member.id, communityId: community.id, role: "MEMBER" },
  });

  await signIn(page, adminEmail, password);
  await page.goto(`/communities/${community.id}/admin`);
  await expect(page.getByText(memberEmail)).toBeVisible();

  const memberRow = page.getByRole("row", { name: new RegExp(memberEmail) });
  await memberRow.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText(memberEmail)).toHaveCount(0);

  const memberMembership = await prisma.membership.findUnique({
    where: { accountId_communityId: { accountId: member.id, communityId: community.id } },
  });
  expect(memberMembership).toBeNull();
  const memberAfter = await prisma.account.findUniqueOrThrow({ where: { id: member.id } });
  expect(memberAfter.emailVerifiedAt).toEqual(member.emailVerifiedAt);

  // Now attempt to revoke the sole remaining administrator.
  const adminRow = page.getByRole("row", { name: new RegExp(adminEmail) });
  await adminRow.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("last_admin")).toBeVisible();

  const adminMembership = await prisma.membership.findUnique({
    where: { accountId_communityId: { accountId: admin.id, communityId: community.id } },
  });
  expect(adminMembership).not.toBeNull();
});
