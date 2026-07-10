import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/models/prismaClient';
import { computeExpiresAt } from '../../src/utils/invitationExpiry';
import { createTestCommunityWithAdmin, createTestUser, issueAccessToken } from '../helpers/testFactory';

jest.mock('../../src/integrations/email', () => ({
  sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
}));

const app = createApp();

describe('GET /users/me/invitations', () => {
  it('returns only invitations matching the caller, not other invitees', async () => {
    const { community, admin, membership } = await createTestCommunityWithAdmin();
    const invitee = await createTestUser({ email: 'me@example.test' });
    const someoneElse = await createTestUser({ email: 'someone-else@example.test' });
    const createdAt = new Date();

    await prisma.invitation.create({
      data: {
        communityId: community.id,
        invitedByMembershipId: membership.id,
        invitedByUserId: admin.id,
        inviteeEmail: invitee.email as string,
        matchedUserId: invitee.id,
        status: 'PENDING',
        createdAt,
        expiresAt: computeExpiresAt(createdAt, null),
      },
    });
    await prisma.invitation.create({
      data: {
        communityId: community.id,
        invitedByMembershipId: membership.id,
        invitedByUserId: admin.id,
        inviteeEmail: someoneElse.email as string,
        matchedUserId: someoneElse.id,
        status: 'PENDING',
        createdAt,
        expiresAt: computeExpiresAt(createdAt, null),
      },
    });

    const token = issueAccessToken(invitee.id);
    const res = await request(app).get('/api/v1/users/me/invitations').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].inviteeEmail).toBe(invitee.email);
    expect(res.body[0].effectiveStatus).toBe('PENDING');
  });
});
