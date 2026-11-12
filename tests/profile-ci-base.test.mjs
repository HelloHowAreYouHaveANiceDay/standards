// ci-base 1.0.0: the workflow lint (wf.mjs) rule by rule, the allow mechanism, the CLI, and the released files.
// Compliant stack workflows and injected violations come from tests/fixtures/ci-base.mjs (the same text the kit's
// fixture-sync syncs into a follower).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, sha256, tmpdir, node } from './helpers.mjs';
import * as fx from './fixtures/ci-base.mjs';

// CI_BASE_SRC=1 runs against src/profiles (development); the default is the immutable released snapshot.
const DIR = process.env.CI_BASE_SRC ? path.join(KIT_ROOT, 'src/profiles/ci-base') : path.join(KIT_ROOT, 'profiles/ci-base/1.0.0');
const STD = path.join(DIR, '.standards/ci-base');
const wf = await import(pathToFileURL(path.join(STD, 'wf.mjs')).href);
const lint = (text, file = '.github/workflows/ci.yml', ctx = { names: new Set(['CI']), lane: true }) => wf.lintWorkflow(text, file, ctx);
const ids = (list) => list.map((f) => f.id);
const only = (text, id, file, ctx) => lint(text, file, ctx).filter((f) => f.id === id);
const X = { names: new Set(), lane: false };

const PR_ONLY_PLAIN = () => 'name: other\non:\n  pull_request:\njobs:\n  a:\n    runs-on: [self-hosted, linux]\n    timeout-minutes: 5\n    steps:\n      - run: echo\n';

test('released files: check.json is one wf command; the vendored parser matches the CHANGELOG sha; RULES names every rule', () => {
  const cj = JSON.parse(fs.readFileSync(path.join(STD, 'check.json'), 'utf8'));
  assert.equal(cj.profile, 'ci-base');
  assert.equal(cj.tools, undefined, 'ci-base ships no tool fetcher (CI6)');
  assert.deepEqual(cj.commands, [{ id: 'wf', tool: 'wf', run: ['node', '.standards/ci-base/wf.mjs', '.github/workflows'] }]);
  const yaml = fs.readFileSync(path.join(STD, 'vendor/yaml.mjs'));
  const log = fs.readFileSync(path.join(KIT_ROOT, 'profiles/ci-base/CHANGELOG.md'), 'utf8');
  assert.ok(log.includes(sha256(yaml)), 'CHANGELOG records the sha256 of vendor/yaml.mjs');
  assert.match(yaml.toString('utf8').slice(0, 400), /yaml.* 2\.9\.1.*ISC/s);
  const rules = fs.readFileSync(path.join(STD, 'RULES.md'), 'utf8');
  for (const id of wf.RULE_IDS) assert.ok(new RegExp(`\\| ${id} \\| (MUST|SHOULD) \\|`).test(rules), `RULES.md row for ${id}`);
  for (const s of ['# standards-allow <ID>: <reason>', 'self-hosted-runner.labels', 'Guidance']) assert.ok(rules.includes(s), s);
  assert.ok(wf.RULE_IDS.every((id) => (id === 'O3') === !wf.MUST.has(id)), 'O3 is the only SHOULD');
});

test('every stack fixture is compliant (lane declared)', () => {
  for (const [stack, text] of Object.entries(fx.STACKS)) assert.deepEqual(lint(text, `.github/workflows/ci-${stack}.yml`), [], stack);
});

test('every injected violation fails with its rule id at the right file:line', () => {
  for (const inj of fx.INJECTIONS) {
    const want = inj.firstOf ? fx.lineOf(inj.text, inj.firstOf) : fx.lineOf(inj.text, inj.needle, inj.nth || 1);
    const hit = lint(inj.text).filter((f) => f.id === inj.id);
    assert.ok(hit.length >= 1, `${inj.what}: no ${inj.id} finding`);
    assert.ok(hit.some((f) => f.line === want && f.level === 'FAIL'), `${inj.what}: ${inj.id} at line ${want}, got ${hit.map((f) => f.line)}`);
  }
  const covered = new Set(fx.INJECTIONS.map((i) => i.id));
  for (const id of wf.RULE_IDS.filter((i) => wf.MUST.has(i))) assert.ok(covered.has(id), `an injection for ${id}`);
});

