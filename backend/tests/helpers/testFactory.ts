import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import { prisma } from '../../src/models/prismaClient';

export async function createTestUser(overrides: { email?: string; phone?: string } = {}) {
  const unique = randomUUID();
  return prisma.user.create({
    data: {
      email: overrides.email ?? `${unique}@example.test`,
      phone: overrides.phone,
      name: `Test User ${unique.slice(0, 8)}`,
      passwordHash: 'not-used-in-tests',
    },
  });
}

export async function createTestCommunity(overrides: { invitationExpiryDays?: number | null } = {}) {
  return prisma.community.create({
    data: {
      name: `Test Community ${randomUUID().slice(0, 8)}`,
      type: 'UNIVERSITY',
      invitationExpiryDays: overrides.invitationExpiryDays ?? null,
    },
  });
}

export async function createTestMembership(params: {
  communityId: string;
  userId: string;
  role?: MembershipRole;
  status?: MembershipStatus;
}) {
  return prisma.membership.create({
    data: {
      communityId: params.communityId,
      userId: params.userId,
      role: params.role ?? 'MEMBER',
      status: params.status ?? 'ACTIVE',
    },
  });
}

/** Convenience: creates a community together with its ACTIVE ADMIN user. */
export async function createTestCommunityWithAdmin() {
  const admin = await createTestUser();
  const community = await createTestCommunity();
  const membership = await createTestMembership({
    communityId: community.id,
    userId: admin.id,
    role: 'ADMIN',
    status: 'ACTIVE',
  });
  return { admin, community, membership };
}

export function issueAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET as string, { expiresIn: '15m' });
}
