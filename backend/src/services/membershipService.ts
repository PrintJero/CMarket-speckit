import { Invitation, Membership, Prisma } from '@prisma/client';
import { prisma } from '../models/prismaClient';
import { MembershipNotActiveError } from './errors';

type PrismaTx = Prisma.TransactionClient;

/**
 * Creates or reactivates a Membership as a side effect of an Invitation
 * being accepted (FR-005). If the user previously had a (now REVOKED)
 * membership in this community, this reactivates that same row rather
 * than creating a duplicate — Membership is unique on (communityId, userId).
 */
export async function activateMembershipFromInvitation(
  tx: PrismaTx,
  invitation: Invitation,
  userId: string,
): Promise<Membership> {
  return tx.membership.upsert({
    where: { communityId_userId: { communityId: invitation.communityId, userId } },
    create: {
      communityId: invitation.communityId,
      userId,
      role: 'MEMBER',
      status: 'ACTIVE',
      sourceInvitationId: invitation.id,
      joinedAt: new Date(),
    },
    update: {
      status: 'ACTIVE',
      sourceInvitationId: invitation.id,
      joinedAt: new Date(),
      revokedAt: null,
    },
  });
}

export interface MembershipDTO {
  userId: string;
  communityId: string;
  role: string;
  status: string;
  joinedAt: string;
}

export function serializeMembership(membership: Membership): MembershipDTO {
  return {
    userId: membership.userId,
    communityId: membership.communityId,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt.toISOString(),
  };
}

export async function listCommunityMembers(communityId: string): Promise<Membership[]> {
  return prisma.membership.findMany({
    where: { communityId, status: 'ACTIVE' },
    orderBy: { joinedAt: 'asc' },
  });
}

/**
 * Revokes an existing member's access (FR-009, FR-010). Rejects if the
 * target user has no ACTIVE membership in this community to revoke.
 * Historical Invitation/transaction rows referencing this membership are
 * left untouched (FR-011) — revocation only flips this row's status.
 */
export async function revokeMembership(communityId: string, userId: string): Promise<Membership> {
  const membership = await prisma.membership.findUnique({
    where: { communityId_userId: { communityId, userId } },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    throw new MembershipNotActiveError();
  }

  return prisma.membership.update({
    where: { id: membership.id },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });
}
