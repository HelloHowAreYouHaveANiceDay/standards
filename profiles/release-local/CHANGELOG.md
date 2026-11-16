# release-local

Release and deploy runner for the harness host (spec `_design-ci/spec-builder-side-ci.v5.md` 13.6, slice R1): the vendored,
zero-dependency `.standards/release-local/release.mjs`, driven by the repo-owned `ci/release.json` and `ci/deploy.json`.
No forge compute. Needs `ci-local` vendored beside it (the gate is its `ci verify`).

## 1.0.0

- `release <tag>`: version from `ci/release.json` `version_source` (json | toml | regex | first line) must equal the tag
  minus `tag_prefix` (default `v`); the checkout is clean at the tag's commit; `ci verify --sha <commit>` is green
  (`ci-pending` exit 2, `ci-not-green` exit 1); `build` steps run; `assets` are hashed into `SHA256SUMS` (also uploaded);
  `gh release create <tag> ... --verify-tag --generate-notes` with `GH_TOKEN` from the environment (`no-token`);
  `post` hooks (argv lists, `{tag}` `{version}` `{sha}` substituted, `RELEASE_*` env) run last. A failing hook reports
  `post-failed` and says the release is already published.
- `deploy <sha>`: clean checkout at `<sha>`, `ci verify` green, then `ci/deploy.json` `steps`. Env comes from
  `%LOCALAPPDATA%\hermes\deploy-secrets\<repo>.env`, else `~/.hermes/deploy-secrets/<repo>.env`
  (`HERMES_DEPLOY_SECRETS_DIR` is tried first). Values are never printed or logged (step output is redacted); no file exits
  with code `secrets-missing` unless `ci/deploy.json` has `"secrets": false`.
- `check`: lints `ci/release.json` and `ci/deploy.json` when present (the profile's check command).
- `--dry-run` runs every gate and the build (release) or stops after the gates (deploy) and publishes nothing.
- Envelope with `--json`; exit 0 ok, 1 gate failed, 2 ci pending, 3 tooling error, 64 usage.
