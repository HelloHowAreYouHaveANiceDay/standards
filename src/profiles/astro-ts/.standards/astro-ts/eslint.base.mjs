// Vendored by HelloHowAreYouHaveANiceDay/standards (profile astro-ts); do not edit -- re-run sync.
// The follower's eslint.config.mjs is the overlay:
//
//   import standards from './.standards/astro-ts/eslint.base.mjs'
//   export default standards(
//     // each override: a reason comment, a `files` glob where it can be narrow
//     { files: ['src/legacy/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
//   )
//
// = eslint-plugin-astro flat/recommended (+ jsx-a11y-recommended on .astro templates) + typescript-eslint
// recommendedTypeChecked on .ts/.tsx files + eslint-comments. .astro files get the non-type-aware TS rules
// (frontmatter types are checked by `astro check`). Rules only, no formatting (Prettier owns layout).
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'
import astro from 'eslint-plugin-astro'
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import skipFormatting from 'eslint-config-prettier/flat'

export const IGNORES = [
  '.standards/**',
  '**/node_modules/**',
  'dist/**',
  '.astro/**',
  '.vercel/**',
  '.wrangler/**',
  '**/coverage/**',
  '**/*.min.*',
]

export default function standards(...overlay) {
  return defineConfig(
    globalIgnores(IGNORES),
    {
      name: 'standards/typescript',
      files: ['**/*.{ts,tsx,mts,cts}'],
      extends: [tseslint.configs.recommendedTypeChecked],
      languageOptions: { parserOptions: { projectService: true } },
      rules: {
        // `@ts-expect-error <reason>` only; never @ts-ignore / @ts-nocheck.
        '@typescript-eslint/ban-ts-comment': [
          'error',
          { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true },
        ],
        // Unused vars may be marked intentional with a leading underscore.
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
      },
    },
    {
      name: 'standards/astro-typescript',
      files: ['**/*.astro'],
      extends: [tseslint.configs.recommended],
      rules: {
        '@typescript-eslint/ban-ts-comment': [
          'error',
          { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true },
        ],
      },
    },
    // After typescript-eslint: eslint-plugin-astro sets the .astro parser (astro-eslint-parser + TS for frontmatter).
    astro.configs['flat/recommended'],
    astro.configs['flat/jsx-a11y-recommended'],
    comments.recommended,
    {
      name: 'standards/rules',
      linterOptions: {
        reportUnusedDisableDirectives: 'error',
        reportUnusedInlineConfigs: 'error',
      },
      rules: {
        // Every disable says why: `// eslint-disable-next-line <rule> -- <reason>`.
        '@eslint-community/eslint-comments/require-description': 'error',
        eqeqeq: ['error', 'always', { null: 'ignore' }],
      },
    },
    skipFormatting,
    ...overlay,
  )
}
