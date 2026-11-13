// standards.mjs: the agent-facing CLI (describe / list / init / check / apply / upgrade / explain).
// Every test runs against a synthetic kit (real base@1.0.0 + a tiny `demo` profile) and a temp follower repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { KIT_ROOT, makeKit, makeFollower, writeProfile, checkJson, snapshot, node } from './helpers.mjs';

const CLI = path.join(KIT_ROOT, 'standards.mjs');
const cli = (cwd, ...args) => node([CLI, ...args], { cwd });
const json = (r) => {
  try { return JSON.parse(r.stdout); } catch { throw new Error(`not JSON (exit ${r.code}):\n${r.out}`); }
};

const DEMO_RULES = [
  '# demo rules',
  '',
  '| id | level | rule |',
  '|---|---|---|',
  '| D1 | MUST | Every demo.cfg sets `strict = true` |',
  '| D2 | SHOULD | Keep demo.cfg short |',
  '',
  '## Guidance',
  '- **Name things plainly.** Prefer `demo` over clever names.',
  '',
].join('\n');

function demo(ver, cfg = 'strict = true\n', extra = {}) {
  return {
    '.standards/demo/check.json': checkJson('demo', ver),
    '.standards/demo/RULES.md': DEMO_RULES,
    'demo.cfg': cfg,
    ...extra,
  };
}

const kitWith = (fn = () => {}) => makeKit((k) => {
  writeProfile(k, 'demo', '1.0.0', demo('1.0.0'));
  fs.writeFileSync(path.join(k, 'profiles', 'demo', 'CHANGELOG.md'), '# demo\n\n## 1.0.0\n- first\n');
  fn(k);
});

const initDemo = (repo, kit) => cli(repo, 'init', 'base@1.0.0', 'demo@1.0.0', '--kit', kit, '--json');

test('describe --json: bim-driver-shaped verb table with effect + output on every verb', () => {
  const r = cli(process.cwd(), 'describe', '--json');
  assert.equal(r.code, 0, r.out);
  const d = json(r).result;
  assert.equal(d.name, 'standards');
  assert.match(d.version, /^\d+\.\d+\.\d+$/);
  const names = d.verbs.map((v) => v.name).sort();
  assert.deepEqual(names, ['apply', 'check', 'describe', 'explain', 'init', 'list', 'upgrade']);
  for (const v of d.verbs) {
    assert.ok(['read', 'verify', 'mutate', 'render'].includes(v.effect), `${v.name} effect ${v.effect}`);
    assert.equal(v.output, 'json', v.name);
    assert.ok(v.description.length > 20, v.name);
    for (const a of v.args) assert.match(a.name, /^[a-z][a-z0-9-]*$/, `${v.name} arg ${a.name}`);
  }
  const mutators = d.verbs.filter((v) => v.effect === 'mutate').map((v) => v.name).sort();
  assert.deepEqual(mutators, ['apply', 'init', 'upgrade']);
  for (const m of mutators) assert.ok(d.verbs.find((v) => v.name === m).args.some((a) => a.name === 'dry-run'), `${m} has --dry-run`);
  assert.ok(d.exit_codes && d.exit_codes.drift === 1 && d.exit_codes['usage-error'] === 2);
});

test('list --json: every profile in the kit with its versions and latest; marks adopted ones', () => {
  const kit = kitWith((k) => writeProfile(k, 'demo', '1.1.0', demo('1.1.0')));
  const repo = makeFollower();
  assert.equal(initDemo(repo, kit).code, 0);
  const r = cli(repo, 'list', '--kit', kit, '--json');
  assert.equal(r.code, 0, r.out);
  const rows = json(r).result.profiles;
  const d = rows.find((p) => p.name === 'demo');
  assert.deepEqual(d.versions, ['1.0.0', '1.1.0']);
  assert.equal(d.latest, '1.1.0');
  assert.equal(d.adopted, '1.0.0');
  assert.equal(rows.find((p) => p.name === 'base').adopted, '1.0.0');
});

test('check on a repo without .standards.json: drift "not-adopted", exit 1, JSON', () => {
  const kit = kitWith();
  const repo = makeFollower();
  const r = cli(repo, 'check', '--kit', kit, '--json');
  assert.equal(r.code, 1, r.out);
  const res = json(r).result;
  assert.equal(res.status, 'not-adopted');
  assert.ok(res.findings.some((f) => f.kind === 'not-adopted' && f.severity === 'error'));
});

test('init --dry-run writes nothing and lists the plan; init writes; check is then clean (exit 0)', () => {
  const kit = kitWith();
  const repo = makeFollower();
  const before = snapshot(repo);
  const dry = cli(repo, 'init', 'base@1.0.0', 'demo@1.0.0', '--kit', kit, '--dry-run', '--json');
  assert.equal(dry.code, 0, dry.out);
  const plan = json(dry).result;
  assert.equal(plan.dry_run, true);
  assert.ok(plan.write.includes('demo.cfg') && plan.write.includes('.standards.json'), JSON.stringify(plan));
  assert.deepEqual(snapshot(repo), before, 'dry run wrote nothing');

  const r = initDemo(repo, kit);
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(path.join(repo, 'demo.cfg'), 'utf8'), 'strict = true\n');
  assert.match(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), /standards.mjs check --json/);
  const c = cli(repo, 'check', '--kit', kit, '--json');
  assert.equal(c.code, 0, c.out);
  assert.equal(json(c).result.status, 'clean');
  assert.deepEqual(json(c).result.findings, []);
});

