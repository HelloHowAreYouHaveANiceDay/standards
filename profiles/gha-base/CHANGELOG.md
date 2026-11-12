# gha-base

GitHub Actions workflows and the shell inside them: actionlint (with a pinned shellcheck on `run:` scripts) and zizmor
(security audit, regular persona), installed by a zero-dependency Node runner from sha256-pinned release binaries
(no Go, Python or npm needed), plus a suppression-reason check. Pairs with base.

## 1.0.0

- First release. Pins: actionlint 1.7.12, shellcheck 0.11.0, zizmor 1.32.0 (release archives for linux x64/arm64,
  windows x64, macOS x64/arm64, each with its sha256 in check.json). zizmor runs `--offline --persona=regular
  --min-severity=low`. Prior art: actionlint docs, zizmor docs (zizmor.sh), GitHub's runner images (shellcheck 0.9.0 is
  preinstalled on ubuntu, none on windows, hence the pin).
