# ci-local

Builder-side CI (spec `_design-ci/spec-builder-side-ci.v3.md`, slice S0a): the vendored, zero-dependency
`.standards/ci-local/ci.mjs`, driven by the repo-owned manifest `ci/suites.json`. The harness runs `run`, `sign` and
`publish`; `verify` / `status` are the mechanical gate. The gate in the follower's own CI only lints the manifest
and allowed signers (`check-manifest`); no tests run on GitHub.

## 1.3.0

A failing record is never out-voted (spec `_design-ci/spec-builder-side-ci.v5.md` section 5, "a usable record with outcome
fail ... means failure"; "one OS record failed, another passed: failure"). Gap found on factory tree 5a58e295: a host that
re-runs a tree publishes the same file name (`record.<os>.<host>.json`), so a later pass replaced its own earlier red and
`verify` posted success. `VERSION` is 1.3.0, so a tree that re-syncs re-runs once (`ci-version-mismatch`).

- `verify` also reads the older commits of `refs/ci/<tree>` and counts any FAILING record that a later publish replaced
  (same signature, tree, OS, version, toolchain and key checks as a current record). A replaced PASS is ignored; it
  changes nothing. The failure reason says `(replaced by a later record; ...)`.
- A flaky test is fixed, never out-voted: the tree stays red until a new tree (the fix) is built. Re-running a red tree
  to get green no longer works.
- Manifest schema, record schema and `allowed_signers.org` unchanged.

## 1.2.0

Stack templates and `ci init` (spec `_design-ci/spec-builder-side-ci.v5.md` 4.1, slice R1; owner go 2026-11-16). Additive:
the manifest schema is unchanged. `VERSION` is 1.2.0, so a tree that re-syncs re-runs once (`ci-version-mismatch`).

- `.standards/ci-local/templates/<stack>.json` for node, rust, python-uv, dotnet, static-site. All `os_required: "any"`,
  every suite `os: "any"`, plus a `secret-scan` suite (`node ci/scripts/secret-scan.mjs`). rust pins cargo/rustc 1.80 and
  `toolchain_os.windows.gcc`; lint / link-check suites use `npm run <x> --if-present` so a repo without the script passes.
- `templates/secret-scan.mjs`: zero-dep scan of git-tracked files for credential shapes; prints `file:line: rule`, never
  the match; `secret-scan:allow` on a line exempts it.
- New verb `ci init --stack <s> [--force]`: copies the template to `ci/suites.json` and the scanner to
  `ci/scripts/secret-scan.mjs`. Refuses an existing `ci/suites.json` (`exists`) without `--force`. Edit the pins and
  suites afterwards; `ci/` is on the fail-closed path list, so the first PR needs the manifest label.
- `allowed_signers.org` unchanged (byte-identical to 1.1.1).

## 1.1.1

Pins are minimums; a tree with no manifest is pending (spec `_design-ci/spec-builder-side-ci.v5.md`, slice A4; owner
2026-11-14). Same manifest schema, additive. `VERSION` is 1.1.1, so a tree that re-syncs re-runs once
(`ci-version-mismatch`).

- Toolchain pins are MINIMUMS: the host version must be >= the pin, compared as dotted numbers (missing parts 0), in
  `run`, `--preflight` and `verify`. rustc 1.100 against pin 1.99 is capable (it was `host-not-capable`). The record
  keeps the ACTUAL probed version. A pin that is not dotted numbers ("stable") still matches exactly.
- A pin may be `{"version": "1.99", "exact": true}` (probe optional for built-in tools) to keep the old rule: equal
  to the pin or extending it at a dot boundary. Use it only when the suite really needs that version. The lint
  accepts `exact` (boolean only).
- No manifest: `run` fails with `error.code` `no-manifest` (was `manifest-missing`); `verify` of a commit without
  `ci/suites.json` is PENDING (exit 2, "no-manifest: ci/suites.json not at <sha>", status `pending`), not a red
  `manifest-missing`. A tree with no vendored ci.mjs at all cannot run this code; the harness must map that case.
- standards' own manifest: node 22 / go 1.23 as minimums (hosted CI used those; the host has 26 / 1.26).

## 1.1.0

Any-host records (spec `_design-ci/spec-builder-side-ci.v4.md` section 5, slice A1; owner 2026-11-14: one passing
record from the building host's OS is enough, no dual-OS requirement). Additive: a tree that vendors 1.0.x keeps
verifying with its own copy; a tree that re-syncs to 1.1.0 re-runs once (`ci-version-mismatch`: records carry
`ci_local_version`, and `VERSION` now equals the profile version; 1.0.0/1.0.1 shipped `VERSION = '1.0.0'`).

- Manifest: `os_required` also takes the string `"any"` (one passing record from any OS suffices; the list form
  keeps its all-of meaning). It stays mandatory. `toolchain_os` (`{"windows": {...}}`) is merged over `toolchain`
  for that OS before probing and before verifying. The lint refuses, in all-of mode, a suite `os` that is not in
  `os_required`.
- `run`: a host whose probes are missing or mismatched writes NO record and fails with error code
  `host-not-capable` (exit 3, every gap listed); it used to write a red `toolchain-drift` record.
  `run --preflight` runs only that probe step. Harnesses key on `error.code`, not the exit code.
- Records are `record.<os>.<host-id>.json` (host-id = signer principal after `@`); a host re-running replaces only
  its own file. The legacy `record.<os>.json` is still read.
- `verify`: a record that fails any check (unsigned, bad or expired signature, wrong tree/OS/version, toolchain,
  key) is ignored and listed under `notes`; it never grants a pass. Any-mode counts every verified record, all-of
  mode the OSes in `os_required`; a usable record with outcome fail, or a failed required suite, is `fail`.
  Pending (exit 2, never mergeable): no `refs/ci/<tree>` ("no record yet"), no usable record, a missing all-of OS, or
  a required suite every usable record reports `skipped:os` ("needs a <os> host"). `skipped:os` on a record whose
  OS the suite includes is `skipped-os-abuse` (fail). `ci/` joins the fail-closed path list with
  `ci/suites.json`, `.standards/ci-local` and `.github`.
- `publish` retries the ref push 5 times with jitter (was 2), since several hosts now push one ref.
- Not in this version (spec 5.10 / owner 2026-11-14): `same_across_os` hashes, WSL enrolment, force-fetch before
  verify (slice A3, harness side).

## 1.0.1

- Enrolls the first harness signer in `allowed_signers.org`: `hermes@win1` (ed25519, namespace `ci-result@hhay`,
  `valid-before=20270212`, 90 days). No code change; `ci.mjs` is byte-identical to 1.0.0. Pilot slice S2.

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
