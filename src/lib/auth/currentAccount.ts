import { cookies } from "next/headers";
import { getValidSession } from "@/server/services/sessionService";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessionCookie";
import { prisma } from "@/lib/prisma";
import { requireCommunityMembership } from "@/server/services/listingService";
import type { MembershipRole } from "@prisma/client";

export interface MembershipSummary {
  communityId: string;
  communityName: string;
  role: MembershipRole;
}

export interface CurrentAccountPayload {
  accountId: string;
  email: string;
  verified: boolean;
  displayName: string | null;
  memberships: MembershipSummary[];
  activeCommunityId: string | null;
}

interface SessionAccount {
  accountId: string;
  email: string;
  emailVerifiedAt: Date | null;
  displayName?: string | null;
}

/**
 * The session-payload-construction function stays pure and defaults
 * memberships to [] when omitted, so every pre-004 call site (002/003's own
 * tests) is unaffected — only getCurrentAccount() supplies real data.
 * displayName (006-user-display-names) is optional on the input for the same
 * reason, defaulting to null. activeCommunityId (015-navigation-shell-
 * community-selector) is likewise optional/default-null, and is expected to
 * already be live-verified (resolveLiveActiveCommunityId()) by the caller —
 * this function stays synchronous and does no verification itself.
 */
export function toCurrentAccountPayload(
  session: SessionAccount,
  memberships: MembershipSummary[] = [],
  activeCommunityId: string | null = null,
): CurrentAccountPayload {
  return {
    accountId: session.accountId,
    email: session.email,
    verified: Boolean(session.emailVerifiedAt),
    displayName: session.displayName ?? null,
    memberships,
    activeCommunityId,
  };
}

/**
 * 015-navigation-shell-community-selector, FR-001b, research.md #3: never
 * trust a session's stored activeCommunityId as-is — re-verify it as a live,
 * current membership on every call. Exported standalone (rather than inlined
 * into getCurrentAccount()) so it's directly testable without next/headers'
 * request-scoped cookies().
 */
export async function resolveLiveActiveCommunityId(
  accountId: string,
  storedActiveCommunityId: string | null,
): Promise<string | null> {
  if (!storedActiveCommunityId) return null;
  const isMember = await requireCommunityMembership(accountId, storedActiveCommunityId);
  return isMember ? storedActiveCommunityId : null;
}

export async function getCurrentAccount(): Promise<CurrentAccountPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await getValidSession(token);
  if (!session) return null;

  const [memberships, activeCommunityId] = await Promise.all([
    prisma.membership.findMany({
      where: { accountId: session.accountId },
      include: { community: { select: { name: true, operationalEpoch: true } } },
    }),
    resolveLiveActiveCommunityId(session.accountId, session.activeCommunityId),
  ]);

  return toCurrentAccountPayload(
    session,
    memberships
      // 009-platform-administration, research.md #8: a membership predating a
      // restoration no longer counts as current — mirrors listMyListings()/
      // listMyThreads()'s same epoch-map pattern (listingService.ts/messageService.ts).
      .filter((membership) => membership.operationalEpoch === membership.community.operationalEpoch)
      .map((membership) => ({
        communityId: membership.communityId,
        communityName: membership.community.name,
        role: membership.role,
      })),
    activeCommunityId,
  );
}
