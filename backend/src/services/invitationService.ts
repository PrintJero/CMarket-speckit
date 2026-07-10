import { Invitation, Membership, Prisma } from '@prisma/client';
import { prisma } from '../models/prismaClient';
import { sendInvitationEmail } from '../integrations/email';
import { computeEffectiveStatus, computeExpiresAt, isPending } from '../utils/invitationExpiry';
import { logger } from '../utils/logger';
import {
  AlreadyMemberError,
  DuplicateInvitationError,
  InvitationNotPendingError,
  NotFoundError,
  ValidationError,
} from './errors';
import { activateMembershipFromInvitation } from './membershipService';
import { AuthenticatedUser } from '../types/express';

function notPendingError(invitation: Invitation): InvitationNotPendingError {
  const effectiveStatus = computeEffectiveStatus(invitation);
  return new InvitationNotPendingError(
    effectiveStatus === 'EXPIRED'
      ? 'Invitation has expired; ask the administrator to send a new one'
      : `Invitation is no longer pending (current status: ${effectiveStatus})`,
  );
}

export interface InvitationDTO {
  id: string;
  communityId: string;
  inviteeEmail: string | null;
  inviteePhone: string | null;
  effectiveStatus: ReturnType<typeof computeEffectiveStatus>;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
}

export function serializeInvitation(invitation: Invitation): InvitationDTO {
  return {
    id: invitation.id,
    communityId: invitation.communityId,
    inviteeEmail: invitation.inviteeEmail,
    inviteePhone: invitation.inviteePhone,
    effectiveStatus: computeEffectiveStatus(invitation),
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    respondedAt: invitation.respondedAt ? invitation.respondedAt.toISOString() : null,
  };
}

export interface CreateInvitationInput {
  communityId: string;
  invitedByMembershipId: string;
  invitedByUserId: string;
  inviteeEmail?: string;
  inviteePhone?: string;
}

export async function createInvitation(input: CreateInvitationInput): Promise<Invitation> {
  const inviteeEmail = input.inviteeEmail?.trim() || undefined;
  const inviteePhone = input.inviteePhone?.trim() || undefined;

  if (!inviteeEmail && !inviteePhone) {
    throw new ValidationError('Either inviteeEmail or inviteePhone is required');
  }

  const community = await prisma.community.findUnique({ where: { id: input.communityId } });
  if (!community) {
    throw new NotFoundError('Community not found');
  }

  const contactFilter: Prisma.UserWhereInput[] = [];
  if (inviteeEmail) contactFilter.push({ email: inviteeEmail });
  if (inviteePhone) contactFilter.push({ phone: inviteePhone });
  const matchedUser = await prisma.user.findFirst({ where: { OR: contactFilter } });

  if (matchedUser) {
    const existingMembership = await prisma.membership.findUnique({
      where: { communityId_userId: { communityId: input.communityId, userId: matchedUser.id } },
    });
    if (existingMembership && existingMembership.status === 'ACTIVE') {
      throw new AlreadyMemberError();
    }
  }

  const now = new Date();
  const duplicateFilter: Prisma.InvitationWhereInput[] = [];
  if (inviteeEmail) duplicateFilter.push({ inviteeEmail });
  if (inviteePhone) duplicateFilter.push({ inviteePhone });
  const existingPending = await prisma.invitation.findFirst({
    where: {
      communityId: input.communityId,
      status: 'PENDING',
      expiresAt: { gt: now },
      OR: duplicateFilter,
    },
  });
  if (existingPending) {
    throw new DuplicateInvitationError();
  }

  const invitation = await prisma.invitation.create({
    data: {
      communityId: input.communityId,
      invitedByMembershipId: input.invitedByMembershipId,
      invitedByUserId: input.invitedByUserId,
      inviteeEmail: inviteeEmail ?? null,
      inviteePhone: inviteePhone ?? null,
      matchedUserId: matchedUser?.id ?? null,
      status: 'PENDING',
      createdAt: now,
      expiresAt: computeExpiresAt(now, community.invitationExpiryDays),
    },
  });

  logger.info('invitation.created', {
    invitationId: invitation.id,
    communityId: invitation.communityId,
    invitedByMembershipId: invitation.invitedByMembershipId,
    expiresAt: invitation.expiresAt.toISOString(),
  });

  if (inviteeEmail) {
    try {
      await sendInvitationEmail({
        invitationId: invitation.id,
        communityId: community.id,
        communityName: community.name,
        inviteeEmail,
        expiresAt: invitation.expiresAt,
      });
    } catch (err) {
      // Notification failure must not roll back an otherwise-valid invitation
      // (the invitation row is the source of truth); surfaced via logging.
      logger.error('invitation.email_send_failed', {
        invitationId: invitation.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return invitation;
}

export async function listCommunityInvitations(communityId: string): Promise<Invitation[]> {
  return prisma.invitation.findMany({ where: { communityId }, orderBy: { createdAt: 'desc' } });
}

export async function listMyInvitations(user: AuthenticatedUser): Promise<Invitation[]> {
  const contactFilter: Prisma.InvitationWhereInput[] = [];
  if (user.email) contactFilter.push({ inviteeEmail: user.email });
  if (user.phone) contactFilter.push({ inviteePhone: user.phone });
  if (contactFilter.length === 0) {
    return [];
  }

  return prisma.invitation.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { gt: new Date() },
      OR: contactFilter,
    },
    orderBy: { createdAt: 'desc' },
  });
}

function invitationMatchesCaller(invitation: Invitation, user: AuthenticatedUser): boolean {
  if (invitation.matchedUserId && invitation.matchedUserId === user.id) return true;
  if (invitation.inviteeEmail && user.email && invitation.inviteeEmail === user.email) return true;
  if (invitation.inviteePhone && user.phone && invitation.inviteePhone === user.phone) return true;
  return false;
}

export async function acceptInvitation(
  invitationId: string,
  user: AuthenticatedUser,
): Promise<{ invitation: Invitation; membership: Membership }> {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation || !invitationMatchesCaller(invitation, user)) {
    throw new NotFoundError('Invitation not found');
  }
  if (!isPending(invitation)) {
    throw notPendingError(invitation);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedInvitation = await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', respondedAt: new Date(), matchedUserId: user.id },
    });
    const membership = await activateMembershipFromInvitation(tx, updatedInvitation, user.id);
    return { invitation: updatedInvitation, membership };
  });

  logger.info('invitation.accepted', {
    invitationId: result.invitation.id,
    communityId: result.invitation.communityId,
    userId: user.id,
  });

  return result;
}

export async function declineInvitation(invitationId: string, user: AuthenticatedUser): Promise<Invitation> {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation || !invitationMatchesCaller(invitation, user)) {
    throw new NotFoundError('Invitation not found');
  }
  if (!isPending(invitation)) {
    throw notPendingError(invitation);
  }

  return prisma.invitation.update({
    where: { id: invitation.id },
    data: { status: 'DECLINED', respondedAt: new Date() },
  });
}

export async function cancelInvitation(communityId: string, invitationId: string): Promise<void> {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation || invitation.communityId !== communityId) {
    throw new NotFoundError('Invitation not found');
  }
  if (!isPending(invitation)) {
    throw notPendingError(invitation);
  }

  await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'CANCELLED' } });
}
