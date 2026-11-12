# gha-base rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Scope: every file under `.github/` (workflows, composite actions, `dependabot.yml`) and the shell inside `run:` steps.
Pairs with `base`; any repo. Needs only Node (no Go, Python, npm or shell): `.standards/gha-base/tool.mjs` downloads the
pinned release binaries for the host, checks their sha256 against `.standards/gha-base/check.json`, extracts them
in-process and caches them under the standards cache dir. Nothing is auto-fixed in CI.

Gate: `node .standards/check.mjs` runs, in order:
1. `reasons`: every `# zizmor: ignore[...]` and `# shellcheck disable=...` comment under `.github/` has a reason.
2. `actionlint -shellcheck=<pinned shellcheck> -oneline`: workflow syntax, expressions, contexts, action inputs,
   runner labels, and shellcheck on `run:` scripts (bash/sh steps; pwsh/cmd steps are not shell-checked).
3. `zizmor --offline --persona=regular --min-severity=low .`: security audit (unpinned actions, template injection,
   excessive permissions, credential persistence, dangerous triggers, cache poisoning, ...). Informational findings are
   hidden; everything from `low` up fails. `--offline` means no token and no network at lint time. Unless the follower
   has its own zizmor config (see Overrides), the runner adds `--config .standards/gha-base/zizmor.yml`, the pinning
   policy below.

## Workflow code
- Pin every third-party `uses:` to a full commit SHA with the tag in a trailing comment (`uses: owner/action@<40 hex> # v5.0.0`);
  let Dependabot (`github-actions` ecosystem, with a `cooldown`) bump them. GitHub-owned actions (`actions/*`, `github/*`)
  may stay tag-pinned (`actions/checkout@v4`); SHA-pinning them is welcome, never required. Local `./` actions need no pin.
  (spec--ci-standards S2; this is the vendored `zizmor.yml` policy: `actions/*` and `github/*` ref-pin, everything else hash-pin.)
- Declare `permissions:` at the workflow top (`contents: read`, or `{}`) and widen per job only where needed.
- `actions/checkout` gets `persist-credentials: false` unless a later step pushes with that credential.
- Never put `${{ ... }}` of untrusted data (`github.event.*.title/body/ref/head_ref`, inputs, matrix, step outputs) inside
  a `run:` or `script:`; pass it through `env:` and use `"$VAR"`.
- Quote shell variables; use `set -euo pipefail` for multi-line bash; append to `$GITHUB_OUTPUT`/`$GITHUB_ENV` with
  quoted redirects.

## Overrides (follower-owned, outside `.standards/`, each with a reason comment)
- actionlint: `.github/actionlint.yaml` (native; found automatically). Use it for custom self-hosted runner labels
  (`self-hosted-runner: labels: [...]`) and, last resort, `paths: "<glob>": ignore: [regex]`.
- zizmor: `.github/zizmor.yml` (native; found automatically): `rules.<id>.ignore: [file.yml:line]` or per-rule `config:`
  (for example the `unpinned-uses` policy). Inline: `# zizmor: ignore[rule] <reason>` on the flagged span.
  A follower-owned zizmor config (`.github/zizmor.yml|yaml` or `zizmor.yml|yaml`) REPLACES the vendored
  `.standards/gha-base/zizmor.yml` (zizmor loads one config), so the runner then passes no `--config`. Such a file must
  keep the `unpinned-uses` policy at least as strict as the vendored one (third-party `*: hash-pin`; only GitHub-owned
  owners may be `ref-pin`) and must not disable `artipacked`.
- shellcheck: `# shellcheck disable=SCnnnn # <reason>` directly above the command inside the `run:` script.
- Never disable a rule family repo-wide to turn a PR green; the narrowest file/line, always with a reason.
  Ignores are not checked for staleness by either tool: delete them when the code they covered is gone.

## Existing debt (adoption only)
- No ratchet exists in these tools: fix in the bootstrap PR. Order: actionlint (cheap), then `permissions`,
  `persist-credentials`, template injection, then SHA-pinning (mechanical; pin with the tag as a comment).
- `zizmor --fix` can apply some fixes locally (`--fix=safe`); review the diff. It is never run in CI.
- Tool pins change only with `sync.mjs bump gha-base`, in their own PR: a new actionlint/zizmor release can add
  findings to unchanged workflows.