test('triggers: push-to-main means a push trigger that is not tag-only or branch-excluded', () => {
  assert.equal(wf.triggers('push').pushMain, true);
  assert.equal(wf.triggers(['pull_request']).pr, true);
  assert.equal(wf.triggers({ push: { branches: ['main'] } }).pushMain, true);
  assert.equal(wf.triggers({ push: { branches: ['release/**'] } }).pushMain, false);
  assert.equal(wf.triggers({ push: { tags: ['v*'] } }).pushMain, false);
  assert.equal(wf.triggers({ push: { 'branches-ignore': ['main'] } }).pushMain, false);
  assert.equal(wf.triggers({ push: { branches: ['**'] } }).pushMain, true);
  assert.equal(wf.triggers({ schedule: [{ cron: '0 1 * * *' }] }).pushMain, false);
  assert.equal(wf.triggers({ pull_request_target: {} }).pr, true);
});

test('C1: group needs github.workflow and a PR/ref key; cancel-in-progress only for pull_request', () => {
  const base = fx.TS_WORKERS;
  assert.equal(only(base, 'C1').length, 0);
  const g = 'group: ${{ github.workflow }}-${{ github.run_attempt == 1 && (github.event.pull_request.number || github.ref) || github.sha }}';
  assert.ok(base.includes(g));
  assert.equal(only(fx.swap(base, g, 'group: ${{ github.workflow }}'), 'C1').length, 1, 'no PR/ref key');
  assert.equal(only(fx.swap(base, g, 'group: ci'), 'C1').length, 1, 'no github.workflow');
  const cip = "cancel-in-progress: ${{ github.event_name == 'pull_request' }}";
  assert.equal(only(fx.swap(base, cip, 'cancel-in-progress: false'), 'C1').length, 1);
  assert.equal(only(fx.swap(base, cip, "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}"), 'C1').length, 1, 'expression that is not the pull_request test');
  const block = /concurrency:\n {2}group: .*\n {2}cancel-in-progress: .*\n/.exec(base)[0];
  assert.equal(only(fx.swap(base, block, 'concurrency: ${{ github.workflow }}-${{ github.ref }}\n'), 'C1').length, 1, 'string form has no cancel-in-progress');
  // a PR-only workflow may use a literal true; a push-only workflow needs no concurrency
  const prOnlyTrue = PR_ONLY_PLAIN().replace('jobs:', 'concurrency:\n  group: ${{ github.workflow }}-${{ github.event.pull_request.number }}\n  cancel-in-progress: true\njobs:');
  assert.equal(only(prOnlyTrue, 'C1').length, 0);
  assert.equal(only(PR_ONLY_PLAIN(), 'C1').length, 1, 'PR workflow with no concurrency');
  assert.equal(only('name: n\non:\n  push:\n    branches: [main]\njobs:\n  a:\n    runs-on: x\n    timeout-minutes: 1\n    steps: []\n', 'C1').length, 0);
});

test('C2: timeout-minutes on every non-uses job, <= 60', () => {
  const t = 'name: n\non: push\njobs:\n  a:\n    runs-on: x\n    steps: []\n  b:\n    uses: ./.github/workflows/r.yml\n  c:\n    runs-on: x\n    timeout-minutes: 61\n    steps: []\n  d:\n    runs-on: x\n    timeout-minutes: ${{ fromJSON(vars.T || 10) }}\n    steps: []\n  e:\n    runs-on: x\n    timeout-minutes: 60\n    steps: []\n';
  const c2 = only(t, 'C2', 'x.yml', X);
  assert.deepEqual(c2.map((f) => f.line), [4, 11]);
  assert.match(c2[0].msg, /no timeout-minutes/);
  assert.match(c2[1].msg, /61 > 60/);
});

