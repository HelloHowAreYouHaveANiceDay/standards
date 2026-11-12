# rust-base

Rust: rustfmt `--check` and clippy (`-D warnings`, plus `clippy::allow_attributes` and
`clippy::allow_attributes_without_reason`: suppressions are `#[expect(.., reason = "..")]`, stale ones fail), both from
one exact pinned toolchain installed by a zero-dependency vendored runner. Pairs with base.

## 1.0.0

- First release. Pin: Rust 1.99.1 (clippy 0.1.99, rustfmt 1.10.0). Lint levels are `cargo clippy -- -D ...` flags
  rather than a vendored cargo-config rustflags file (RUSTFLAGS in CI would replace it), rustfmt config is read via
  `--config-path`.
