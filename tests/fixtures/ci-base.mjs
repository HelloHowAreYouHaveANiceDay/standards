// ci-base fixture: one compliant workflow per stack (Go, TS/Workers, React+Firebase, Python/uv, .NET, Rust) that passes
// the vendored wf.mjs, plus injected violations -- one or more per MUST rule -- each failing with the right id and
// file:line. The compliant files double as copy sources (spec--ci-standards section 7). wf.mjs is data-only and offline,
// so this fixture needs no downloads; actionlint/zizmor are gha-base's job.
import fs from 'node:fs';
import path from 'node:path';

const MAIN = '${{ fromJSON(github.event_name == \'push\' && (vars.MAIN_RUNS_ON || \'["self-hosted","deploy"]\') || (vars.LINUX_RUNS_ON || \'["self-hosted","Linux","X64"]\')) }}';
const WIN = '${{ fromJSON(github.event_name == \'push\' && (vars.MAIN_RUNS_ON || \'["self-hosted","deploy"]\') || (vars.WINDOWS_RUNS_ON || \'["self-hosted","Windows","X64"]\')) }}';
const EMU = '${{ fromJSON(vars.LINUX_EMULATOR_RUNS_ON || \'["self-hosted","Linux","X64","emulators"]\') }}';
const REVIT = '${{ fromJSON(vars.REVIT_RUNS_ON || \'["self-hosted","Windows","revit"]\') }}';
const GROUP = '${{ github.workflow }}-${{ github.run_attempt == 1 && (github.event.pull_request.number || github.ref) || github.sha }}';
const CANCEL = "${{ github.event_name == 'pull_request' }}";

export const header = (on = '  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n') => `name: CI
on:
${on}permissions:
  contents: read
concurrency:
  group: ${GROUP}
  cancel-in-progress: ${CANCEL}
`;

// ci-ok: if: always(), needs every PR job, fails on failure/cancelled (results passed through env, not expanded in run:)
export const ciOk = (needs, runsOn = MAIN) => `  ci-ok:
    if: always()
    needs: [${needs.join(', ')}]
    runs-on: ${runsOn}
    timeout-minutes: 5
    steps:
      - name: Fail if a needed job failed or was cancelled
        env:
          RESULTS: \${{ join(needs.*.result, ' ') }}
        run: |
          case " $RESULTS " in *" failure "*|*" cancelled "*) exit 1 ;; esac
`;

const checkout = '      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false\n';

export const GO = `${header()}jobs:
  test:
    runs-on: ${MAIN}
    timeout-minutes: 20
    steps:
${checkout}      - uses: actions/setup-go@v6
        with:
          go-version-file: go.mod
          cache: false
      - run: go vet ./...
      - run: go test -count=1 ./...
  standards:
    runs-on: ${MAIN}
    timeout-minutes: 10
    steps:
${checkout}      - run: node .standards/check.mjs
${ciOk(['test', 'standards'])}`;

// TS/Astro + Workers: build / browser (PR) / deploy-preview (PR) / deploy (main) / ci-ok
export const TS_WORKERS = `${header()}jobs:
  build:
    runs-on: ${MAIN}
    timeout-minutes: 20
    steps:
${checkout}      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
      - run: npm ci
      - run: npm run typecheck && npm run lint && npm test && npm run build
  browser:
    if: github.event_name == 'pull_request'
    needs: build
    runs-on: ${MAIN}
    timeout-minutes: 30
    steps:
${checkout}      - run: npm ci
      - run: npx playwright install chromium
      - run: npx playwright test --workers=2
  deploy-preview:
    if: github.event_name == 'pull_request' && github.actor != 'dependabot[bot]'
    needs: build
    runs-on: ${MAIN}
    timeout-minutes: 10
    steps:
${checkout}      - run: npx wrangler versions upload
  deploy:
    if: github.event_name == 'push'
    needs: build
    environment: production
    runs-on: ${MAIN}
    timeout-minutes: 15
    steps:
${checkout}      - id: ship
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      - name: Live serves this build
        if: always()
        env:
          SHA: \${{ github.sha }}
        run: |
          for i in 1 2 3 4 5 6; do
            curl -fsS https://example.com/version.json | grep -qF "$SHA" && exit 0
            sleep 10
          done
          exit 1
${ciOk(['build', 'browser', 'deploy-preview', 'deploy'])}`;

