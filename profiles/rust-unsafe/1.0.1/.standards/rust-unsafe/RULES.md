# rust-unsafe rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Always used next to `base` and `rust-base`. It reuses rust-base's pinned toolchain (`.standards/rust-base/tool.mjs`) and
ships no toolchain code. Fail-closed: every workspace package may not use `unsafe` unless the follower allowlists it.

Gate: `node .standards/check.mjs` runs `node .standards/rust-unsafe/unsafe.mjs check`, which runs clippy twice through
rust-base's toolchain, partitioning the workspace so each member is linted exactly once:
- Run A, packages NOT in the allowlist: `cargo clippy --locked --workspace --exclude <allowlisted> --all-targets
  --all-features -- -A warnings -F unsafe_code <six lints>`
- Run B, allowlisted packages: `cargo clippy --locked -p <allowlisted> ... -- -A warnings <six lints>`
Both runs pass `--no-deps` before `--`, so a selected package's path dependencies are not linted with that run's flags
(since 1.0.1). A run with no packages is skipped. `-A warnings` comes first so rust-base's findings are not reported twice; the named
lints still fail after it. `-F` (forbid), not `-D`: with `-D`, `#[expect(unsafe_code, reason)]` would silently bypass the
allowlist; with `-F` it is E0453.

The six blocking lints (command-line levels, like rust-base): `clippy::undocumented_unsafe_blocks`,
`clippy::missing_safety_doc`, `unsafe_op_in_unsafe_fn`, `clippy::multiple_unsafe_ops_per_block`,
`clippy::unnecessary_safety_comment`, `clippy::unnecessary_safety_doc`.

## Rules

| Rule | Where | Fails when |
|---|---|---|
| RU1 | check | `.standards/rust-base/check.json` is absent; `rust-unsafe.allow.json` is malformed, names a package not in `cargo metadata --no-deps`, has an empty reason, or a `miri` value other than `"ffi-only"` |
| RU2 | check (run A) | a non-allowlisted package uses unsafe (`unsafe_code`, incl. E0453 for an `expect`/`allow` of it) |
| RU3 | check (runs A+B) | any of the six lints fires |
| RU4 | check | the allowlist is non-empty and no tracked file under `.github/workflows/`, `ci/` or `.ci/` invokes `.standards/rust-unsafe/unsafe.mjs miri` |
| RU5 | miri | `cargo +<nightly> miri test --locked -p <pkg>` fails for an allowlisted package, or it executes 0 tests and the entry is not `ffi-only` |

`miri` builds under a short target dir on Windows (`<drive>:\m\<hash>`, override `RUST_UNSAFE_MIRI_TARGET`) so cargo never switches to an @argfile, which cargo-miri rejects.

Every failure line: `standards: FAIL [rust-unsafe/RUn] <file:line or package>: <message>`. The rustc diagnostic is printed
as is above it.

## Allowlist `rust-unsafe.allow.json` (repo root, follower-owned)

```json
{ "aah-host": { "reason": "OS host port: Job Objects, signals, cgroups", "miri": "ffi-only" },
  "aah-testkit": { "reason": "test fixtures: libc kill/_exit, env::set_var" } }
```

- Keys are cargo package names; a package covers all its targets (integration tests under `tests/` included).
- An absent file is an empty allowlist: every package is forbidden. Protect the file with CODEOWNERS.
- `miri` is optional and only `"ffi-only"`: Miri cannot execute foreign calls, so the Miri job still builds and runs but
  zero executed tests are allowed. Any other entry must execute at least one test under Miri.
- In an allowlisted package, a test that reaches FFI, a process spawn or the filesystem carries
  `#[cfg_attr(miri, ignore = "<why>")]`. A bare ignore with no reason fails review.
- RU2 from a dependency macro (E0453): allowlist that package with a reason naming the macro. Never weaken to `-D`.

## Miri (RU5)

`node .standards/rust-unsafe/unsafe.mjs miri` installs the pinned nightly once
(`rustup toolchain install <nightly> --profile minimal -c miri -c rust-src --no-self-update`, host triple kept as in
rust-base), runs `cargo +<nightly> miri setup`, then `cargo +<nightly> miri test --locked -p <pkg>` per allowlisted
package. Wire it as a required CI suite (RU4 checks the reference exists). The nightly pin is `tools.nightly` in
`.standards/rust-unsafe/check.json` and moves only with a minor release of this profile.

## Review rubric (mandatory for PRs touching unsafe)

The gate cannot see PRs, so this rule lives here and is recorded on the PR.
- Scope: any PR whose diff adds or changes a line containing `unsafe`, `SAFETY:` or `# Safety`, or that edits
  `rust-unsafe.allow.json`.
- The reviewer (agent or human) reads `.standards/rust-unsafe/unsafe_rust_review.md` and posts one review comment:
  findings as `[area.slug] file:line -- problem`, or `unsafe review: no findings (rubric @34b87c5)`.
- `[rej.miri-passes]` holds: a green Miri run is never a safety argument in a `// SAFETY:` comment.
- Followers record it with a PR template checklist line and an AGENTS.md line; gating comes from CODEOWNERS on the
  allowlist file.

## Limits (pattern checks, not proofs)

- Only the host's `cfg` is compiled: a Windows run never lints `#[cfg(unix)]` modules. A repo with per-OS unsafe runs the
  gate on each OS it ships.
- RU4 is a text search; a commented-out invocation passes.
- Miri cannot execute FFI. For `ffi-only` packages it only checks that the code builds and that the non-FFI tests run.
- Whether the rubric review happened is visible only on the PR.

## Provenance

- `unsafe_rust_review.md`: google/rust-skills `unsafe_rust_review/SKILL.md` @ `34b87c594bf7386290a1e3698d5b8e06b6b9edd7`,
  unmodified, sha256 `27e8df5bc9bc6f43e11747e67e695bf8ee8c4f59d6412270784d72382a4d3026`.
  Source: https://github.com/google/rust-skills/blob/34b87c594bf7386290a1e3698d5b8e06b6b9edd7/unsafe_rust_review/SKILL.md
- `LICENSE-unsafe_rust_review.md`: upstream `LICENSE.md` (Apache-2.0) at the same commit, verbatim. Upstream has no NOTICE file.
