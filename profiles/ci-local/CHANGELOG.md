# ci-local

Builder-side CI (spec `_design-ci/spec-builder-side-ci.v3.md`, slice S0a): the vendored, zero-dependency
`.standards/ci-local/ci.mjs`, driven by the repo-owned manifest `ci/suites.json`. The harness runs `run`, `sign` and
`publish`; `verify` / `status` are the mechanical gate. The gate in the follower's own CI only lints the manifest
and allowed signers (`check-manifest`); no tests run on GitHub.

## 1.0.0

- First release. Verbs: `run` (clean detached checkout, `--checkout` makes one; suites for this host's OS;
  record `record.<os>.json` keyed by tree + toolchain + ci-local version; reuse of a passing record in `--out`),
  `sign` (`ssh-keygen -Y sign`, namespace `ci-result@hhay`), `publish` (`refs/ci/<tree>`, keeps the other OS
  records; each publish is a new commit whose parent is the previous ref commit, so pushes are fast-forwards),
  `verify` (signature vs the default branch's `.standards/ci-local/allowed_signers.org`, tree binding, toolchain,
  required suites, `os_required`; exit 0 pass, 1 fail with named reasons, 2 pending), `status` (POST commit status
  `builder-ci`; `--dry-run` prints the request; token from `GH_TOKEN`/`GITHUB_TOKEN`), `check-manifest`.
- Envelope `{ok,result}` / `{ok:false,error:{code,message}}` with `--json`. Exit: 0, 1, 2 (verify pending),
  3 error, 64 usage.
- Manifest extension over the spec: suite field `if_exists` (list of repo paths). If any is absent the suite is
  recorded `skipped:absent`; verify rejects that status when the files exist at the head.
- Not in 1.0.0: `ci init` (workflow -> manifest drafting); reuse from `refs/ci/<tree>` (only the local `--out`
  record is reused); label lookup for `--pr` (pass `--approved`, the human `ci-manifest-approved` label).
- Windows and Linux tested. macOS paths are written and UNTESTED.
- `allowed_signers.org` ships with no keys; harness hosts enroll theirs in a later slice.
- Path deviation from the spec: files live under `.standards/ci-local/` (`ci.mjs`, `allowed_signers.org`), not
  `.standards/ci/`, because sync.mjs only lets a profile write `.standards/<its own name>/`. The fail-closed
  manifest diff covers `ci/suites.json`, `.standards/ci-local` and `.github`.
