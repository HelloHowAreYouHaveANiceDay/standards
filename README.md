# standards

Data-only coding standards kit for the bim-cli fleet (spec: wiki `projects/spec--coding-standards.md`, D1-D12).
The kit knows no followers and runs nothing in their CI. Each follower declares profiles in `.standards.json`.
`sync.mjs` vendors byte copies plus a sha256 lock, and the follower's CI runs the vendored, zero-dependency
`node .standards/check.mjs`.

## Layout

```
profiles/<name>/<x.y.z>/        released profile (APPEND-ONLY; kit CI fails on any edit or delete)
  SHA256SUMS                    "<sha256>  <follower-relative path>", sorted; copied verbatim as the follower's lock
  <follower-relative files>     e.g. .editorconfig, .standards/check.mjs, .standards/go-strict/golangci.yml
  .standards/<name>/check.json  check fragment: profile, version, tool pins, commands, generated files
profiles/<name>/VERSIONS        released versions, one per line (read by `sync.mjs bump` over raw HTTP)
profiles/<name>/CHANGELOG.md    one `## x.y.z` heading per release
src/profiles/<name>/            working copy of the next release; `node scripts/release.mjs <name> <x.y.z>` snapshots it
sync.mjs                        init / sync / bump (run from a kit clone after `npm ci`; never in CI)
who.mjs                         read-only: which repo follows which profile@version
standards.mjs                   agent-facing CLI: describe/list/init/check/apply/upgrade/explain, --json (docs/standards-cli.md)
```

Agents: `node <kit>/standards.mjs check --json --root <repo>` reports drift (exit 1); `apply --dry-run` /
`upgrade --dry-run` show the plan; `explain <rule-id>` prints a rule. Unlike `sync.mjs`, the CLI never overwrites a
hand-edited or unmanaged file without `--force`.

Profiles (pick `base` plus at most one per language; each profile's rules: `.standards/<name>/RULES.md`):

| Profile | Stack | Gate |
|---|---|---|
| `base` | every repo | root `.editorconfig`, `.gitattributes` (LF), `.standards/check.mjs`, locks |
| `go-base` / `go-strict` | Go | go vet, gofmt, golangci-lint v2 (ratchet vs origin/main); pick one |
| `ts-base` | TypeScript (Node, CLIs, Workers) | pins, `tsc --build`, type-aware ESLint, Prettier |
| `react-ts` | React + Vite + TS | ts-base + react-hooks / react-refresh |
| `vue-ts` | Vue 3 + Vite + TS | pins, `vue-tsc --build`, type-aware ESLint + eslint-plugin-vue, Prettier |
| `next-ts` | Next.js + TS | pins, `next typegen`, `tsc`, ESLint + eslint-config-next, Prettier |
| `astro-ts` | Astro + TS | pins, `astro check`, ESLint + eslint-plugin-astro, Prettier (+ astro plugin) |
| `python-base` | Python (uv projects) | uv rules U1-U4 (uv.lock, no other lock or requirements format, `.python-version`, pinned `required-version`) + Ruff check + Ruff format (sha256-pinned binary, the gate needs no Python) |
| `rust-base` | Rust | `cargo fmt --check`, clippy `-D warnings` (pinned toolchain) |
| `rust-unsafe` | Rust (unsafe) | fail-closed `unsafe_code` allowlist, SAFETY lints, Miri job, Google unsafe review rubric (next to rust-base) |
| `dotnet-base` / `dotnet-addin` | C# / .NET (addin: net48 Revit/Rhino relaxations, used with base) | `dotnet format whitespace`, build with SDK analyzers as errors |
| `c-base` | own C/C++ | clang-format (sha256-pinned wheel), vendored code via `.clang-format-ignore` |
| `ruby-base` | Ruby (SketchUp extensions) | RuboCop + rubocop-sketchup, reasoned disables |
| `pwsh-base` | PowerShell | PSScriptAnalyzer (pinned), reasoned suppressions |
| `gha-base` | GitHub Actions workflows | actionlint + shellcheck + zizmor (sha256-pinned binaries) |
| `ci-base` | GitHub Actions pipeline shape | zero-dep `wf.mjs` (C1 C2 G1 G2 G6 L1 D2 K1 S4 P1 P2 O3 N1 P3, spec--ci-standards + spec--python-uv: Python runs through uv); use with `gha-base` |
| `repo-gate` | every factory repo (code-host gate, not lint) | CODEOWNERS block offline; `gate.mjs --repo` verifies the live ruleset (factory spec 9) |
| `mcp-connector` | every repo that exposes a remote MCP connector | zero-dep `connector.mjs` (M1-M10: manifest shape, tool names, class/annotation agreement, no read/write catch-all, no model-instruction text, schemas, transaction safety, docs/privacy present, error codes, forbidden wording); optional `--live` contract test (L1-L4, not gated); directory GUIDELINES and templates via `--scaffold` |
| `sdlc-docs` | every repo (docs of record, not lint) | zero-dep `docs.mjs` (R1-R5: README/AGENTS/CLAUDE shim, spec + ADR front matter, status, ids, approved specs); `--scaffold` copies absent templates |
| `cost-table` | data only (dim-factory pricing source) | `table.mjs --check` validates model/sub/runner rows; unknown model lookup throws |
| `ci-local` | every repo on builder-side CI (not lint) | zero-dep `ci.mjs`: run / sign / publish / verify / status (commit status `builder-ci`) over `ci/suites.json`; gate runs `check-manifest` |
| `stripe` | every repo that calls Stripe or receives its webhooks (not lint; standard: `docs/stripe.md`) | zero-dep `lint.mjs` S1-S8: no key material in git or built output, secrets never in wrangler vars, no secret behind a browser prefix, verified webhooks, rk_-only server key, declared endpoint scope (`stripe.scope.json`), no buyer PII in metadata; live account audit `scripts/stripe-audit.mjs` (harness only, read-only) |
| `analytics-web` | every web property (tier-1 user-side analytics: GA4 with GSC/Bing beside it; spec: wiki `projects/spec--analytics-standard.md`) | one follower-owned `analytics.plan.json`; zero-dep `lint.mjs` A1-A8: plan valid (FAIL), then WARN for one gtag tag, events named in the plan, no PII params, host gate, Consent Mode default + `redactUrl` page_location, no PostHog at tier 1, UTM shape; vendored `track.mjs` sink (`initAnalytics`, `track`, `redactUrl`, `initSnippet`; no PostHog call at tier 1); live audit `scripts/analytics-audit.mjs` G1-G8, S1-S4, L1-L3 (operator, read-only) and standard text `docs/analytics.md` |
| `ui-kit` | every property with a UI (design standard, not a linter of the code style; review rubric `docs/ui-kit.md`; spec: wiki `projects/spec--ui-design-standard.md`) | follower-owned `design/pack.json` + tokens; zero-dep `lint.mjs` UK1-UK8: pack manifest and vendored checksums, required `--ui-*` roles / 4px grid / touch and focus floors, WCAG AA contrast pairs per theme, `:focus-visible`, reduced motion (FAIL); ink/type budgets and raw colour literals (WARN); naming `--ui-<category>-<role>[-<variant>][-<state>]` with private `--<prefix>-*` (FAIL); `templates/pack/` neutral grey starter pack; zero-dep `ui-gen.mjs` (1.1.0): generates the static `ui.<domain>` page from the pack, with the lint's own contrast results (deploy recipe in `docs/ui-kit.md`); kit script `scripts/rename-tokens.mjs` (old->new table codemod, refuses unmapped names) |
| `firebase-web` | Firebase web apps (any language profile) | offline lint: rules tracked, not open, loaded by a rules test; no keys; pinned CLI; 2.0.0 adds F4-F11 (storage size/type, field allowlists, auth-only writes, function secrets, App Check, maxInstances, CSP/HSTS, CORS); live audit `scripts/firebase-audit.mjs` A1-A7 (operator, read-only) and standard text `docs/firebase.md` |

Tools install themselves, pinned and cross-platform (zero-dep `.standards/<name>/tool.mjs` runners or check.mjs's
`install.go`); CI never autofixes. Semver: major = unchanged code can newly fail;
minor = an autofixable or off-by-default rule, or a relaxation; patch = comments/docs.

## Follower use

```sh
git clone --depth 1 https://github.com/HelloHowAreYouHaveANiceDay/standards ~/standards && (cd ~/standards && npm ci)
cd <follower>
node ~/standards/sync.mjs init base@1.0.0 go-strict@1.0.0   # manifest, copies, locks, AGENTS.md line, CI snippet
# Vue + Firebase: init base@1.0.0 vue-ts@1.0.0 firebase-web@1.0.0, then npm i -D -E <the pins the gate names>
node ~/standards/sync.mjs sync                              # idempotent; regenerates .golangci.yml from the overlay
node ~/standards/sync.mjs bump go-strict [--major]          # newest within the major
node .standards/check.mjs                                   # the gate (CI runs this); --locks-only skips tools
```

`--kit <https-url | file:///path | path>` fetches from somewhere else (tests, pilots). Sync fetches `SHA256SUMS` and
every listed file, verifies all of them in memory, and writes nothing on any mismatch. It refuses if a locked
version's sums changed in the kit, and rejects two profiles that write the same path.

Go overrides: the follower-owned `.golangci.local.yml` (a reason comment per entry) is merged into the profile config
(lists append, maps merge, scalars replace, no remove) and written to `.golangci.yml` with a generated header. Its sha
goes to `.standards/generated.SHA256SUMS`, and the header records the overlay's sha. check.mjs therefore catches both a
hand edit of `.golangci.yml` and an overlay edited without a re-sync.

## Kit development

```sh
npm ci && npm test                        # unit tests (node --test)
node tests/fixture-sync.mjs               # sync every profile into temp repos; run check.mjs with the real tools
node scripts/append-only.mjs origin/main  # released dirs unchanged
```

To change a profile, edit `src/profiles/<name>/`, add `## x.y.z` to its CHANGELOG, then run
`node scripts/release.mjs <name> x.y.z`. Never edit a released `profiles/<name>/<x.y.z>/`.