test('apply is idempotent: a second apply writes and removes nothing', () => {
  const kit = kitWith();
  const repo = makeFollower();
  assert.equal(initDemo(repo, kit).code, 0);
  const snap = snapshot(repo);
  const r = cli(repo, 'apply', '--kit', kit, '--json');
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(json(r).result.write, []);
  assert.deepEqual(json(r).result.remove, []);
  assert.deepEqual(snapshot(repo), snap);
});

test('a hand-edited managed file: check reports "modified" (exit 1); apply refuses to clobber it; --force restores', () => {
  const kit = kitWith();
  const repo = makeFollower();
  assert.equal(initDemo(repo, kit).code, 0);
  fs.writeFileSync(path.join(repo, 'demo.cfg'), 'strict = false\n');
  const c = cli(repo, 'check', '--kit', kit, '--json');
  assert.equal(c.code, 1, c.out);
  assert.ok(json(c).result.findings.some((f) => f.kind === 'modified' && f.path === 'demo.cfg'), c.out);

  const a = cli(repo, 'apply', '--kit', kit, '--json');
  assert.equal(a.code, 1, a.out);
  const err = json(a);
  assert.equal(err.ok, false);
  assert.equal(err.error.kind, 'conflict');
  assert.ok(err.error.conflicts.some((x) => x.path === 'demo.cfg' && x.reason === 'hand-edited'), a.out);
  assert.equal(fs.readFileSync(path.join(repo, 'demo.cfg'), 'utf8'), 'strict = false\n', 'not clobbered');

  const f = cli(repo, 'apply', '--kit', kit, '--force', '--json');
  assert.equal(f.code, 0, f.out);
  assert.equal(fs.readFileSync(path.join(repo, 'demo.cfg'), 'utf8'), 'strict = true\n');
});

test('init refuses to overwrite an unmanaged file already at a managed path (writes nothing)', () => {
  const kit = kitWith();
  const repo = makeFollower({ 'README.md': '# r\n', 'demo.cfg': 'mine\n' });
  const before = snapshot(repo);
  const r = initDemo(repo, kit);
  assert.equal(r.code, 1, r.out);
  assert.ok(json(r).error.conflicts.some((x) => x.path === 'demo.cfg' && x.reason === 'unmanaged'), r.out);
  assert.deepEqual(snapshot(repo), before);
});

test('check: a newer version in the kit is a warning (exit 0), and an error with --strict', () => {
  const kit = kitWith((k) => writeProfile(k, 'demo', '1.1.0', demo('1.1.0')));
  const repo = makeFollower();
  assert.equal(initDemo(repo, kit).code, 0);
  const c = cli(repo, 'check', '--kit', kit, '--json');
  assert.equal(c.code, 0, c.out);
  const f = json(c).result.findings.find((x) => x.kind === 'behind');
  assert.ok(f && f.profile === 'demo' && f.latest === '1.1.0' && f.severity === 'warn', c.out);
  assert.equal(cli(repo, 'check', '--kit', kit, '--strict', '--json').code, 1);
});

test('upgrade --dry-run shows the file diff and changelog without writing; upgrade applies it and check is clean', () => {
  const kit = kitWith((k) => {
    writeProfile(k, 'demo', '1.1.0', demo('1.1.0', 'strict = true\nshort = true\n', { 'demo-extra.txt': 'x\n' }));
    fs.writeFileSync(path.join(k, 'profiles', 'demo', 'CHANGELOG.md'), '# demo\n\n## 1.1.0\n- adds short\n\n## 1.0.0\n- first\n');
  });
  const repo = makeFollower();
  assert.equal(initDemo(repo, kit).code, 0);
  const snap = snapshot(repo);
  const d = cli(repo, 'upgrade', 'demo', '--kit', kit, '--dry-run', '--json');
  assert.equal(d.code, 0, d.out);
  const up = json(d).result.upgrades.find((u) => u.profile === 'demo');
  assert.equal(up.from, '1.0.0');
  assert.equal(up.to, '1.1.0');
  assert.deepEqual(up.files.added, ['demo-extra.txt']);
  assert.ok(up.files.changed.includes('demo.cfg'));
  assert.match(up.changelog, /adds short/);
  assert.doesNotMatch(up.changelog, /first/);
  assert.deepEqual(snapshot(repo), snap, 'dry run wrote nothing');

  const r = cli(repo, 'upgrade', 'demo', '--kit', kit, '--json');
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, '.standards.json'), 'utf8')).profiles.demo, '1.1.0');
  const c = cli(repo, 'check', '--kit', kit, '--json');
  assert.equal(c.code, 0, c.out);
  assert.equal(json(c).result.status, 'clean');
});

test('explain <rule>: finds a rule id in the adopted profiles\' RULES.md; unknown id exits 1', () => {
  const kit = kitWith();
  const repo = makeFollower();
  assert.equal(initDemo(repo, kit).code, 0);
  const r = cli(repo, 'explain', 'D1', '--kit', kit, '--json');
  assert.equal(r.code, 0, r.out);
  const m = json(r).result.matches;
  assert.equal(m[0].profile, 'demo');
  assert.match(m[0].text, /strict = true/);
  const none = cli(repo, 'explain', 'ZZ9', '--kit', kit, '--json');
  assert.equal(none.code, 1, none.out);
  assert.equal(json(none).error.kind, 'not-found');
});

test('usage errors exit 2 with a JSON error naming the verb list', () => {
  const r = cli(process.cwd(), 'frobnicate', '--json');
  assert.equal(r.code, 2, r.out);
  assert.equal(json(r).error.kind, 'usage');
  assert.match(json(r).error.message, /check/);
});
