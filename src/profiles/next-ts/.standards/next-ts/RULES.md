# next-ts rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Stack: Next.js (App or Pages router) + TypeScript. One linter (ESLint), one formatter (Prettier), one typechecker (tsc).
Gate: `node .standards/check.mjs` runs, in order: pins -> `next typegen` -> `tsc --noEmit` ->
`eslint . --max-warnings 0` -> `prettier --check .`. CI never runs `--fix`. Locally: `npx eslint . --fix` and
`npx prettier --write .`. Next 16 has no `next lint`: the ESLint CLI is the lint command (as in create-next-app).

## Setup (follower-owned files, each a few lines)
- `eslint.config.mjs`: `import standards from './.standards/next-ts/eslint.base.mjs'` then
  `export default standards(...overrides)`. Each override has a reason comment and the narrowest `files` glob.
  Delete `.eslintrc.*` and the `eslint` key of `package.json`.
- `tsconfig.json` extends `./.standards/next-ts/tsconfig.base.json` and adds `include` (`next-env.d.ts`, your
  sources, `.next/types/**/*.ts`, `.next/dev/types/**/*.ts`), `paths`, `exclude`. `next typegen` writes the route
  types and `next-env.d.ts` first, so `tsc` sees them in a clean CI checkout. Every `.ts`/`.tsx` file must be
  included: type-aware lint fails ("not found by the project service") on a file no tsconfig includes.
- `.prettierrc.json` is vendored (read-only). Prettier skips `.gitignore`d paths, `.standards/`, lock and
  suppression files; repo-specific ignores go in a root `.prettierignore`.
- Tool versions are exact devDependencies matching `.standards/next-ts/check.json` `tools`; the `pins` step names the
  `npm i -D -E` command when one drifts. `next` and `react` are yours (declared and installed, any version). Bump the
  pins only with `sync.mjs bump next-ts`, in their own PR. `eslint-config-next` must match your `next` major.

## Code
- Formatting is Prettier's alone. Never add eslint-plugin-prettier.
- Every `eslint-disable*` names the rule and a reason after ` -- `; unused disables fail. `@ts-expect-error <reason>`
  only; `@ts-ignore` and `@ts-nocheck` fail.
- Rules: eslint-config-next core-web-vitals (react, react-hooks, jsx-a11y, @next/next, import) plus
  typescript-eslint `recommendedTypeChecked` on TS files. Promises are awaited, returned, or discarded with `void`.
- Plain `.js`/`.mjs` config files are linted by the Next rules only (no type-aware rules).
- Indexed access is `T | undefined` (`noUncheckedIndexedAccess`): guard it; `!` only with a comment saying why it
  cannot be missing.

## Existing debt (adoption only)
- tsc errors have no ratchet: fix them in the bootstrap PR.
- ESLint debt may be frozen once with `npx eslint . --suppress-all` into a committed `eslint-suppressions.json`.
  It only shrinks: fixed violations must be pruned (`npx eslint . --prune-suppressions`; unused entries fail), and
  never re-run `--suppress-all` to turn a PR green.
