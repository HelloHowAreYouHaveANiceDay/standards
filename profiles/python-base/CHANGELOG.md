# python-base

Python: Ruff for lint (`ruff check`, defaults E4/E7/E9/F + B, I, UP, PGH004, RUF100) and format (`ruff format --check`),
exact-pinned and sha256-verified, downloaded from GitHub releases by a zero-dependency node runner (no Python, uv or
pip needed). Follower `ruff.toml` extends the vendored one. Pairs with base.

## 1.0.0

- First release (prior art: Ruff docs "Rule selection" and "Configuring Ruff"). Pin: ruff 0.17.4 with per-platform
  archive sha256 for linux/windows/macos, x64 and arm64. Gate: `config` (follower config extends the vendored one),
  `ruff check --no-fix`, `ruff format --check`. No type checker (open fork).
