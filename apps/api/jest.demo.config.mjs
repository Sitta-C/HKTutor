import { readFileSync } from 'node:fs';

const { jest: base } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default {
  ...base,
  testRegex: 'test/unit/auth/access-session\\.spec\\.ts$',
  collectCoverage: true,
  collectCoverageFrom: ['src/modules/auth/access-session.ts'],
  coverageDirectory: 'coverage/project-demonstration',
  coverageReporters: ['text', 'html', 'json-summary'],
  coverageThreshold: {
    './src/modules/auth/access-session.ts': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
};
