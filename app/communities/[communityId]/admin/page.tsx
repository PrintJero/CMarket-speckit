import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { InviteForm } from "./InviteForm";
import { MemberList } from "./MemberList";
import { AppShell } from "../../../_components/AppShell";
import { BackLink } from "../../../_components/BackLink";
import { PageHeader } from "../../../_components/PageHeader";
import { Card } from "../../../_components/Card";

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
    <AppShell account={account}>
      <BackLink href={`/communities/${communityId}`}>Back to community</BackLink>
      <PageHeader title={community.name} subtitle="Administrator panel" />

      <div className="grid items-start gap-6 md:grid-cols-[380px_1fr]">
        <Card>
          <h2 className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
            Invite a member
          </h2>
          <InviteForm communityId={communityId} />
        </Card>

        <Card className="min-w-0">
          <h2 className="mb-3 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-muted">
            Current members
          </h2>
          <MemberList communityId={communityId} initialMembers={members} />
        </Card>
      </div>
    </AppShell>
  );
}
