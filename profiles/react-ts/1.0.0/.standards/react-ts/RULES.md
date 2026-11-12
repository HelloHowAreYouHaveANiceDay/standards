# react-ts rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Stack: React + TypeScript + Vite. One linter (ESLint), one formatter (Prettier), one typechecker (`tsc --build`).
For Node CLIs, libraries and Workers use `ts-base` instead; pick one TypeScript profile per repo.
Gate: `node .standards/check.mjs` runs, in order: pins -> `tsc --build` -> `eslint . --max-warnings 0` ->
`prettier --check .`. CI never runs `--fix`. Locally: `npx eslint . --fix` and `npx prettier --write .`.

## Setup (follower-owned files, each a few lines)
- `eslint.config.mjs`: `import standards from './.standards/react-ts/eslint.base.mjs'` then
  `export default standards(...overrides)`. Each override has a reason comment and the narrowest `files` glob.
  Only TypeScript files (`.ts .mts .cts .tsx`) are linted; plain `.js`/`.mjs` files are out of scope.
- `tsconfig.json` = `{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }] }`
  (create-vite's layout). `tsconfig.app.json` extends `./.standards/react-ts/tsconfig.app.json` and adds `include`
  (src, tests), `types` (`["vite/client"]`; TS 6 loads no `@types/*` unless listed) and `tsBuildInfoFile` under
  `node_modules/.tmp/`. `tsconfig.node.json` extends `./.standards/react-ts/tsconfig.node.json` and includes
  `vite.config.ts` and scripts, with `types: ["node"]`. Every `.ts`/`.tsx` file belongs to exactly one project:
  type-aware lint fails ("not found by the project service") on a file no tsconfig includes, and that file was never
  typechecked either. Tests belong in a project too (usually the app one, with the test runner's types added).
- `.prettierrc.json` is vendored (read-only). Prettier skips `.gitignore`d paths, `.standards/`, lock and
  suppression files; repo-specific ignores go in a root `.prettierignore`.
- Tool versions are exact devDependencies matching `.standards/react-ts/check.json` `tools`; the `pins` step names the
  `npm i -D -E` command when one drifts. Bump them only with `sync.mjs bump react-ts`, in their own PR. `react`,
  `vite`, `@vitejs/plugin-react` and the test runner are the follower's own (not pinned here).
  `typescript` stays 6.0.x until typescript-eslint supports a TypeScript release with a programmatic API (TS 7.0 has
  none).

## Code
- Formatting is Prettier's alone. Never add eslint-plugin-prettier or layout rules.
- Every `eslint-disable*` names the rule and a reason after ` -- `; unused disables fail. `@ts-expect-error <reason>`
  only; `@ts-ignore` and `@ts-nocheck` fail.
- React: `react-hooks` recommended (rules of hooks, exhaustive deps, and the React Compiler rules such as
  no setState in effects, purity, refs) and `react-refresh/only-export-components` (a component file exports components
  only, constants allowed; move hooks and helpers to their own module).
- Promises are awaited, returned, or explicitly discarded with `void` (no-floating-promises); never pass an async
  function where a void callback is expected (no-misused-promises) -- `onClick={() => void save()}`.
- `verbatimModuleSyntax`: type-only imports are written `import type`.
- Indexed access is `T | undefined` (`noUncheckedIndexedAccess`): guard it; `!` only with a comment saying why it
  cannot be missing.

## Existing debt (adoption only)
- tsc errors have no ratchet: fix them in the bootstrap PR.
- ESLint debt may be frozen once with `npx eslint . --suppress-all` into a committed `eslint-suppressions.json`.
  It only shrinks: fixed violations must be pruned (`npx eslint . --prune-suppressions`; unused entries fail), and
  never re-run `--suppress-all` to turn a PR green. When a file goes over its count, every violation of that rule
  in the file is reported, not only the new one.
