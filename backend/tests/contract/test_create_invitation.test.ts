import request from 'supertest';
import { createApp } from '../../src/app';
import {
  createTestCommunityWithAdmin,
  createTestMembership,
  createTestUser,
  issueAccessToken,
} from '../helpers/testFactory';

jest.mock('../../src/integrations/email', () => ({
  sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
}));

const app = createApp();

describe('POST /communities/:communityId/invitations', () => {
  it('creates a pending invitation when called by a community admin (FR-001)', async () => {
    const { community, admin } = await createTestCommunityWithAdmin();
    const token = issueAccessToken(admin.id);

    const res = await request(app)
      .post(`/api/v1/communities/${community.id}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ inviteeEmail: 'prospect@example.test' });

    expect(res.status).toBe(201);
    expect(res.body.effectiveStatus).toBe('PENDING');
    expect(res.body.inviteeEmail).toBe('prospect@example.test');
    expect(res.body.communityId).toBe(community.id);
  });

  it('rejects when neither email nor phone is provided (FR-001)', async () => {
    const { community, admin } = await createTestCommunityWithAdmin();
    const token = issueAccessToken(admin.id);

    const res = await request(app)
      .post(`/api/v1/communities/${community.id}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejects when the caller is a MEMBER, not an ADMIN, of the community (Principle III)', async () => {
    const { community } = await createTestCommunityWithAdmin();
    const member = await createTestUser();
    await createTestMembership({ communityId: community.id, userId: member.id, role: 'MEMBER' });
    const token = issueAccessToken(member.id);

    const res = await request(app)
      .post(`/api/v1/communities/${community.id}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ inviteeEmail: 'prospect@example.test' });

    expect(res.status).toBe(403);
  });

  it('rejects when the caller has no membership in the community at all (Principle II)', async () => {
    const { community } = await createTestCommunityWithAdmin();
    const outsider = await createTestUser();
    const token = issueAccessToken(outsider.id);

    const res = await request(app)
      .post(`/api/v1/communities/${community.id}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ inviteeEmail: 'prospect@example.test' });

    expect(res.status).toBe(404);
  });

  it('rejects a duplicate pending invitation to the same contact in the same community (FR-013)', async () => {
    const { community, admin } = await createTestCommunityWithAdmin();
    const token = issueAccessToken(admin.id);

    await request(app)
      .post(`/api/v1/communities/${community.id}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ inviteeEmail: 'dup@example.test' });

    const res = await request(app)
      .post(`/api/v1/communities/${community.id}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ inviteeEmail: 'dup@example.test' });

    expect(res.status).toBe(409);
  });

  it('rejects inviting a contact who is already an active member (FR-014)', async () => {
    const { community, admin } = await createTestCommunityWithAdmin();
    const existingMember = await createTestUser({ email: 'already-member@example.test' });
    await createTestMembership({ communityId: community.id, userId: existingMember.id, role: 'MEMBER' });
    const token = issueAccessToken(admin.id);

    const res = await request(app)
      .post(`/api/v1/communities/${community.id}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ inviteeEmail: 'already-member@example.test' });

    expect(res.status).toBe(409);
  });
});
