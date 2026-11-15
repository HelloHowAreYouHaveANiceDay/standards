# ci-base rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

GitHub Actions pipeline shape for repos on self-hosted, persistent runners. Use it **together with `gha-base`**:
gha-base runs actionlint, shellcheck and zizmor from pinned binaries; ci-base adds the rules they cannot express.
Gate: `node .standards/ci-base/wf.mjs .github/workflows`, run by `node .standards/check.mjs`. Offline, no tools to
install (a vendored single-file YAML parser is the only dependency).

Each finding prints `standards: FAIL|WARN [ci-base/wf] <file>:<line>: <message> (<id>)`. MUST rules fail the gate;
SHOULD rules warn.

## Suppression
`# standards-allow <ID>: <reason>` on the offending line, on the first line of the job (the job-id line), on the
comment-only line directly above either, or in the file's leading comment block (whole file). An allow without a
reason fails (`allow`); an allow naming an unknown id warns. Prefer fixing the workflow.

## The lane declaration (L1)
A repo declares that it has a dedicated main lane by listing the `deploy` label under `self-hosted-runner.labels` in
`.github/actionlint.yaml` (the same file gha-base's actionlint already reads, so the label is also known to the
linter). No manifest field exists or is needed. With the label declared, every job that runs on a push to main must
name `deploy` in `runs-on`; without it, only the literal-fallback half of L1 applies.

## Rules
| id | level | rule |
|---|---|---|
| C1 | MUST | A PR-triggered workflow has workflow-level `concurrency` whose group contains `github.workflow` and a PR-number-or-ref key, and `cancel-in-progress` true only for `pull_request` (`${{ github.event_name == 'pull_request' }}`; a literal `true` is fine only when the workflow never runs on main). Pattern: `group: ${{ github.workflow }}-${{ github.run_attempt == 1 && (github.event.pull_request.number \|\| github.ref) \|\| github.sha }}` |
| C2 | MUST | Every job that does not use `uses:` sets `timeout-minutes`; more than 60 needs an allow |
| G1 | MUST | A PR-triggered CI workflow (file `ci.yml`/`ci.yaml`, name `CI`, or any workflow that has a `ci-ok` job) has an aggregate job `ci-ok` with `if: always()`, `needs:` every other job that runs on PRs, that fails on `failure` and `cancelled`; that workflow has no `paths`/`paths-ignore` on `pull_request` |
| G2 | MUST | A job that runs on a push to main has no Playwright or Firebase-emulator step (detected by step text; a step whose own `if` is PR-only is skipped) |
| G6 | MUST | A job that runs on main may not `needs:` a job that is skipped on push (PR-only, directly or through a chain) unless its `if:` has `!cancelled()` and a `failure` check. `ci-ok` is exempt (G1 governs it) |
| L1 | MUST | Every `vars.X` in `runs-on` has a literal, valid-JSON fallback (`vars.X \|\| '["self-hosted","deploy"]'`); with a declared `deploy` lane, main-run jobs name it |
| D2 | MUST | A deploy job (calls `wrangler deploy`, `firebase deploy`, `FirebaseExtended/action-hosting-deploy`, `cloudflare/wrangler-action`, or has `environment:`) has a later step that runs after a failed deploy (`if: always()`, `!cancelled()` or `steps.<id>.outcome == 'failure'`) and is not `continue-on-error`; `continue-on-error` on the deploy step is allowed only with such a step. Jobs of workflows that never run on main, and PR-only jobs (previews), are exempt |
| K1 | MUST | `actions/setup-go` sets `cache: false`; no `actions/cache` for Go, uv, NuGet or cargo directories |
| S4 | MUST | No `ubuntu-latest` literal or fallback in `runs-on` or a matrix (public repos: allow comment) |
| N1 | SHOULD | `actions/setup-node` takes `node-version-file` (`.nvmrc`), not a literal `node-version` (expressions such as a matrix value are fine) |
| P1 | MUST | Python runs through uv. No `actions/setup-python` (any ref); no `shell: python`; in `run:` no command-position `python`, `python3`, `python3.N`, `py`, `pip`, `pip3`, `pipx`, `poetry`, `virtualenv`; no fetch of `astral.sh/uv/install`. Command position = line start or after `;` `&&` `\|\|` `\|` `(` `$(` `then` `do` `else` `exec` `time` `sudo` `env [VAR=x ...]`. Only bare names count: a path (`"$VENV/bin/python"`, `.venv\Scripts\python`) is allowed, as is anything after `uv run` / `uv pip` / `uvx`. Heredoc bodies and quoted strings are skipped |
| P2 | MUST | Every `astral-sh/setup-uv` step sets `enable-cache: false` and pins uv: `version:` exact `X.Y.Z` or `version-file:` |
| P3 | SHOULD | In a repo with a root `uv.lock`, `uv sync` / `uv run` (not `--no-project`, not `--script`) passes `--locked` or `--frozen`, or `UV_LOCKED` / `UV_FROZEN` is set in step, job or workflow `env` |
| O3 | SHOULD | Every `workflow_run.workflows` entry matches a workflow `name:` (or file path) in `.github/workflows` |

