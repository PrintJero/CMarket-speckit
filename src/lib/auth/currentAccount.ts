import { cookies } from "next/headers";
import { getValidSession } from "@/server/services/sessionService";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessionCookie";
import { prisma } from "@/lib/prisma";
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
 * reason, defaulting to null.
 */
export function toCurrentAccountPayload(
  session: SessionAccount,
  memberships: MembershipSummary[] = [],
): CurrentAccountPayload {
  return {
    accountId: session.accountId,
    email: session.email,
    verified: Boolean(session.emailVerifiedAt),
    displayName: session.displayName ?? null,
    memberships,
  };
}

export async function getCurrentAccount(): Promise<CurrentAccountPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await getValidSession(token);
  if (!session) return null;

  const memberships = await prisma.membership.findMany({
    where: { accountId: session.accountId },
    include: { community: { select: { name: true, operationalEpoch: true } } },
  });

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
  );
}
