import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import {
  commonRules,
  createCrossAppBoundaryRule,
  createTypeScriptResolverSettings,
} from './base.mjs';

export const createNestConfig = ({ tsconfigRootDir }) =>
  tseslint.config(
    {
      ignores: ['dist/**', 'coverage/**', 'eslint.config.mjs'],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      files: ['**/*.ts'],
      languageOptions: {
        globals: {
          ...globals.node,
          ...globals.jest,
        },
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
        sourceType: 'commonjs',
      },
      plugins: {
        import: importPlugin,
      },
      rules: {
        ...commonRules,
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/no-unsafe-argument': 'error',
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
        'import/no-restricted-paths': createCrossAppBoundaryRule({
          from: 'web',
          target: 'api',
        }),
        'no-console': 'error',
      },
      settings: createTypeScriptResolverSettings(tsconfigRootDir),
    },
    prettier,
  );
