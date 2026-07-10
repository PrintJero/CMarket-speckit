import { prisma } from '../src/models/prismaClient';

// Truncates all feature tables between tests so each test starts from a
// clean slate. Requires TEST_DATABASE_URL (or DATABASE_URL) to point at a
// disposable PostgreSQL database — never run this against production data.
beforeEach(async () => {
  await prisma.$transaction([
    prisma.invitation.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.community.deleteMany(),
    prisma.user.deleteMany(),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});
