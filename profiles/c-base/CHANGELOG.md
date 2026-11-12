# c-base

C/C++ formatting: a vendored root `.clang-format` (Google style) and a `clang-format --dry-run --Werror` gate over
the repo's own C/C++ files, with the exact-pinned clang-format installed from its sha256-verified PyPI wheel by a
zero-dependency node runner (no pip/uv/npm, Windows + Linux). Vendored code is excluded via the follower-owned
`.clang-format-ignore`. Pairs with base.

## 1.0.0

- First release (prior art: Google C++ style guide, clang-format's built-in `Google` style, the `clang-format` PyPI
  distribution of the LLVM release). Pin: clang-format 23.1.5. No static-analysis gate (clang-tidy / `-Wall -Werror`
  need the follower's build); see RULES.md.
