/** Root ESLint config (flat config is avoided to keep ESLint 8 + typescript-eslint 8 simple). */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2023, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2023: true, browser: true },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    '.next/',
    'coverage/',
    'playwright-report/',
    'test-results/',
    'packages/db/prisma/migrations/',
    '*.config.js',
    '*.config.mjs',
    '.eslintrc.cjs',
    'next-env.d.ts',
  ],
  rules: {
    // Strict TypeScript already reports these; ESLint duplicates would be noise.
    'no-unused-vars': 'off',
    'no-undef': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/ban-ts-comment': [
      'error',
      { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' },
    ],
    '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'always'],
  },
  overrides: [
    {
      files: ['packages/db/prisma/seed.ts', 'tests/**/*.ts', 'apps/web/src/app/error.tsx'],
      rules: { 'no-console': 'off' },
    },
    {
      files: ['apps/web/tailwind.config.ts'],
      rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
  ],
};
