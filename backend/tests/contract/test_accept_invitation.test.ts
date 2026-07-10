import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/models/prismaClient';
import { computeExpiresAt } from '../../src/utils/invitationExpiry';
import { createTestCommunityWithAdmin, createTestUser, issueAccessToken } from '../helpers/testFactory';

jest.mock('../../src/integrations/email', () => ({
  sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
}));

const app = createApp();

async function createPendingInvitation(params: {
  communityId: string;
  invitedByMembershipId: string;
  invitedByUserId: string;
  inviteeEmail: string;
  matchedUserId?: string;
}) {
  const createdAt = new Date();
  return prisma.invitation.create({
    data: {
      communityId: params.communityId,
      invitedByMembershipId: params.invitedByMembershipId,
      invitedByUserId: params.invitedByUserId,
      inviteeEmail: params.inviteeEmail,
      matchedUserId: params.matchedUserId,
      status: 'PENDING',
      createdAt,
      expiresAt: computeExpiresAt(createdAt, null),
    },
  });
}

describe('POST /invitations/:invitationId/accept', () => {
  it('accepts a pending invitation and activates membership (FR-004, FR-005)', async () => {
    const { community, admin, membership } = await createTestCommunityWithAdmin();
    const invitee = await createTestUser({ email: 'invitee@example.test' });
    const invitation = await createPendingInvitation({
      communityId: community.id,
      invitedByMembershipId: membership.id,
      invitedByUserId: admin.id,
      inviteeEmail: invitee.email as string,
      matchedUserId: invitee.id,
    });
    const token = issueAccessToken(invitee.id);

    const res = await request(app)
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.membership.status).toBe('ACTIVE');
    expect(res.body.invitation.effectiveStatus).toBe('ACCEPTED');
  });

  it('rejects acceptance by a user other than the matched invitee (404)', async () => {
    const { community, admin, membership } = await createTestCommunityWithAdmin();
    const invitee = await createTestUser({ email: 'invitee2@example.test' });
    const stranger = await createTestUser();
    const invitation = await createPendingInvitation({
      communityId: community.id,
      invitedByMembershipId: membership.id,
      invitedByUserId: admin.id,
      inviteeEmail: invitee.email as string,
      matchedUserId: invitee.id,
    });
    const token = issueAccessToken(stranger.id);

    const res = await request(app)
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('rejects acceptance of an invitation that is no longer PENDING (409)', async () => {
    const { community, admin, membership } = await createTestCommunityWithAdmin();
    const invitee = await createTestUser({ email: 'invitee3@example.test' });
    const invitation = await createPendingInvitation({
      communityId: community.id,
      invitedByMembershipId: membership.id,
      invitedByUserId: admin.id,
      inviteeEmail: invitee.email as string,
      matchedUserId: invitee.id,
    });
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'DECLINED' } });
    const token = issueAccessToken(invitee.id);

    const res = await request(app)
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
  });
});
