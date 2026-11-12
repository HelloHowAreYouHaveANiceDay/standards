# gha-base

GitHub Actions workflows and the shell inside them: actionlint (with a pinned shellcheck on `run:` scripts) and zizmor
(security audit, regular persona), installed by a zero-dependency Node runner from sha256-pinned release binaries
(no Go, Python or npm needed), plus a suppression-reason check. Pairs with base.

## 1.1.0

- Loosening for GitHub-owned actions, aligning zizmor's pinning policy with spec--ci-standards S2 (v2, section 6e):
  third-party actions SHOULD be SHA-pinned with a `# vX.Y.Z` comment; `actions/*` and `github/*` may stay tag-pinned.
  zizmor's regular persona otherwise demands a hash-pin for every `uses:` (measured on checkmyfloodzone: 9
  `unpinned-uses` on `actions/checkout@v4` / `actions/setup-node@v4`; portfolio-wide 381/384 refs are tag-pinned).
- New vendored `.standards/gha-base/zizmor.yml` (`unpinned-uses` policies: `actions/*` and `github/*` ref-pin, `*`
  hash-pin). `tool.mjs` passes it with `--config` only when the follower has no `.github/zizmor.yml|yaml` /
  `zizmor.yml|yaml` (or `--config`/`--no-config`/`ZIZMOR_CONFIG`); a follower-owned file wins and must keep the policy at
  least this strict (RULES.md).
- `artipacked` stays on: `actions/checkout` needs `persist-credentials: false` unless a later step pushes.
- No tool pin changes (actionlint 1.7.12, shellcheck 0.11.0, zizmor 1.32.0). S1/S3 stay zizmor defaults.

## 1.0.0

- First release. Pins: actionlint 1.7.12, shellcheck 0.11.0, zizmor 1.32.0 (release archives for linux x64/arm64,
  windows x64, macOS x64/arm64, each with its sha256 in check.json). zizmor runs `--offline --persona=regular
  --min-severity=low`. Prior art: actionlint docs, zizmor docs (zizmor.sh), GitHub's runner images (shellcheck 0.9.0 is
  preinstalled on ubuntu, none on windows, hence the pin).
