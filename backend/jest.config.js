/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/env.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupTestDb.ts'],
  clearMocks: true,
  // Tests share one PostgreSQL database and setupTestDb.ts truncates its
  // tables before every test; running test files in parallel workers lets
  // one file's truncation race another's inserts (deadlocks, FK violations).
  // Serial execution is required unless per-file DB isolation is added.
  maxWorkers: 1,
};
