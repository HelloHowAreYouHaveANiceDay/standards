# rust-unsafe

Fail-closed unsafe Rust on top of rust-base: `-F unsafe_code` for every workspace package not named (with a reason) in a
follower-owned `rust-unsafe.allow.json`; six blocking lints (SAFETY comments, `# Safety` docs, one unsafe op per block,
no stray safety prose) where unsafe is allowed; a pinned-nightly Miri job (`unsafe.mjs miri`); and Google's
unsafe_rust_review rubric vendored byte-identical as the review standard. Always used next to `base` and `rust-base`.

## 1.0.1

- Fix: both clippy runs pass `--no-deps`. Without it clippy also linted path-dependency workspace members that were not
  selected, with the run's flags, so a non-allowlisted package depending on an allowlisted one reported the allowlisted
  package's unsafe as RU2/RU3. Fixture gains a non-allowlisted `app` that depends on allowlisted `ffi`.

## 1.0.0

- First release. Rules RU1-RU5 (see RULES.md). Rubric: google/rust-skills `unsafe_rust_review/SKILL.md` @
  `34b87c594bf7386290a1e3698d5b8e06b6b9edd7`, sha256 `27e8df5bc9bc6f43e11747e67e695bf8ee8c4f59d6412270784d72382a4d3026`,
  with its Apache-2.0 LICENSE. Miri nightly pin: `nightly-2026-11-16` (miri component available on x86_64 linux-gnu,
  windows-msvc and windows-gnu). Allowlist entries may set `"miri": "ffi-only"` (zero executed Miri tests allowed).
- Fix: `unsafe.mjs miri` builds under a short target dir on Windows (`<drive>:\m\<8 hex of repo path>`, override
  `RUST_UNSAFE_MIRI_TARGET`). A deep runner path pushed big dependency trees (eframe) past the command-line limit, cargo
  switched to an @argfile, and cargo-miri rejected it. Miri already runs `-p` allowlisted packages only.
