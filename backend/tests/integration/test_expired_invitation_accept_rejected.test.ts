import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/models/prismaClient';
import { createTestCommunityWithAdmin, createTestUser, issueAccessToken } from '../helpers/testFactory';

const app = createApp();

describe('FR-016/FR-017: expired invitations cannot be accepted or declined', () => {
  it('rejects acceptance once expiresAt has passed, even though status is still PENDING', async () => {
    const { community, admin, membership } = await createTestCommunityWithAdmin();
    const invitee = await createTestUser({ email: 'expired-invitee@example.test' });
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const invitation = await prisma.invitation.create({
      data: {
        communityId: community.id,
        invitedByMembershipId: membership.id,
        invitedByUserId: admin.id,
        inviteeEmail: invitee.email as string,
        matchedUserId: invitee.id,
        status: 'PENDING', // stored status is still PENDING — expiry is derived, not written
        createdAt: new Date(pastDate.getTime() - 8 * 24 * 60 * 60 * 1000),
        expiresAt: pastDate,
      },
    });
    const token = issueAccessToken(invitee.id);

    const res = await request(app)
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
  });

  it('rejects decline once expiresAt has passed', async () => {
    const { community, admin, membership } = await createTestCommunityWithAdmin();
    const invitee = await createTestUser({ email: 'expired-decline@example.test' });
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const invitation = await prisma.invitation.create({
      data: {
        communityId: community.id,
        invitedByMembershipId: membership.id,
        invitedByUserId: admin.id,
        inviteeEmail: invitee.email as string,
        matchedUserId: invitee.id,
        status: 'PENDING',
        createdAt: new Date(pastDate.getTime() - 8 * 24 * 60 * 60 * 1000),
        expiresAt: pastDate,
      },
    });
    const token = issueAccessToken(invitee.id);

    const res = await request(app)
      .post(`/api/v1/invitations/${invitation.id}/decline`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
  });
});