test('G1: which workflows need ci-ok, and what ci-ok must do', () => {
  const noOk = PR_ONLY_PLAIN();
  assert.equal(only(noOk, 'G1', 'test-release-driver.yml').length, 0, 'a PR workflow that is not a CI workflow needs no ci-ok');
  assert.equal(only(noOk, 'G1', 'ci.yml').length, 1, 'ci.yml is a CI workflow');
  assert.equal(only(noOk.replace('name: other', 'name: CI'), 'G1', 'x.yml').length, 1, 'name CI is a CI workflow');
  const withPaths = (file) => only(PR_ONLY_PLAIN().replace('pull_request:', 'pull_request:\n    paths: [a/**]') + fx.ciOk(['a']), 'G1', file);
  assert.equal(withPaths('ci.yml').filter((f) => /paths/.test(f.msg)).length, 1);
  assert.equal(withPaths('other.yml').filter((f) => /paths/.test(f.msg)).length, 1, 'having a ci-ok job opts the workflow in');
  assert.equal(only(fx.swap(fx.TS_WORKERS, '  ci-ok:\n    if: always()', '  ci-ok:\n    if: success()'), 'G1').length, 1);
  assert.equal(only(fx.TS_WORKERS.replace('*" failure "*|*" cancelled "*', '*" failure "*'), 'G1').length, 1, 'must also fail on cancelled');
  // push-only jobs need not be in ci-ok's needs
  assert.equal(only(fx.TS_WORKERS.replace('needs: [build, browser, deploy-preview, deploy]', 'needs: [build, browser, deploy-preview]'), 'G1').length, 0);
});

test('G2: browser/emulator steps on push to main; PR-only jobs and PR-only steps are fine', () => {
  const t = 'name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  a:\n    runs-on: [self-hosted, deploy]\n    timeout-minutes: 5\n    steps:\n      - run: npx playwright test\n';
  assert.deepEqual(only(t, 'G2').map((f) => f.line), [11]);
  assert.equal(only(t.replace('npx playwright test', "npx playwright test\n        if: github.event_name == 'pull_request'"), 'G2').length, 0);
  assert.equal(only(t.replace('npx playwright test', 'npx firebase emulators:start'), 'G2').length, 1);
  assert.equal(only(t.replace('push:\n    branches: [main]', 'push:\n    tags: [v*]'), 'G2').length, 0, 'tag-only push is not main');
  assert.equal(only(PR_ONLY_PLAIN().replace('echo', 'npx playwright test'), 'G2').length, 0, 'PR-only workflow');
});

test('G6: needing a skipped-on-push job needs !cancelled() and a failure check; ci-ok is exempt', () => {
  const g6 = (ifLine) => `name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  e2e:\n    if: github.event_name == 'pull_request'\n    runs-on: [self-hosted, deploy]\n    timeout-minutes: 5\n    steps: []\n  deploy:\n${ifLine}    needs: [e2e]\n    runs-on: [self-hosted, deploy]\n    timeout-minutes: 5\n    steps: []\n`;
  assert.equal(only(g6(''), 'G6').length, 1);
  assert.equal(only(g6('    if: always()\n'), 'G6').length, 1, 'always() would deploy after a failed test');
  assert.equal(only(g6("    if: ${{ !cancelled() && !contains(needs.*.result, 'failure') }}\n"), 'G6').length, 0);
  assert.equal(only(fx.TS_WORKERS, 'G6').length, 0, 'ci-ok needs PR-only jobs and is exempt');
  // chain: deploy -> mid (no if) -> e2e (PR-only)
  const chain = g6('').replace('  deploy:\n    needs: [e2e]', '  mid:\n    needs: [e2e]\n    runs-on: [self-hosted, deploy]\n    timeout-minutes: 5\n    steps: []\n  deploy:\n    needs: [mid]');
  assert.deepEqual(only(chain, 'G6').map((f) => f.msg.match(/needs "(\w+)"/)[1]).sort(), ['e2e', 'mid']);
});

