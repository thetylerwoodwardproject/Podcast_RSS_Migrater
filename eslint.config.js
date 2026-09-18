import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default [
  {
    ignores: [
      'build/**',
      'node_modules/**',
      '.svelte-kit/**',
      'data/**',
      'tests/fixtures/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // ignoreRestSiblings lets `const { secret, ...rest } = x` be used to strip fields.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,svelte}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
];
