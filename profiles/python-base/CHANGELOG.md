# python-base

Python: Ruff for lint (`ruff check`, defaults E4/E7/E9/F + B, I, UP, PGH004, RUF100) and format (`ruff format --check`),
exact-pinned and sha256-verified, downloaded from GitHub releases by a zero-dependency node runner (no Python, uv or
pip needed). Follower `ruff.toml` extends the vendored one. Pairs with base.

## 2.0.0

Major: U1-U4 can fail unchanged code, so followers move only by an explicit `sync.mjs bump` (spec--python-uv D-uv3).

- New gate step `uv` (`tool.mjs uv`, zero-dep, minimal TOML scan), after `config`: U1 a project `pyproject.toml` has a
  `uv.lock` (beside it or in a uv-workspace root); U2 no `poetry.lock` / `Pipfile*` / `setup.py` / `setup.cfg` /
  `environment.yml` / `requirements*.txt` (allowed: a `uv export` file, or first line `# standards-allow U2: <reason>`);
  U3 root `.python-version` is `3.N[.M]`; U4 `[tool.uv] required-version = "==X.Y.Z"` in root `pyproject.toml` or `uv.toml`.
- RULES.md: the U rules, allow form, uv dev guidance; "No Python, uv or pip needed" now says the gate needs none, the project uses uv.
- Ruff pin, archives, `ruff.toml` and the config/ruff steps are unchanged (the gate stays host-free).

## 1.0.0

- First release (prior art: Ruff docs "Rule selection" and "Configuring Ruff"). Pin: ruff 0.17.4 with per-platform
  archive sha256 for linux/windows/macos, x64 and arm64. Gate: `config` (follower config extends the vendored one),
  `ruff check --no-fix`, `ruff format --check`. No type checker (open fork).
