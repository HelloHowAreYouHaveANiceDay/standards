# go-strict

energy-cli's golangci v2 config (go-base linters + gosec, gocritic, exhaustive, misspell, bodyclose) + nolintlint,
go vet, gofmt. Standalone: not layered on go-base.

## 1.0.0

- First release, from energy-cli `.golangci.yml` (2026-06-14) plus nolintlint `require-explanation` +
  `require-specific`. golangci-lint v2.12.2 (host build, ratchet `--new-from-merge-base=origin/main`;
  per-checkout golangci cache via `checkoutCacheEnv`).
