import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'docs/**',
      'brand/**',
      '**/drizzle/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/.next/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain Node scripts, such as the API's build check: CommonJS, with Node's globals.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        __dirname: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // Raw HTML in React bypasses its escaping (docs/security-plan.md, R7). Nothing uses it: even the sign-in
      // QR code is drawn as an image.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            'Raw HTML bypasses React escaping. Render text, or explain the exception with an eslint-disable comment.',
        },
      ],
    },
  },
  {
    // React Native loads images with require().
    files: ['apps/mobile/**/*.tsx'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
