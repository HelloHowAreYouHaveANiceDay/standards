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
```

Profiles: `base` (root `.editorconfig`, `.gitattributes`, `.standards/check.mjs`, `.standards/RULES.md`),
`go-base` and `go-strict` (standalone golangci v2 configs; pick one), `vue-ts` (Vue 3 + TS + Vite: type-aware ESLint,
Prettier, `vue-tsc --build`, exact pins checked offline by a zero-dep `tool.mjs`; follower-owned `eslint.config.mjs`
and `tsconfig.*.json` extend the vendored files) and `firebase-web` (offline lint: rules tracked, not open, loaded by
a rules test; no committed keys; pinned CLI). Each profile's rules: `.standards/<name>/RULES.md`. Semver: major = unchanged code can newly fail;
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
