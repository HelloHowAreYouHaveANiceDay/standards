# base

Root `.editorconfig` + `.gitattributes`, the gate `.standards/check.mjs` and the agent rules `.standards/RULES.md`.
Every follower takes base first: it vendors check.mjs and makes the worktree LF.

## 1.0.0

- First release: `.editorconfig` (root, utf-8, LF, final newline, trim trailing whitespace; tabs for Go/Make,
  4 spaces for C#/Python/Rust/PowerShell, 2 elsewhere, CRLF for .bat/.cmd), `.gitattributes`
  (`* text=auto eol=lf` + binary types), zero-dependency `.standards/check.mjs`, `.standards/RULES.md`.
  check.json `checkoutCacheEnv: <VAR>` points a tool's cache at `<git dir>/standards-cache/<id>` (never shared
  between checkouts).
