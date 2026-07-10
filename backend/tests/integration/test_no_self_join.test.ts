import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { createApp } from '../../src/app';
import { createTestCommunity, createTestUser, issueAccessToken } from '../helpers/testFactory';

const app = createApp();

describe('Constitution Principle I: no self-service join path', () => {
  it('returns 404 for any plausible request-to-join / apply route', async () => {
    const community = await createTestCommunity();
    const user = await createTestUser();
    const token = issueAccessToken(user.id);

    const candidatePaths = [
      `/api/v1/communities/${community.id}/join`,
      `/api/v1/communities/${community.id}/apply`,
      `/api/v1/communities/${community.id}/membership-requests`,
      '/api/v1/membership-requests',
    ];

    for (const candidatePath of candidatePaths) {
      const res = await request(app).post(candidatePath).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(404);
    }
  });

  it('does not define any join/apply/request path in the shared API contract', () => {
    const contractPath = path.resolve(
      __dirname,
      '../../../specs/001-community-invitations/contracts/invitations-api.yaml',
    );
    const contract = fs.readFileSync(contractPath, 'utf-8');

    expect(contract).not.toMatch(/\/join/i);
    expect(contract).not.toMatch(/\/apply/i);
    expect(contract).not.toMatch(/membership-request/i);
  });
});
