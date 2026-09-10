import { createNestConfig } from '@hktutor/eslint-config/nest';

export default [
  ...createNestConfig({
    tsconfigRootDir: import.meta.dirname,
  }),
  {
    files: ['prisma/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-console': ['error', { allow: ['error', 'info'] }],
    },
  },
];
