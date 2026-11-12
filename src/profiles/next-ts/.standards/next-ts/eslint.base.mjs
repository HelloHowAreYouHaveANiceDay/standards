// Vendored by HelloHowAreYouHaveANiceDay/standards (profile next-ts); do not edit -- re-run sync.
// The follower's eslint.config.mjs is the overlay:
//
//   import standards from './.standards/next-ts/eslint.base.mjs'
//   export default standards(
//     // each override: a reason comment, a `files` glob where it can be narrow
//     { files: ['src/legacy/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
//   )
//
// = create-next-app's config (eslint-config-next/core-web-vitals: @next/next, react, react-hooks, jsx-a11y,
// import) + typescript-eslint recommendedTypeChecked on TS files (instead of the template's non-type-aware
// eslint-config-next/typescript) + eslint-comments. Rules only, no formatting (Prettier owns layout).
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import tseslint from 'typescript-eslint'
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import skipFormatting from 'eslint-config-prettier/flat'

export const IGNORES = [
  '.standards/**',
  '**/node_modules/**',
  '.next/**',
  'out/**',
  'build/**',
  'next-env.d.ts',
  '**/coverage/**',
  '**/*.min.*',
]

export default function standards(...overlay) {
  return defineConfig(
    globalIgnores(IGNORES),
    ...nextVitals,
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
