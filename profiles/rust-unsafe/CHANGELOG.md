# rust-unsafe

Fail-closed unsafe Rust on top of rust-base: `-F unsafe_code` for every workspace package not named (with a reason) in a
follower-owned `rust-unsafe.allow.json`; six blocking lints (SAFETY comments, `# Safety` docs, one unsafe op per block,
no stray safety prose) where unsafe is allowed; a pinned-nightly Miri job (`unsafe.mjs miri`); and Google's
unsafe_rust_review rubric vendored byte-identical as the review standard. Always used next to `base` and `rust-base`.

## 1.0.0

- First release. Rules RU1-RU5 (see RULES.md). Rubric: google/rust-skills `unsafe_rust_review/SKILL.md` @
  `34b87c594bf7386290a1e3698d5b8e06b6b9edd7`, sha256 `27e8df5bc9bc6f43e11747e67e695bf8ee8c4f59d6412270784d72382a4d3026`,
  with its Apache-2.0 LICENSE. Miri nightly pin: `nightly-2026-11-16` (miri component available on x86_64 linux-gnu,
  windows-msvc and windows-gnu). Allowlist entries may set `"miri": "ffi-only"` (zero executed Miri tests allowed).
