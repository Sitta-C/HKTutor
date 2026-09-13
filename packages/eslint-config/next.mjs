import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

import {
  absoluteAppImportRules,
  commonRules,
  createCrossAppBoundaryRule,
  createTypeScriptResolverSettings,
} from './base.mjs';

export const createNextConfig = ({ tsconfigRootDir }) =>
  defineConfig([
    ...nextVitals,
    ...nextTs,
    globalIgnores(['.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts']),
    {
      files: ['**/*.{ts,tsx}'],
      rules: {
        ...absoluteAppImportRules,
        ...commonRules,
        '@typescript-eslint/no-explicit-any': 'error',
        'import/no-restricted-paths': createCrossAppBoundaryRule({
          from: 'api',
          target: 'web',
        }),
        'no-console': ['error', { allow: ['error', 'warn'] }],
      },
      settings: createTypeScriptResolverSettings(tsconfigRootDir),
    },
    prettier,
  ]);
