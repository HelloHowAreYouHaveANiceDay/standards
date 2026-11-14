# ci-base

Pipeline-shape rules for GitHub Actions on self-hosted persistent runners, as a data-only profile: concurrency,
timeouts, the `ci-ok` aggregate, a PR-free main lane, cache and deploy-status honesty. One zero-dependency Node script
(`wf.mjs`, with a vendored single-file YAML parser) enforces C1 C2 G1 G2 G6 L1 D2 K1 S4 (FAIL) and O3 (WARN). Ships no
tool fetcher: use it together with `gha-base@1.0.0` for actionlint, shellcheck and zizmor. Pairs with base.

## 1.1.0

- New SHOULD rule N1 (WARN, so unchanged code cannot newly fail): `actions/setup-node` must use `node-version-file`, not a
  literal `node-version` (licfamily: a literal in the `standards` job drifted from `.nvmrc` and failed
  workflow-node-version). Expressions (matrix values) are exempt.
- RULES.md guidance from the E35 repo repairs: runner outage vs code failure (no queue timeout; rerun, no hosted
  fallback), emulator orphan cleanup, no tight wall-clock test budgets on shared runners.
- No change to the vendored parser or to C1-S4.

## 1.0.0

- First release (spec--ci-standards S2). Rules and ids as in the spec; a repo declares its `deploy` lane by listing the
  `deploy` label in `.github/actionlint.yaml`.
- Vendored `vendor/yaml.mjs`: `yaml` 2.9.1 (https://github.com/eemeli/yaml), ISC license, esbuild 0.25.0 single-file
  ESM bundle of `yaml/browser/index.js` (--bundle --format=esm --platform=neutral --legal-comments=none) with a license
  header; 209235 bytes, sha256 `ea2d389c933f2678ca79b14c009ced1e5c7a873d62987a2db0fde6a2396e6c1c`. The `yaml` library keeps
  source ranges, which is how findings carry file:line.
