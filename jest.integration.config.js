/** @type {import('jest').Config} */
module.exports = {
  displayName: 'integration',
  rootDir: 'src',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.(integration|e2e)\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  setupFiles: ['<rootDir>/test/jest-setup-env.ts'],
  collectCoverageFrom: ['**/infrastructure/prisma-*.repository.ts', '!**/generated/**'],
  coverageDirectory: '../coverage/integration',
  testTimeout: 60000,
  // Cada spec sobe seu proprio Postgres via testcontainers — serializado e estavel.
  maxWorkers: 1,
};
