# astro-ts rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Stack: Astro + TypeScript. One linter (ESLint), one formatter (Prettier, with prettier-plugin-astro), one typechecker
(`astro check`: tsc for `.ts` plus the Astro language server for `.astro` frontmatter and templates).
Gate: `node .standards/check.mjs` runs, in order: pins -> `astro check` (hints and up fail) ->
`eslint . --max-warnings 0` -> `prettier --check .`. CI never runs `--fix`. Locally: `npx eslint . --fix` and
`npx prettier --write .`.

## Setup (follower-owned files, each a few lines)
- `eslint.config.mjs`: `import standards from './.standards/astro-ts/eslint.base.mjs'` then
  `export default standards(...overrides)`. Each override has a reason comment and the narrowest `files` glob.
- `tsconfig.json` extends `./.standards/astro-ts/tsconfig.base.json` (Astro's `astro/tsconfigs/strict` plus
  `noUncheckedIndexedAccess` and the unused/fallthrough checks) and adds `include` (`.astro/types.d.ts`, your
  sources, config files), `paths`, `exclude`. `astro check` runs `astro sync` first, so `.astro/types.d.ts` exists in a
  clean CI checkout. Every `.ts`/`.tsx` file must be included: type-aware lint fails ("not found by the project
  service") on a file no tsconfig includes.
- `.prettierrc.json` is vendored (read-only; loads prettier-plugin-astro for `*.astro`). Prettier skips
  `.gitignore`d paths, `.standards/`, lock and suppression files; repo-specific ignores go in a root `.prettierignore`.
- Tool versions are exact devDependencies matching `.standards/astro-ts/check.json` `tools`; the `pins` step names the
  `npm i -D -E` command when one drifts. `astro` is yours (declared and installed, any version). Bump the pins only
  with `sync.mjs bump astro-ts`, in their own PR.

## Code
- Formatting is Prettier's alone. Never add eslint-plugin-prettier.
- Every `eslint-disable*` names the rule and a reason after ` -- `; unused disables fail. `@ts-expect-error <reason>`
  only; `@ts-ignore` and `@ts-nocheck` fail.
- `.ts`/`.tsx` get typescript-eslint `recommendedTypeChecked`; `.astro` files get eslint-plugin-astro `recommended`,
  jsx-a11y `recommended` on the template, and the non-type-aware typescript-eslint rules (their types are checked by
  `astro check`). Keep logic in `.ts` modules, where every rule applies. Promises are awaited, returned, or discarded
  with `void`.
- Indexed access is `T | undefined` (`noUncheckedIndexedAccess`): guard it; `!` only with a comment saying why it
  cannot be missing.

## Existing debt (adoption only)
- `astro check` errors have no ratchet: fix them in the bootstrap PR.
- ESLint debt may be frozen once with `npx eslint . --suppress-all` into a committed `eslint-suppressions.json`.
  It only shrinks: fixed violations must be pruned (`npx eslint . --prune-suppressions`; unused entries fail), and
  never re-run `--suppress-all` to turn a PR green.
