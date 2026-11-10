# go-base

Standalone golangci v2 config (errcheck, govet, staticcheck, unused, ineffassign, nolintlint) + go vet + gofmt.
Pick go-base OR go-strict (both generate `.golangci.yml`).

## 1.0.0

- First release. golangci-lint v2.12.2 (host build, ratchet `--new-from-merge-base=origin/main`); nolintlint
  `require-explanation` + `require-specific`. golangci's cache is per checkout (`checkoutCacheEnv`) so the
  ratchet never reuses another checkout's file paths.