test('L1: literal fallbacks, valid JSON, and the declared deploy lane', () => {
  const j = (ro, lane) => only(`name: n\non:\n  push:\n    branches: [main]\njobs:\n  a:\n    runs-on: ${ro}\n    timeout-minutes: 5\n    steps: []\n`, 'L1', 'x.yml', { names: new Set(), lane });
  assert.equal(j("${{ fromJSON(vars.R || '[\"self-hosted\",\"deploy\"]') }}", true).length, 0);
  assert.equal(j('${{ fromJSON(vars.R) }}', false).length, 1);
  assert.equal(j('${{ fromJSON(vars.R) }}', true).length, 2, 'no fallback and off the lane');
  assert.equal(j("${{ fromJSON(vars.R || '') }}", false).length, 1, 'empty fallback');
  assert.equal(j("${{ fromJSON(vars.R || '[oops') }}", false).length, 1, 'fallback is not JSON');
  assert.equal(j('[self-hosted, linux]', true).length, 1, 'push job off the lane when the repo declares one');
  assert.equal(j('[self-hosted, linux]', false).length, 0, 'no lane declared, no lane rule');
  assert.equal(j('[self-hosted, deploy]', true).length, 0);
  assert.equal(j('windows-latest', false).length, 0);
});

test('L1: the lane is declared by the deploy label in .github/actionlint.yaml', () => {
  const root = tmpdir('ci-lane-');
  assert.equal(wf.laneDeclared(root), false);
  fs.mkdirSync(path.join(root, '.github'));
  fs.writeFileSync(path.join(root, '.github/actionlint.yaml'), 'self-hosted-runner:\n  labels:\n    - revit\n');
  assert.equal(wf.laneDeclared(root), false);
  fs.writeFileSync(path.join(root, '.github/actionlint.yaml'), 'self-hosted-runner:\n  labels:\n    - revit\n    - deploy\n');
  assert.equal(wf.laneDeclared(root), true);
});

test('D2: verify step shapes, environment-only jobs, preview exemption', () => {
  const dep = (steps, extra = '', on = '  push:\n    branches: [main]\n') => `name: n\non:\n${on}jobs:\n  d:\n${extra}    runs-on: x\n    timeout-minutes: 5\n    steps:\n${steps}`;
  const deployStep = '      - id: s\n        run: npx wrangler deploy\n';
  const d2 = (t) => only(t, 'D2', 'x.yml', X);
  assert.equal(d2(dep(deployStep)).length, 1);
  assert.equal(d2(dep(`${deployStep}      - if: always()\n        run: curl -f x\n`)).length, 0);
  assert.equal(d2(dep(`${deployStep}      - if: \${{ !cancelled() }}\n        run: curl -f x\n`)).length, 0);
  assert.equal(d2(dep(`${deployStep}      - if: steps.s.outcome == 'success' || steps.s.outcome == 'failure'\n        run: curl -f x\n`)).length, 0);
  assert.equal(d2(dep(`      - if: always()\n        run: curl -f x\n${deployStep}`)).length, 1, 'the verify step must come after the deploy step');
  assert.equal(d2(dep(`${deployStep}      - run: curl -f x\n`)).length, 1, 'a verify step that does not run after failure');
  assert.match(d2(dep(deployStep.replace('        run', '        continue-on-error: true\n        run')))[0].msg, /continue-on-error on the deploy step needs one/);
  assert.equal(d2(dep('      - run: echo hi\n', '    environment: production\n')).length, 1, 'environment: marks a deploy job');
  assert.equal(d2(dep('      - run: echo hi\n      - if: always()\n        run: curl -f x\n', '    environment: production\n')).length, 0);
  assert.equal(d2(dep('      - uses: cloudflare/wrangler-action@v3\n')).length, 1);
  assert.equal(d2(dep('      - run: firebase deploy --only hosting\n')).length, 1);
  assert.equal(d2(dep('      - uses: FirebaseExtended/action-hosting-deploy@v0\n')).length, 1);
  assert.equal(d2(dep(deployStep, '', '  pull_request:\n')).length, 0, 'a workflow that never runs on main (preview)');
  assert.equal(d2(dep(deployStep, "    if: github.event_name == 'pull_request'\n", '  push:\n    branches: [main]\n  pull_request:\n')).length, 0, 'PR-only preview job');
  assert.equal(d2(dep('      - run: npm test\n')).length, 0, 'not a deploy job');
});

