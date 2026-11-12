# c-base -- rules

Formatting for the repo's **own** C and C++ (`.c .h .cc .cpp .cxx .c++ .hh .hpp .hxx .h++ .ipp .inl .tpp`). Pairs with
`base`. The gate is `node .standards/c-base/tool.mjs format`, run by `node .standards/check.mjs`.

## What is checked

- `clang-format --dry-run --Werror --style=file` over every git-listed (tracked, or untracked and not ignored) C/C++
  file, minus `.clang-format-ignore`. Findings print as `file:line:col: error: code should be clang-formatted`.
  Nothing is ever auto-fixed in CI. Locally: `node .standards/c-base/tool.mjs bin` prints the pinned binary; run it
  with `-i --style=file <files>`.
- Style: the vendored root `.clang-format` = `BasedOnStyle: Google` + `LineEnding: LF` + `InsertNewlineAtEOF`.
  2-space indent matches the base `.editorconfig`.
- Suppression: `// clang-format off: <reason>` ... `// clang-format on`. A reasonless `off`, or an `off` that is never
  switched back on (it would silently stop formatting the rest of the file), fails.
- A repo with no own C/C++ files passes ("nothing to check"); the tool is not downloaded then.

## The tool

clang-format is pinned **exactly** in `.standards/c-base/check.json` (`tools`) and installed from its official PyPI wheel:
the per-platform wheel URL + sha256 are pinned there too (`wheels`), the download is verified, the binary is
extracted into the standards cache (`STANDARDS_CACHE`, default `%LOCALAPPDATA%\standards\cache` / `~/.cache/standards`)
and re-verified against its recorded sha256 and `--version` on every run. No pip, uv, npm, apt or choco; works the same
on windows-latest and ubuntu-latest (also macOS, linux/musl, arm64). Output differs between clang-format majors, so
a developer's own IDE clang-format may disagree: use the pinned one.

## Overrides (follower-owned, outside `.standards/`)

- **Vendored / third-party / generated code**: `.clang-format-ignore` at the repo root, one glob per line, `#`
  comments. Patterns are globs, not gitignore: `*` and `?` stop at `/`, `**` crosses it, paths are relative to the repo
  root, a bare `third_party/` matches nothing: write `third_party/**`. Give a reason comment.
- **A different style for one subtree**: a nested `.clang-format` there with `BasedOnStyle: InheritParentConfig`
  and a reason comment per key.
- Never edit the root `.clang-format` (locked by `.standards/c-base.SHA256SUMS`).

## Not in 1.0.0 (open forks)

clang-tidy / compiler warnings need the follower's `compile_commands.json` or full build, so they are not a gate here.
