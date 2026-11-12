# python-base rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Stack: Python, any layout. One tool for lint and format: Ruff, exact-pinned in `.standards/python-base/check.json`.
Gate: `node .standards/check.mjs` runs, in order: `config` -> `ruff check --no-fix .` -> `ruff format --check .`.
CI never fixes. Locally: `ruff check --fix` and `ruff format` (any Ruff of the pinned version; `node
.standards/python-base/tool.mjs ruff format .` runs the exact pinned one, downloading it if needed).

## Setup (one follower-owned file)
- Root `ruff.toml` (or `[tool.ruff]` in `pyproject.toml`, or `.ruff.toml`) whose first line is
  `extend = ".standards/python-base/ruff.toml"`. The `config` step fails when the root config is missing or does not
  extend the vendored one, so the shared rules cannot be dropped by accident.
- No Python, uv or pip needed. The runner downloads the pinned Ruff release archive from GitHub releases, checks its
  sha256 against `check.json` `archives`, unpacks it into the standards cache (`$STANDARDS_CACHE`, else
  `%LOCALAPPDATA%\standards\cache` / `~/.cache/standards`), and re-hashes the binary on every use.
- Ruff reads ONE config per directory (`.ruff.toml`, else `ruff.toml`, else `pyproject.toml` `[tool.ruff]`) and a
  `ruff.toml` silently shadows `[tool.ruff]`. Move existing `[tool.ruff]` settings into `ruff.toml` (a repo that
  already ran a smaller rule set, e.g. only F401/E9, now gets the profile's set; fix the findings in the bootstrap PR).
- Ruff uses the closest config per file and does not merge it with the root one. A nested `ruff.toml` /
  `.ruff.toml` / `pyproject.toml` with `[tool.ruff]` must therefore `extend` something (e.g. `extend = "../ruff.toml"`),
  or the `config` step fails naming it.
- Drop `ruff` from the follower's own dev dependencies unless it is the pinned version: two Ruff versions
  disagree on formatting. Editors may use any Ruff; the gate always uses the pinned download.
- `target-version` is read by Ruff from `requires-python` in the follower's `pyproject.toml`; set `target-version` in
  `ruff.toml` when there is none (UP rules follow it).

## Rules (`lint.select`)
`E4 E7 E9 F` Ruff's defaults (bug-class pycodestyle, Pyflakes); `B` bugbear; `I` isort; `UP` pyupgrade;
`PGH004` blanket `# noqa` fails; `RUF100` unused `# noqa` fails.

## Overrides (native Ruff, in the follower's `ruff.toml`, under the `extend` line)
- Add rules: `[lint] extend-select = ["SIM"]`. Drop one: `[lint] ignore = ["B008"]`. A comment above each line says why.
- Per path: `[lint.per-file-ignores]` in the FOLLOWER file only. Globs in the vendored file resolve relative to
  `.standards/python-base/`, not the repo root, so the vendored file has none.
- Suppress one line with `# noqa: <CODE>` naming the rule. A bare `# noqa` fails (PGH004) and a `# noqa` that
  suppresses nothing fails (RUF100). Ruff cannot require a written reason: put it on the line above.
- Formatting is Ruff's alone (Black-compatible, line length 88). Never add Black, isort, flake8, pyupgrade next to it.

## Existing debt (adoption only)
- Ruff has no ratchet: fix every finding in the bootstrap PR (`ruff check --fix`, `ruff format`, then the rest by hand).
- Type checking (mypy / pyright / ty) is not part of this profile.
