# rust-base rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Stack: Rust, one Cargo workspace (or crate) at the repo root. One formatter (rustfmt), one linter (clippy), both
from the exact pinned toolchain in `.standards/rust-base/check.json` `tools.rust`.
Gate: `node .standards/check.mjs` runs, in order:
1. `cargo fmt --all --check -- --config-path .standards/rust-base/rustfmt.toml`
2. `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings -D clippy::allow_attributes -D clippy::allow_attributes_without_reason`

CI never runs `cargo fmt` without `--check`. Locally: `cargo +<pin> fmt --all -- --config-path .standards/rust-base/rustfmt.toml`.

## Toolchain
- `.standards/rust-base/tool.mjs` runs cargo as `cargo +<pin> ...` after a one-time
  `rustup toolchain install <pin> --profile minimal -c clippy -c rustfmt` (rustup is preinstalled on GitHub-hosted
  runners; the cache is rustup's own). It ignores `rust-toolchain.toml` and the runner default, and keeps the host triple
  of the toolchain already in use, so a windows-gnu repo stays gnu.
- No rustup on the runner (some self-hosted hosts): install exactly the pin yourself
  (`dtolnay/rust-toolchain@<pin>` with `components: clippy, rustfmt`); the gate then asserts `rustc -V` equals the pin.
- The pin moves only with `sync.mjs bump rust-base`, in its own PR (new compiler = new lints = new failures).
- Clippy needs the repo to build: build scripts and native deps (cmake, C++) must be available, as for `cargo build`.
  `--locked` fails when Cargo.lock is stale.

## Lints
- Levels are command-line flags, not `[lints]` and not rustflags: the kit cannot edit your Cargo.toml, and
  `RUSTFLAGS`/`build.rustflags` in CI or `.cargo/config.toml` would replace a vendored rustflags set. Flags after
  `--` reach workspace members only, never dependencies.
- `-D warnings`: every default clippy group (correctness, suspicious, style, complexity, perf) and every rustc warning.
- Suppressions use `#[expect(lint, reason = "why")]`, never `#[allow]` (`clippy::allow_attributes`), and always with a
  reason (`clippy::allow_attributes_without_reason`). An `expect` whose lint no longer fires is
  `unfulfilled_lint_expectations`, a warning, so a stale suppression fails the gate. This also applies to
  `#![expect(...)]` at a crate root.
- Narrowest scope: put the attribute on the item, not the module or crate.
- Overrides: a clippy *threshold* (`too-many-arguments-threshold`, `msrv`, ...) goes in a follower-owned
  `clippy.toml` (clippy cannot set levels there). A level change is a reasoned `#[expect]`; command-line `-D` cannot
  be relaxed from `[lints]` in Cargo.toml (the flags come last), which is intended.
- Generated code you cannot edit: keep it out of the workspace's checked targets (separate crate, `OUT_DIR` include).
  Lints that fire only inside macro expansions you do not control get a reasoned `#[expect]` on the call site.

## Formatting
- rustfmt defaults, plus `newline_style = "Unix"`. The config is read through `--config-path`; an editor that ignores
  it formats identically except for line endings (base's `.gitattributes` forces LF).
- Only workspace members reachable from `mod` declarations are checked; files that no `mod` reaches are not.

## Existing debt (adoption only)
- Neither tool has a ratchet: fix rustfmt hunks (`cargo fmt`) and clippy findings in the bootstrap PR, in that order.
- Mass `#[allow]` to turn the gate green is not debt policy: use a reasoned `#[expect]` on the item.
