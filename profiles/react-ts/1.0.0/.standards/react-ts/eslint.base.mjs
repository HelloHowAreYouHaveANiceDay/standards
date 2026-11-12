// Vendored by HelloHowAreYouHaveANiceDay/standards (profile react-ts); do not edit -- re-run sync.
// The follower's eslint.config.mjs is the overlay:
//
//   import standards from './.standards/react-ts/eslint.base.mjs'
//   export default standards(
//     // each override: a reason comment, a `files` glob where it can be narrow
//     { files: ['src/legacy/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
//   )
//
// Rules only, no formatting (Prettier owns layout). Type-aware (recommendedTypeChecked) so the async bugs
// that matter in data-fetching code fail: no-floating-promises, no-misused-promises, await-thenable.
// React rules are create-vite's: eslint-plugin-react-hooks recommended + react-refresh (vite preset).
// TypeScript files only: plain .js/.mjs config and scripts are outside this profile's scope.
import { fileURLToPath } from 'node:url'
import { defineConfig, globalIgnores } from 'eslint/config'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import { reactRefresh } from 'eslint-plugin-react-refresh'
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import skipFormatting from 'eslint-config-prettier/flat'

export const IGNORES = [
  '.standards/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/*.min.*',
]

export const ROOT = fileURLToPath(new URL('../..', import.meta.url))

export default function standards(...overlay) {
  return defineConfig(
    globalIgnores(IGNORES),
    {
      name: 'standards/typescript',
      files: ['**/*.{ts,mts,cts,tsx}'],
      extends: [
        js.configs.recommended,
        tseslint.configs.recommendedTypeChecked,
        reactHooks.configs.flat.recommended,
        reactRefresh.configs.vite(),
      ],
      languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: ROOT } },
    },
    { ...comments.recommended, files: ['**/*.{ts,mts,cts,tsx}'] },
    {
      name: 'standards/rules',
      files: ['**/*.{ts,mts,cts,tsx}'],
      linterOptions: {
        reportUnusedDisableDirectives: 'error',
        reportUnusedInlineConfigs: 'error',
      },
      rules: {
        // Every disable says why: `// eslint-disable-next-line <rule> -- <reason>`.
        '@eslint-community/eslint-comments/require-description': 'error',
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
        eqeqeq: ['error', 'always', { null: 'ignore' }],
      },
    },
    skipFormatting,
    ...overlay,
  )
}
