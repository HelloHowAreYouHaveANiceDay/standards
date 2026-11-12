// Vendored by HelloHowAreYouHaveANiceDay/standards (profile vue-ts); do not edit -- re-run sync.
// The follower's eslint.config.mjs is the overlay:
//
//   import standards from './.standards/vue-ts/eslint.base.mjs'
//   export default standards(
//     // each override: a reason comment, a `files` glob where it can be narrow
//     { files: ['src/legacy/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
//   )
//
// Rules only, no formatting (Prettier owns layout). Type-aware (recommendedTypeChecked) so the async bugs
// that matter in Firebase/Pinia code fail: no-floating-promises, no-misused-promises, await-thenable.
import { globalIgnores } from 'eslint/config'
import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import skipFormatting from 'eslint-config-prettier/flat'

export const IGNORES = [
  '.standards/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/dist-ssr/**',
  '**/coverage/**',
  '**/*.min.*',
]

export default function standards(...overlay) {
  return defineConfigWithVueTs(
    globalIgnores(IGNORES),
    { name: 'standards/files', files: ['**/*.{ts,mts,cts,tsx,vue}'] },
    pluginVue.configs['flat/essential'],
    vueTsConfigs.recommendedTypeChecked,
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
