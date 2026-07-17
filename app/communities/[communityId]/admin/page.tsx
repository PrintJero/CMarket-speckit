import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { InviteForm } from "./InviteForm";
import { MemberList } from "./MemberList";

/**
 * Administrator-only, same notFound() convention as app/operator/page.tsx.
 * Renders 404 for any signed-in account without an ADMINISTRATOR membership
 * in this community (constitution Principle VI: moderation duties carve-out
 * for viewing this community's own member emails — plan.md's Constitution Check).
 */
export default async function CommunityAdminPage({
  params,
}: {
  params: Promise<{ communityId: string }>;
}) {
  const { communityId } = await params;
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const callerMembership = await prisma.membership.findUnique({
    where: { accountId_communityId: { accountId: account.accountId, communityId } },
  });
  if (callerMembership?.role !== "ADMINISTRATOR") {
    notFound();
  }

  const community = await prisma.community.findUnique({ where: { id: communityId } });
  if (!community) {
    notFound();
  }

  const memberships = await prisma.membership.findMany({
    where: { communityId },
    include: { account: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });

  const members = memberships.map((membership) => ({
    membershipId: membership.id,
    email: membership.account.email,
    role: membership.role,
  }));

  return (
    <div className="operator-shell">
      <div className="operator-container">
        <div className="operator-header">
          <h1>{community.name}</h1>
          <p className="operator-notice">Administrator panel</p>
        </div>

        <div className="operator-layout">
          <section className="operator-panel-card">
            <h2 className="micro-label">Invite a member</h2>
            <InviteForm communityId={communityId} />
          </section>

          <section className="operator-communities">
            <h2 className="micro-label">Current members</h2>
            <MemberList communityId={communityId} initialMembers={members} />
          </section>
        </div>
      </div>
    </div>
  );
}
