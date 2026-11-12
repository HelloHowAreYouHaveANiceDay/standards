# vue-ts rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Stack: Vue 3 + TypeScript + Vite. One linter (ESLint), one formatter (Prettier), one typechecker (vue-tsc).
Gate: `node .standards/check.mjs` runs, in order: pins -> `vue-tsc --build` -> `eslint . --max-warnings 0` ->
`prettier --check .`. CI never runs `--fix`. Locally: `npx eslint . --fix` and `npx prettier --write .`.

## Setup (follower-owned files, each a few lines)
- `eslint.config.mjs`: `import standards from './.standards/vue-ts/eslint.base.mjs'` then
  `export default standards(...overrides)`. Each override has a reason comment and the narrowest `files` glob.
- `tsconfig.json` = `{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }] }`.
  `tsconfig.app.json` extends `./.standards/vue-ts/tsconfig.app.json` (adds include, paths, types, tsBuildInfoFile
  under `node_modules/.tmp/`); `tsconfig.node.json` extends `./.standards/vue-ts/tsconfig.node.json` and includes
  the config files and scripts. Every `.ts`/`.vue` file belongs to exactly one project: type-aware lint fails
  ("not found by the project service") on a file no tsconfig includes, and that file was never typechecked either.
- `.prettierrc.json` is vendored (read-only). Prettier skips `.gitignore`d paths, `.standards/`, lock and
  suppression files; repo-specific ignores go in a root `.prettierignore`.
- Tool versions are exact devDependencies matching `.standards/vue-ts/check.json` `tools`; the `pins` step names the
  `npm i -D -E` command when one drifts. Bump them only with `sync.mjs bump vue-ts`, in their own PR.

## Code
- Formatting is Prettier's alone. Never add eslint-plugin-prettier or Vue layout rules.
- Every `eslint-disable*` names the rule and a reason after ` -- `; unused disables fail. `@ts-expect-error <reason>`
  only; `@ts-ignore` and `@ts-nocheck` fail.
- `<script setup lang="ts">` in every SFC. Type-aware `no-unsafe-*` rules are off for SFCs upstream (vue's fallback
  types contain `any`), so keep logic in `.ts` modules (stores, composables, lib) where every rule applies.
- Promises are awaited, returned, or explicitly discarded with `void` (no-floating-promises); never pass an async
  function where a void callback is expected (no-misused-promises).
- Indexed access is `T | undefined` (`noUncheckedIndexedAccess`): guard it; `!` only with a comment saying why it
  cannot be missing.

## Existing debt (adoption only)
- tsc errors have no ratchet: fix them in the bootstrap PR.
- ESLint debt may be frozen once with `npx eslint . --suppress-all` into a committed `eslint-suppressions.json`.
  It only shrinks: fixed violations must be pruned (`npx eslint . --prune-suppressions`; unused entries fail), and
  never re-run `--suppress-all` to turn a PR green. When a file goes over its count, every violation of that rule
  in the file is reported, not only the new one.
