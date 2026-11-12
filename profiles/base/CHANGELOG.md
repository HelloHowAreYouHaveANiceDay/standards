# base

Root `.editorconfig` + `.gitattributes`, the gate `.standards/check.mjs` and the agent rules `.standards/RULES.md`.
Every follower takes base first: it vendors check.mjs and makes the worktree LF.

## 1.1.1

- Tighten the config ratchet's line reporting and limit pinned-kit reads to changed profile content.

## 1.1.0

- Add a config ratchet to the follower gate: reject increased ESLint suppressions, weaker golangci overlays, removed or downgraded standards profiles, opt-outs, and edits to pinned kit files.

## 1.0.0

- First release: `.editorconfig` (root, utf-8, LF, final newline, trim trailing whitespace; tabs for Go/Make,
  4 spaces for C#/Python/Rust/PowerShell, 2 elsewhere, CRLF for .bat/.cmd), `.gitattributes`
  (`* text=auto eol=lf` + binary types), zero-dependency `.standards/check.mjs`, `.standards/RULES.md`.
  check.json `checkoutCacheEnv: <VAR>` points a tool's cache at `<git dir>/standards-cache/<id>` (never shared
  between checkouts).

## 1.1.2

- Close config ratchet bypasses for kit source changes, generated config edits, newly added thresholds, and golangci skip exclusions.