test('K1 and S4', () => {
  const k = (step, ro = '[self-hosted, deploy]') => `name: n\non: push\njobs:\n  a:\n    runs-on: ${ro}\n    timeout-minutes: 5\n    steps:\n${step}`;
  const rule = (id, text) => only(text, id, 'x.yml', X).length;
  assert.equal(rule('K1', k('      - uses: actions/setup-go@v6\n        with:\n          cache: false\n')), 0);
  assert.equal(rule('K1', k("      - uses: actions/setup-go@v6\n        with:\n          cache: 'false'\n")), 0);
  assert.equal(rule('K1', k('      - uses: actions/setup-go@v6\n')), 1);
  assert.equal(rule('K1', k('      - uses: actions/setup-go@v6\n        with:\n          cache: true\n')), 1);
  assert.equal(rule('K1', k('      - uses: actions/cache@v5\n        with:\n          path: ~/.cargo/registry\n          key: k\n')), 1);
  assert.equal(rule('K1', k('      - uses: actions/cache@v5\n        with:\n          path: ~/.nuget/packages\n          key: k\n')), 1);
  assert.equal(rule('K1', k('      - uses: actions/cache@v5\n        with:\n          path: .cache/uv\n          key: k\n')), 1);
  assert.equal(rule('K1', k('      - uses: actions/cache@v5\n        with:\n          path: node_modules\n          key: k\n')), 0);
  assert.equal(rule('S4', k('      - run: x\n', 'ubuntu-latest')), 1);
  assert.equal(rule('S4', k('      - run: x\n', '[self-hosted, deploy]')), 0);
  assert.equal(rule('S4', k('      - run: x\n', '${{ matrix.os }}').replace('    steps:', '    strategy:\n      matrix:\n        os: [ubuntu-latest, windows-latest]\n    steps:')), 1, 'matrix os list');
  assert.equal(rule('S4', k('      - run: x\n', "${{ fromJSON(vars.R || '\"ubuntu-latest\"') }}")), 1, 'fallback');
  assert.equal(rule('S4', k('      - run: echo ubuntu-latest\n')), 0, 'only runs-on and matrix count');
});

test('O3: workflow_run names must match a workflow name or path; WARN only', () => {
  const t = (n) => `name: after\non:\n  workflow_run:\n    workflows: [${n}]\n    types: [completed]\njobs:\n  x:\n    runs-on: [self-hosted, deploy]\n    timeout-minutes: 5\n    steps: []\n`;
  const ctx = { names: new Set(['CI', '.github/workflows/build.yml']), lane: true };
  assert.deepEqual(lint(t('CI'), 'a.yml', ctx), []);
  assert.deepEqual(lint(t('".github/workflows/build.yml"'), 'a.yml', ctx), []);
  const w = lint(t('Nope'), 'a.yml', ctx);
  assert.deepEqual(w.map((f) => [f.id, f.level, f.line]), [['O3', 'WARN', 4]]);
});

