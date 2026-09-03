import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

import { javascriptRules } from './base.mjs';

export const createNodeConfig = ({ ignores = [] } = {}) =>
  defineConfig([
    ...(ignores.length > 0 ? [globalIgnores(ignores)] : []),
    eslint.configs.recommended,
    {
      files: ['**/*.{js,mjs,cjs}'],
      languageOptions: {
        globals: globals.node,
      },
      plugins: {
        import: importPlugin,
      },
      rules: javascriptRules,
    },
    prettier,
  ]);
