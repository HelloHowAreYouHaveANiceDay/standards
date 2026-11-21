# base

## 1.1.3

- Fix config ratchet to also ratchet the generated `.golangci.yml` content itself (base vs head), closing the bypass where a linter drop in the generated file is hidden by updating the overlay stamp and touching `.golangci.local.yml` with a comment-only change.
- Fix config ratchet to strip YAML quotes from key-value pair values so a threshold raised to a quoted number (e.g. `threshold: "200"`) is correctly caught.

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