// React + Firebase: changes -> unit / emulators (PR) / e2e (PR) -> deploy -> ci-ok
export const REACT_FIREBASE = `${header()}jobs:
  changes:
    runs-on: ${MAIN}
    timeout-minutes: 5
    outputs:
      app: \${{ steps.filter.outputs.app }}
    steps:
${checkout}      - id: filter
        run: echo "app=true" >> "$GITHUB_OUTPUT"
  unit:
    needs: changes
    runs-on: ${MAIN}
    timeout-minutes: 20
    steps:
${checkout}      - run: npm ci
      - run: npm test
      - run: npm run build
  emulators:
    if: github.event_name == 'pull_request'
    needs: changes
    runs-on: ${EMU}
    timeout-minutes: 30
    steps:
${checkout}      - run: npm ci
      - run: npx firebase emulators:exec --only firestore,auth --project demo-app "npm run test:rules"
  e2e:
    if: github.event_name == 'pull_request'
    needs: unit
    runs-on: ${MAIN}
    timeout-minutes: 30
    steps:
${checkout}      - run: npm ci
      - run: npx playwright test
  deploy:
    if: \${{ !cancelled() && !contains(needs.*.result, 'failure') && github.event_name == 'push' }}
    needs: [unit, emulators, e2e]
    environment: production
    runs-on: ${MAIN}
    timeout-minutes: 15
    steps:
${checkout}      - run: npm ci && npm run build
      - id: ship
        continue-on-error: true
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: \${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: \${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          channelId: live
      - name: Live serves this build
        if: steps.ship.outcome == 'success' || steps.ship.outcome == 'failure'
        env:
          SHA: \${{ github.sha }}
        run: curl -fsS https://app.example.com/version.json | grep -qF "$SHA"
${ciOk(['changes', 'unit', 'emulators', 'e2e'])}`;

export const PYTHON_UV = `${header()}jobs:
  lint:
    runs-on: ${MAIN}
    timeout-minutes: 10
    steps:
${checkout}      - uses: astral-sh/setup-uv@v7
        with:
          enable-cache: false
      - run: uv sync --locked
      - run: uv run ruff check .
  test:
    runs-on: ${MAIN}
    timeout-minutes: 20
    steps:
${checkout}      - uses: astral-sh/setup-uv@v7
        with:
          enable-cache: false
      - run: uv sync --locked
      - run: uv run pytest -n 4
${ciOk(['lint', 'test'])}`;

// .NET + Revit: build (Windows) -> revit-live (Revit runner, PR only) -> ci-ok
export const DOTNET = `${header()}jobs:
  build:
    runs-on: ${WIN}
    timeout-minutes: 30
    steps:
${checkout}      - uses: actions/setup-dotnet@v5
        with:
          global-json-file: global.json
      - run: dotnet restore --locked-mode
      - run: dotnet build --no-restore -c Release
      - run: dotnet test --no-build -c Release
  revit-live:
    if: github.event_name == 'pull_request'
    needs: build
    runs-on: ${REVIT}
    timeout-minutes: 45
    steps:
${checkout}      - run: dotnet test --filter Category=RevitLive
${ciOk(['build', 'revit-live'], WIN)}`;

export const RUST = `${header()}jobs:
  check:
    runs-on: ${MAIN}
    timeout-minutes: 30
    steps:
${checkout}      - run: cargo fmt --check
      - run: cargo clippy --locked -- -D warnings
      - run: cargo test --locked
${ciOk(['check'])}`;

export const STACKS = { go: GO, 'ts-workers': TS_WORKERS, 'react-firebase': REACT_FIREBASE, 'python-uv': PYTHON_UV, dotnet: DOTNET, rust: RUST };

export const ACTIONLINT = '# fixture: the repo declares a dedicated main lane\nself-hosted-runner:\n  labels:\n    - deploy\n    - emulators\n    - revit\n';

const WF = (f) => `.github/workflows/${f}`;
const INJ = WF('inj.yml');

export const files = () => {
  const out = { '.github/actionlint.yaml': ACTIONLINT };
  for (const [k, v] of Object.entries(STACKS)) out[WF(`ci-${k}.yml`)] = v;
  return out;
};

// replace `from` with `to` exactly once (the fixture text must contain `from`)
export const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`fixture bug: ${JSON.stringify(from)} not in the workflow`);
  return text.replace(from, () => to);
};
// 1-based line of the nth occurrence of `needle`
export const lineOf = (text, needle, nth = 1) => {
  let at = -1;
  for (let i = 0; i < nth; i++) { at = text.indexOf(needle, at + 1); if (at < 0) throw new Error(`fixture bug: ${JSON.stringify(needle)} #${nth} not found`); }
  return text.slice(0, at).split('\n').length;
};

