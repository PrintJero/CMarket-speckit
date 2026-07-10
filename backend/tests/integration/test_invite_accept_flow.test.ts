import request from 'supertest';
import { createApp } from '../../src/app';
import { createTestCommunityWithAdmin, createTestUser, issueAccessToken } from '../helpers/testFactory';

jest.mock('../../src/integrations/email', () => ({
  sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
}));

const app = createApp();

describe('User Story 1: Administrator invites and user accepts (end-to-end)', () => {
  it('lets an invitee discover, accept, and gain marketplace access after an admin invite', async () => {
    const { community, admin } = await createTestCommunityWithAdmin();
    const adminToken = issueAccessToken(admin.id);
    const invitee = await createTestUser({ email: 'e2e-invitee@example.test' });
    const inviteeToken = issueAccessToken(invitee.id);

    // 1. Administrator sends the invitation.
    const createRes = await request(app)
      .post(`/api/v1/communities/${community.id}/invitations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ inviteeEmail: 'e2e-invitee@example.test' });
    expect(createRes.status).toBe(201);

    // 2. Invitee has no marketplace access yet.
    const beforeAccept = await request(app)
      .get(`/api/v1/communities/${community.id}/members`)
      .set('Authorization', `Bearer ${inviteeToken}`);
    expect(beforeAccept.status).toBe(404);

    // 3. Invitee discovers the pending invitation.
    const myInvites = await request(app)
      .get('/api/v1/users/me/invitations')
      .set('Authorization', `Bearer ${inviteeToken}`);
    expect(myInvites.status).toBe(200);
    expect(myInvites.body).toHaveLength(1);
    const invitationId = myInvites.body[0].id;

    // 4. Invitee accepts.
    const acceptRes = await request(app)
      .post(`/api/v1/invitations/${invitationId}/accept`)
      .set('Authorization', `Bearer ${inviteeToken}`);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.membership.status).toBe('ACTIVE');

    // 5. Invitee now has marketplace access.
    const afterAccept = await request(app)
      .get(`/api/v1/communities/${community.id}/members`)
      .set('Authorization', `Bearer ${inviteeToken}`);
    expect(afterAccept.status).toBe(200);
    expect(afterAccept.body.some((m: { userId: string }) => m.userId === invitee.id)).toBe(true);
  });
});