What counts as "runs on main": the workflow has a `push` trigger that is not tag-only and not branch-filtered away
from `main`/`master`, and the job's `if:` does not require `pull_request`. "PR-only" is a job `if:` that requires
`github.event_name == 'pull_request'` (or `!= 'push'`) without also allowing `push`.

Not machine-checked here (so no ids): K3 (no fixed ports or `fuser -k`; run-time free ports; Firebase private port
block, `ui` off), S6 (Dependabot `github-actions`, grouped, quarterly, `cooldown`; guard preview/deploy jobs with
`github.actor != 'dependabot[bot]'`), and A1/S1-S3 which gha-base's actionlint and zizmor cover.

## Guidance (review, no ids)
- **Python hosts (P1-P3).** No host Python is required or relied on: uv downloads a standalone CPython per user, with
  no elevation and no PATH dependency. Scripts: `uv run --no-project --python 3.12 python x.py` (heredoc:
  `... python - <<'EOF'`; extra packages `--with pkg==X`; a requirements file `--with-requirements f`). Projects:
  `uv sync --locked` / `uv run --locked`. uv's default per-user cache (`~/.cache/uv`, `%LOCALAPPDATA%\uv\cache`) and
  managed Pythons persist across jobs on a persistent runner and uv locks its cache, so concurrent jobs are safe: never
  set `UV_CACHE_DIR` under `$GITHUB_WORKSPACE` or `$RUNNER_TEMP`, and keep `enable-cache: false` (the setup-uv cache
  would archive the shared cache). Set `UV_PYTHON_PREFERENCE: only-managed` at workflow level so a stray host Python is
  never picked up. Third-party actions are hash-pinned under gha-base's zizmor policy, so pin setup-uv by commit sha.
  Growth: the weekly runner prune runs `uv cache prune` per runner user.
- **Push on the default branch only.** `on: push: branches: [main]`; PRs run the full suite, main runs build + unit +
  deploy + live verify.
- **Cron hygiene.** One cron per job that needs it, off the hour (`17 4 * * *`), no cron on a workflow that PRs also
  trigger; mind the platform's per-account cron limits.
- **Cheap jobs first.** Lint, typecheck and unit before browser, emulator or deploy work; `needs:` encodes it.
- **Retries belong in the test runner** (`retries` in Playwright, rerun flags), not in a workflow retry-the-job loop.
- **Build once, pass artifacts.** Upload the build output and download it in later jobs instead of re-installing.
- **Deploy the run's artifact**, the exact bytes that passed the tests, never a rebuild.
- **Rollback is a re-run of a known-good SHA**; keep a documented one-liner (`workflow_dispatch` with a `ref` input).
- **Same-repo previews only.** Guard preview deploys with
  `github.event.pull_request.head.repo.full_name == github.repository` and skip bots that get no secrets.
- **A runner outage is not a code failure.** GitHub has no queue timeout: a job waiting for an offline self-hosted runner
  sits queued for hours, then is cancelled (seen 4-10h on four repos). `timeout-minutes` (C2) only starts at job start.
  Triage a red main whose jobs were `cancelled` or never started as infra first: bring the runner back, then
  `gh run rerun --failed`; do not patch code. The rerun and the main-health watch belong to the builder (factory), not to a
  retry loop in the workflow, and there is no hosted fallback (S4 bans `ubuntu-latest`).
- **Emulators clean up after themselves.** A run cancelled mid `emulators:exec` leaves orphans holding the emulator
  ports and fails the next run on the same runner (K3: free ports at run time, a cleanup step with `if: always()`).
- **No tight wall-clock budgets in tests.** Shared runners are loaded (one suite ran 8-50 min). Assert ordering or
  relative timing, or inject a clock; if a real delay is unavoidable, give the stub at least 2x the asserted bound.
- **Log the deployed version** (commit SHA in the job summary and in a `/version` file or inlined chunk) so the D2
  verify step has something to compare.

## Per-stack layouts
| Stack | Jobs |
|---|---|
| Go | `test` (vet + test), `standards`, `ci-ok`; release by tag |
| TS/Astro + Workers | `build` (install, typecheck, lint, unit, build) / `browser` (PR) / `deploy-preview` (PR) / `deploy` (main) / `ci-ok` |
| React + Firebase | `changes` -> `unit` / `emulators` (PR) / `e2e` (PR) -> `deploy-*` -> `ci-ok` |
| Python/uv | `lint` (ruff) / `test` / `ci-ok`; every job starts with `astral-sh/setup-uv` (hash-pinned, `enable-cache: false`, pinned uv), then `uv sync --locked` / `uv run` |
| .NET + Revit | `build` (Windows) -> `revit-live` (Revit runner, PR only) -> `ci-ok` |
| Rust | `check` (fmt, clippy, test) / `ci-ok` |

The kit's `tests/fixtures/ci-base.mjs` holds one compliant workflow per stack; copy from there.
