# standards CLI (v0) -- design

Status: v0 shipped in `standards.mjs` (this repo). Owner ask 2026-11-13: a CLI that helps agents manage standards in
repos, generic and decoupled from our org, dogfooded on our projects, a candidate bim-cli driver later.

## 1. Purpose

Agents (and people) need one way to answer, per repo: which standards apply, are they in place, what drifted, how
do I fix or bump them, and what does rule X mean. `sync.mjs` already vendors profiles and `check.mjs` gates them in
CI, but neither is agent-shaped (human text, no dry run, no drift report, and sync overwrites files it does not
own). The CLI wraps them; it adds no new storage format.

## 2. Model (generic)

    standard (= profile)  id `name`, semver `version`, released append-only under profiles/<name>/<x.y.z>/
      files               follower-relative files, byte copies, listed in SHA256SUMS (the lock)
      checks              .standards/<name>/check.json commands, run by the vendored gate check.mjs
      generated           files built from a kit file + a follower-owned overlay (golangci-merge today)
      rules               .standards/<name>/RULES.md; rule ids are table rows `| C1 | MUST | ... |`
      fixes               the tool's own --fix, run by the follower; the CLI only re-vendors files (apply)
      ratchets            tool-native only (e.g. golangci --new-from-merge-base); config ratchet: PR #17
      applies-to          v0: chosen by the follower in .standards.json. v1: optional `applies_to` selectors
                          in check.json (globs such as `go.mod`, `*.rvt`, `.github/workflows/*`) used by
                          `init --suggest` (open question 3)

    repo config  .standards.json = { "kit": <url>, "profiles": { "<name>": "<x.y.z>" } }
                 pins = the versions; overrides = the tool's native overlay files outside .standards/
                 (nested .editorconfig, .golangci.local.yml, ...), never edits to vendored files.

A file is MANAGED when a lock in `.standards/*.SHA256SUMS` lists it. Its state is one of: pristine (sha matches
the lock), hand-edited (listed, sha differs), missing. A file at a managed path that no lock lists is UNMANAGED.

## 3. Commands

All verbs: `--json` (stdout envelope `{"ok":true,"result":...}` or `{"ok":false,"error":{kind,message,...}}`),
`--root <repo>`, `--kit <path|https-url>` (default `$STANDARDS_KIT`, else the clone the CLI lives in).
Exit codes: 0 ok/clean, 1 drift / conflict / not-found, 2 usage, 3 kit or internal error.

    describe --json        verb table in the bim driver shape (name, args, effect read|verify|mutate, output)
    list                   kit profiles: versions, latest, RULES title, `adopted` version for --root
    init p@v ... [--dry-run] [--force]
                           write .standards.json, vendor, lock, add the AGENTS.md lines; refuses (exit 1,
                           kind=conflict, writes nothing) if any target path holds an unmanaged file
    check [--strict]       read-only. Findings {kind, severity, path|profile, message}:
                           error: not-adopted, modified, missing, unlisted, overlay-changed, out-of-sync
                                  (differs from the kit release), stale, kit (unreachable/tampered)
                           warn:  behind, behind-major, agents-line   (--strict makes them errors)
    apply [--dry-run] [--force]
                           re-vendor from .standards.json; idempotent; returns {write, remove, conflicts};
                           refuses to overwrite or delete hand-edited/unmanaged files unless --force
    upgrade [p ...] [--major] [--dry-run] [--force]
                           newest version within the major (all adopted profiles by default); result lists
                           per profile from/to, files added/changed/removed (lock diff) and the CHANGELOG
                           sections in between, then applies like `apply`
    explain <id|keyword>   rule text from the adopted profiles' RULES.md (every kit profile outside a
                           follower): exact id row or `(ID)` heading first, else bullets/rows containing it

Mutators verify the locks after writing (the kit's own base gate, never the follower's copy).

## 4. Decoupling

- The CLI hardcodes no org, repo list or path. The kit location comes from --kit / env / its own clone.
  Remaining org strings live in `sync.mjs` (`DEFAULT_KIT` URL written into new manifests) and README prose:
  open question 1.
- Org specifics are profiles, i.e. a profile pack: `repo-gate`, `ci-base` encode our policies; another org
  ships its own kit repo with the same layout and points `--kit` at it.
- `who.mjs` (which repos follow what) stays a separate org-side script; the CLI works on one repo at a time.

## 5. Agent discovery

`init` appends two lines to AGENTS.md (and `check` warns while they are missing):

    Standards gate: `node .standards/check.mjs`; rules in `.standards/RULES.md`.
    Standards drift: `node <standards-kit>/standards.mjs check --json` (fix: `apply`, bump: `upgrade`, rule text: `explain <id>`).

`describe --json` gives the full contract.

## 6. Future modules (not built)

- `standards ci run|post`: worker-run CI from per-repo `ci/suites.json` posting results through the GitHub App
  (spec-builder-side-ci v2). Fits as a new noun: same envelope, `effect: verify` for run, `mutate` for post.
- bim-cli driver: the verb table already matches bim describe (`effect`, `output`, kebab args, positional).
  Remaining work: a JSON-RPC 2.0 stdin/stdout entry (`describe` + one method per verb) and packaging -- either a
  Node SEA exe like bim-bro, or the in-repo Go driver route. Revit/building standards are then just profiles
  (e.g. a `revit-project` profile whose check.json runs `bim revit ...` verbs).

## 7. Open questions for the owner

1. Default kit URL. `init` still writes this repo's raw GitHub URL as `kit` (from sync.mjs). Recommend: keep it
   for now, and require `--kit` once a second kit exists; no code depends on the org name otherwise.
2. Pre-existing files at managed paths (every repo dogfooded has its own `.gitattributes`). sync.mjs overwrote
   them silently; the CLI refuses. Recommend: keep the refusal; the adopter moves its own rules into nested
   `.gitattributes` files (the documented override), then runs `init --force`.
3. `applies_to` selectors in check.json so `init --suggest` picks profiles from repo contents. Recommend: yes, as
   a minor version of each profile (additive field), after v0 is used on 2-3 more repos.
4. Packaging for agents outside a kit clone. Recommend: stay `node <kit>/standards.mjs` until the bim driver;
   no npm publish (one more release channel to keep in sync).