// One injected violation per entry: mutated workflow text, expected rule id and the needle whose line must be named.
export const INJECTIONS = [
  { id: 'C1', what: 'a PR workflow without concurrency', text: swap(TS_WORKERS, /concurrency:\n {2}group: .*\n {2}cancel-in-progress: .*\n/.exec(TS_WORKERS)[0], ''), needle: 'on:' },
  { id: 'C1', what: 'a concurrency group without github.workflow', text: swap(TS_WORKERS, `group: ${GROUP}`, "group: ci-${{ github.event.pull_request.number || github.ref }}"), needle: 'concurrency:' },
  { id: 'C1', what: 'cancel-in-progress: true on a workflow that also runs on main', text: swap(TS_WORKERS, `cancel-in-progress: ${CANCEL}`, 'cancel-in-progress: true'), needle: 'concurrency:' },
  { id: 'C2', what: 'a job without timeout-minutes', text: swap(TS_WORKERS, '  build:\n    runs-on: ' + MAIN + '\n    timeout-minutes: 20\n', '  build:\n    runs-on: ' + MAIN + '\n'), needle: '  build:' },
  { id: 'C2', what: 'timeout-minutes above 60', text: swap(TS_WORKERS, 'timeout-minutes: 30', 'timeout-minutes: 90'), needle: 'timeout-minutes: 90' },
  { id: 'G1', what: 'a CI workflow without ci-ok', text: swap(TS_WORKERS, ciOk(['build', 'browser', 'deploy-preview', 'deploy']), ''), needle: 'jobs:' },
  { id: 'G1', what: 'ci-ok that does not need every PR job', text: swap(TS_WORKERS, 'needs: [build, browser, deploy-preview, deploy]', 'needs: [build, deploy]'), needle: '  ci-ok:' },
  { id: 'G1', what: 'ci-ok without if: always()', text: swap(TS_WORKERS, '  ci-ok:\n    if: always()\n', '  ci-ok:\n'), needle: '  ci-ok:' },
  { id: 'G1', what: 'a workflow-level paths filter on the pull_request of a ci-ok workflow', text: swap(TS_WORKERS, '  pull_request:\n    branches: [main]\n', '  pull_request:\n    branches: [main]\n    paths: [src/**]\n'), needle: 'paths: [src/**]' },
  { id: 'G2', what: 'a Playwright step in a job that runs on push to main', text: swap(TS_WORKERS, '      - run: npm run typecheck && npm run lint && npm test && npm run build\n', '      - run: npm run typecheck && npm run lint && npm test && npm run build\n      - run: npx playwright test\n'), needle: '      - run: npx playwright test\n      - id' , nth: 1, firstOf: '      - run: npx playwright test\n' },
  { id: 'G2', what: 'a Firebase emulator step on push to main', text: swap(REACT_FIREBASE, '  unit:\n    needs: changes\n    runs-on: ' + MAIN + '\n    timeout-minutes: 20\n    steps:\n' + checkout + '      - run: npm ci\n', '  unit:\n    needs: changes\n    runs-on: ' + MAIN + '\n    timeout-minutes: 20\n    steps:\n' + checkout + '      - run: npx firebase emulators:exec "npm test"\n'), needle: 'emulators:exec "npm test"' },
  { id: 'G6', what: 'a main job that needs a PR-only job without the failure check', text: swap(REACT_FIREBASE, "    if: ${{ !cancelled() && !contains(needs.*.result, 'failure') && github.event_name == 'push' }}\n", "    if: github.event_name == 'push'\n"), needle: 'needs: [unit, emulators, e2e]' },
  { id: 'G6', what: 'a main job that needs a PR-only job through a chain', text: swap(TS_WORKERS, '  deploy:\n    if: github.event_name == \'push\'\n    needs: build\n', '  deploy:\n    if: github.event_name == \'push\'\n    needs: deploy-preview\n'), needle: 'needs: deploy-preview' },
  { id: 'L1', what: 'a vars.* runs-on without a literal fallback', text: swap(TS_WORKERS, `(vars.MAIN_RUNS_ON || '["self-hosted","deploy"]')`, 'vars.MAIN_RUNS_ON'), needle: 'runs-on:' },
  { id: 'L1', what: 'a runs-on fallback that is not JSON', text: swap(TS_WORKERS, `'["self-hosted","Linux","X64"]'`, `'[self-hosted, Linux'`), needle: 'runs-on:' },
  { id: 'L1', what: 'a main job off the declared deploy lane', text: swap(TS_WORKERS, '  deploy:\n    if: github.event_name == \'push\'\n    needs: build\n    environment: production\n    runs-on: ' + MAIN + '\n', '  deploy:\n    if: github.event_name == \'push\'\n    needs: build\n    environment: production\n    runs-on: [self-hosted, Linux, X64]\n'), needle: 'runs-on: [self-hosted, Linux, X64]' },
  { id: 'D2', what: 'a deploy job without a live-verify step', text: swap(TS_WORKERS, /      - name: Live serves this build\n[\s\S]*?exit 1\n/.exec(TS_WORKERS)[0], ''), needle: 'run: npx wrangler deploy' , firstOf: '      - id: ship\n' },
  { id: 'D2', what: 'continue-on-error on the deploy step with no live-verify step', text: swap(swap(REACT_FIREBASE, /      - name: Live serves this build\n[\s\S]*?grep -qF "\$SHA"\n/.exec(REACT_FIREBASE)[0], ''), '        continue-on-error: true\n', '        continue-on-error: true\n'), needle: 'uses: FirebaseExtended/action-hosting-deploy@v0', firstOf: '      - id: ship\n' },
  { id: 'D2', what: 'a live-verify step that is continue-on-error', text: swap(TS_WORKERS, '      - name: Live serves this build\n        if: always()\n', '      - name: Live serves this build\n        if: always()\n        continue-on-error: true\n'), needle: '      - name: Live serves this build' },
  { id: 'K1', what: 'actions/setup-go without cache: false', text: swap(GO, '          cache: false\n', ''), needle: 'uses: actions/setup-go@v6' },
  { id: 'K1', what: 'actions/cache of the Go build cache', text: swap(GO, '      - run: go vet ./...\n', '      - uses: actions/cache@v5\n        with:\n          path: ~/.cache/go-build\n          key: go\n      - run: go vet ./...\n'), needle: 'uses: actions/cache@v5' },
  { id: 'S4', what: 'an ubuntu-latest fallback', text: swap(TS_WORKERS, `'["self-hosted","Linux","X64"]'`, `'"ubuntu-latest"'`), needle: 'runs-on:' },
  { id: 'S4', what: 'an ubuntu-latest literal', text: swap(RUST, '  check:\n    runs-on: ' + MAIN + '\n', '  check:\n    runs-on: ubuntu-latest\n'), needle: 'runs-on: ubuntu-latest' },
];

