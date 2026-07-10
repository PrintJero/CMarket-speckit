process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret';
process.env.DEFAULT_INVITATION_EXPIRY_DAYS = process.env.DEFAULT_INVITATION_EXPIRY_DAYS ?? '7';
process.env.EMAIL_SERVICE_BASE_URL = process.env.EMAIL_SERVICE_BASE_URL ?? 'http://localhost:4100';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
