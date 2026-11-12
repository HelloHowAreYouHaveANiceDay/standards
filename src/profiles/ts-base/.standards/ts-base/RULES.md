# ts-base rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Stack: plain TypeScript with no UI framework: Node CLIs, libraries, Cloudflare Workers, Apps Script bundles.
One linter (ESLint), one formatter (Prettier), one typechecker (`tsc --build`). For React + Vite use `react-ts`
instead; pick one TypeScript profile per repo.
Gate: `node .standards/check.mjs` runs, in order: pins -> `tsc --build` -> `eslint . --max-warnings 0` ->
`prettier --check .`. CI never runs `--fix`. Locally: `npx eslint . --fix` and `npx prettier --write .`.

## Setup (follower-owned files, each a few lines)
- `eslint.config.mjs`: `import standards from './.standards/ts-base/eslint.base.mjs'` then
  `export default standards(...overrides)`. Each override has a reason comment and the narrowest `files` glob.
  Only TypeScript files (`.ts .mts .cts .tsx`) are linted; plain `.js`/`.mjs` files are out of scope.
- `tsconfig.json` extends `./.standards/ts-base/tsconfig.json` (strictness only) and adds the runtime and the
  files. Put `tsBuildInfoFile` under `node_modules/.tmp/` so the repo stays clean. Runtime recipes:
  - Node: `"extends": ["@tsconfig/node24/tsconfig.json", "./.standards/ts-base/tsconfig.json"]`, `include: ["src"]`.
  - Bundled (esbuild, tsx, vite, rollup): add `"module": "preserve"` (or `esnext`) and `"moduleResolution": "bundler"`.
  - Cloudflare Workers: `npx wrangler types` writes `worker-configuration.d.ts` (committed; the profile skips it in
    ESLint and Prettier); set `"types": ["./worker-configuration.d.ts"]`, `lib` to `["esnext"]`.
  - Apps Script: `"lib": ["ES2020"]`, `"types": ["google-apps-script"]`.
  A second project (tests, scripts with other settings) is a second tsconfig listed in a solution-style root
  (`"files": []`, `"references": [...]`); `tsc --build` walks references. Every `.ts` file belongs to exactly one
  project: type-aware lint fails ("not found by the project service") on a file no tsconfig includes, and that file
  was never typechecked either. Tests belong in a project too.
- `.prettierrc.json` is vendored (read-only). Prettier skips `.gitignore`d paths, `.standards/`, lock and
  suppression files; repo-specific ignores go in a root `.prettierignore`.
- Tool versions are exact devDependencies matching `.standards/ts-base/check.json` `tools`; the `pins` step names the
  `npm i -D -E` command when one drifts. Bump them only with `sync.mjs bump ts-base`, in their own PR.
  `typescript` stays 6.0.x until typescript-eslint supports a TypeScript release with a programmatic API (TS 7.0 has
  none). A repo may run `tsc` 7 for builds separately; the gate's `tsc` is the pinned 6.0.x.

## Code
- Formatting is Prettier's alone. Never add eslint-plugin-prettier or layout rules.
- Every `eslint-disable*` names the rule and a reason after ` -- `; unused disables fail. `@ts-expect-error <reason>`
  only; `@ts-ignore` and `@ts-nocheck` fail.
- Promises are awaited, returned, or explicitly discarded with `void` (no-floating-promises); never pass an async
  function where a void callback is expected (no-misused-promises).
- `verbatimModuleSyntax`: type-only imports are written `import type`.
- Indexed access is `T | undefined` (`noUncheckedIndexedAccess`): guard it; `!` only with a comment saying why it
  cannot be missing.

## Existing debt (adoption only)
- tsc errors have no ratchet: fix them in the bootstrap PR.
- ESLint debt may be frozen once with `npx eslint . --suppress-all` into a committed `eslint-suppressions.json`.
  It only shrinks: fixed violations must be pruned (`npx eslint . --prune-suppressions`; unused entries fail), and
  never re-run `--suppress-all` to turn a PR green. When a file goes over its count, every violation of that rule
  in the file is reported, not only the new one.