test('allow: reason on the line, the job line, the line above, or the leading block; reasonless fails; unknown id warns', () => {
  const lacking = 'name: n\non: push\njobs:\n  a:\n    runs-on: [self-hosted, deploy]\n    steps: []\n';
  assert.deepEqual(ids(lint(lacking, 'x.yml', X)), ['C2']);
  assert.deepEqual(lint(lacking.replace('  a:', '  a: # standards-allow C2: bounded by the runner'), 'x.yml', X), []);
  assert.deepEqual(lint(lacking.replace('  a:', '  # standards-allow C2: bounded by the runner\n  a:'), 'x.yml', X), [], 'comment line above');
  assert.deepEqual(lint(`# standards-allow C2: whole file\n${lacking}`, 'x.yml', X), [], 'leading comment block');
  assert.deepEqual(ids(lint(lacking.replace('on: push', 'on: push # standards-allow C2: not here'), 'x.yml', X)), ['C2'], 'an allow on an unrelated line does not suppress');
  assert.deepEqual(ids(lint(lacking.replace('  a:', '  a: # standards-allow S4: wrong rule'), 'x.yml', X)), ['C2'], 'allow is per rule id');
  const bare = lint(lacking.replace('  a:', '  a: # standards-allow C2'), 'x.yml', X);
  assert.deepEqual(bare.map((f) => [f.id, f.level]).sort(), [['C2', 'FAIL'], ['allow', 'FAIL']]);
  assert.equal(bare.find((f) => f.id === 'allow').line, 4);
  const colonOnly = lint(lacking.replace('  a:', '  a: # standards-allow C2:   '), 'x.yml', X);
  assert.ok(colonOnly.some((f) => f.id === 'allow' && f.level === 'FAIL'), 'a colon with no reason fails');
  const unknown = lint(lacking.replace('  a:', '  a: # standards-allow Z9: nope'), 'x.yml', X);
  assert.ok(unknown.some((f) => f.id === 'allow' && f.level === 'WARN'));
});

test('YAML parse errors fail; CRLF files keep line numbers', () => {
  const bad = lint('name: n\non: [\njobs:\n', 'x.yml', X);
  assert.equal(bad[0].id, 'parse');
  assert.equal(bad[0].level, 'FAIL');
  const ro = fx.TS_WORKERS.match(/ {2}build:\n {4}runs-on: (.*)\n/)[1];
  const crlf = fx.swap(fx.TS_WORKERS, `  build:\n    runs-on: ${ro}\n    timeout-minutes: 20\n`, `  build:\n    runs-on: ${ro}\n`).replace(/\n/g, '\r\n');
  const f = lint(crlf).filter((x) => x.id === 'C2');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, fx.lineOf(fx.TS_WORKERS, '  build:'));
});

test('CLI: one line per finding, exit 1 only on a FAIL, a missing directory is fine', () => {
  const root = tmpdir('ci-cli-');
  const run = () => node([path.join(STD, 'wf.mjs'), '.github/workflows'], { cwd: root });
  assert.equal(run().code, 0, 'no .github/workflows');
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github/actionlint.yaml'), fx.ACTIONLINT);
  fs.writeFileSync(path.join(root, '.github/workflows/ci.yml'), fx.GO);
  const ok = run();
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /1 workflow file\(s\), 0 failure\(s\), 0 warning\(s\)/);
  fs.writeFileSync(path.join(root, '.github/workflows/ci.yml'), fx.swap(fx.GO, '          cache: false\n', ''));
  const bad = run();
  assert.equal(bad.code, 1);
  assert.match(bad.out, /^standards: FAIL \[ci-base\/wf\] \.github\/workflows\/ci\.yml:\d+: actions\/setup-go must set `cache: false`.* \(K1\)$/m);
  fs.writeFileSync(path.join(root, '.github/workflows/ci.yml'), fx.GO);
  fs.writeFileSync(path.join(root, '.github/workflows/after.yml'), 'name: after\non:\n  workflow_run:\n    workflows: [Gone]\njobs:\n  x:\n    runs-on: [self-hosted, deploy]\n    timeout-minutes: 5\n    steps: []\n');
  const warn = run();
  assert.equal(warn.code, 0, 'a SHOULD does not fail the gate');
  assert.match(warn.out, /^standards: WARN \[ci-base\/wf\] \.github\/workflows\/after\.yml:4: .* \(O3\)$/m);
});
