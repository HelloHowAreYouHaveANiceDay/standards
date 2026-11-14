# Standards rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Gate: `node .standards/check.mjs` -- run it before pushing; CI runs the same command.
(`node .standards/check.mjs --locks-only` checks only the locks, without running tools.)

The gate compares config changes with the merge base of `origin/main`. It rejects increased ESLint suppression counts or entries, weaker `.golangci.local.yml` overrides, removed or downgraded profiles, opt-outs, and edits to files published by pinned profiles. Keep the checkout's full history and fetch `origin/main` in CI.

- Never edit anything under `.standards/`, and never edit the generated `.golangci.yml`. A `[lock]` or
  `[generated]` failure means one of them changed: restore it, or re-run sync (`node <kit>/sync.mjs sync`).
- Overrides go in the tool's native overlay file outside `.standards/`, each with a comment giving the reason:
  a nested `.editorconfig` (no `root = true`), a nested `.gitattributes`, `.golangci.local.yml` (merged by sync into
  `.golangci.yml`: lists append, scalars replace; re-run sync after editing it).
- Inline suppressions name the specific rule and a reason, e.g. `//nolint:errcheck // best-effort cleanup`.
  A bare or reasonless `//nolint` fails nolintlint.
- Profile versions change only through `sync.mjs bump <profile>`, in their own PR.
