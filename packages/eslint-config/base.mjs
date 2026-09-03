import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

export const createTypeScriptResolverSettings = (tsconfigRootDir) => ({
  'import/resolver': {
    typescript: {
      project: path.join(tsconfigRootDir, 'tsconfig.json'),
    },
  },
});

export const javascriptRules = {
  curly: ['error', 'all'],
  eqeqeq: ['error', 'always'],
  'import/no-duplicates': 'error',
  'import/order': [
    'error',
    {
      alphabetize: {
        caseInsensitive: true,
        order: 'asc',
      },
      groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'object', 'type'],
      'newlines-between': 'always',
      pathGroups: [
        {
          group: 'internal',
          pattern: '@/**',
          position: 'after',
        },
      ],
      pathGroupsExcludedImportTypes: ['builtin', 'type'],
      warnOnUnassignedImports: true,
    },
  ],
};

export const commonRules = {
  ...javascriptRules,
  '@typescript-eslint/consistent-type-imports': [
    'error',
    {
      fixStyle: 'separate-type-imports',
      prefer: 'type-imports',
    },
  ],
};

export const absoluteAppImportRules = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          message: 'Use the @/ alias for application-internal imports.',
          regex: '^\\.\\.?/(?!.*\\.css$)',
        },
      ],
    },
  ],
};

export const createCrossAppBoundaryRule = ({ from, target }) => [
  'error',
  {
    basePath: workspaceRoot,
    zones: [
      {
        from: `apps/${from}/src`,
        message: `Import ${from} through an explicit package or HTTP boundary, not its source files.`,
        target: `apps/${target}/src`,
      },
    ],
  },
];