export const fixture = {
  id: 'ci-base',
  profiles: ['base@1.0.0', 'ci-base@1.0.0'],
  files: files(),
  inject(dir, h) {
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    for (const inj of INJECTIONS) {
      put(INJ, inj.text);
      const first = inj.firstOf ? lineOf(inj.text, inj.firstOf) : lineOf(inj.text, inj.needle, inj.nth || 1);
      const r = h.check();
      const re = new RegExp(`standards: FAIL \\[ci-base/wf\\] \\.github/workflows/inj\\.yml:(\\d+): .*\\(${inj.id}\\)`);
      const m = re.exec(r.out);
      h.step(r.code === 1 && m && Number(m[1]) === first, `${inj.what} fails ${inj.id} at inj.yml:${first}`, `${r.out}\n(expected line ${first})`);
    }

    // allow with a reason suppresses; without a reason it fails; both on the line and on the job's first line
    const lacking = swap(TS_WORKERS, '  build:\n    runs-on: ' + MAIN + '\n    timeout-minutes: 20\n', '  build:\n    runs-on: ' + MAIN + '\n');
    put(INJ, swap(lacking, '  build:\n', '  build: # standards-allow C2: fixture, bounded by the runner\n'));
    const ok = h.check();
    h.step(ok.code === 0, 'a standards-allow with a reason on the job line suppresses C2', ok.out);
    put(INJ, swap(lacking, '  build:\n', '  build: # standards-allow C2\n'));
    const bare = h.check();
    h.step(bare.code === 1 && /inj\.yml:\d+: standards-allow C2 without a reason .*\(allow\)/.test(bare.out) && /\(C2\)/.test(bare.out), 'a standards-allow without a reason fails (and does not suppress)', bare.out);

    // O3: a workflow_run naming no workflow warns but does not fail
    put(INJ, 'name: after\non:\n  workflow_run:\n    workflows: [Nope]\n    types: [completed]\njobs:\n  x:\n    runs-on: [self-hosted, deploy]\n    timeout-minutes: 5\n    steps:\n      - run: echo ok\n');
    const warn = h.check();
    h.step(warn.code === 0 && /standards: WARN \[ci-base\/wf\] \.github\/workflows\/inj\.yml:4: .*\(O3\)/.test(warn.out), 'an unmatched workflow_run name warns O3 at inj.yml:4 and exits 0', warn.out);

    fs.rmSync(path.join(dir, INJ));
    const clean = h.check();
    h.step(clean.code === 0, 'the compliant stack workflows pass again after the injections are removed', clean.out);
  },
};
