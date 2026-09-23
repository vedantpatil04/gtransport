/** End-to-end tests: real HTTP stack against a real PostgreSQL test database. */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.e2e-spec.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/setup-env.ts'],
  globalSetup: '<rootDir>/global-setup.ts',
  testTimeout: 30000,
};
