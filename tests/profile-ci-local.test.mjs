// ci-local 1.3.0: run / sign / publish / verify / status / check-manifest against fixture repos with a throwaway
// ed25519 key. Every failure mode asserts a NAMED reason. ssh-keygen -Y and git are real; nothing touches GitHub
// (status POSTs go to a local http server). os_required "any" and the all-of list are also covered on SIMULATED
// linux / macos / windows records (signed with the fixture key), because CI runs on one host OS at a time.
// A 1.0.1 tree still verifies with its vendored 1.0.1 (the compat test at the bottom).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { KIT_ROOT, tmpdir } from './helpers.mjs';

const DIR = process.env.CI_LOCAL_SRC ? path.join(KIT_ROOT, 'src/profiles/ci-local') : path.join(KIT_ROOT, 'profiles/ci-local/1.6.0');
const CI_SRC = path.join(DIR, '.standards/ci-local/ci.mjs');
const CI_101 = path.join(KIT_ROOT, 'profiles/ci-local/1.0.1/.standards/ci-local/ci.mjs');
const { VERSION } = await import(pathToFileURL(CI_SRC).href);
const HOST = { win32: 'windows', linux: 'linux', darwin: 'macos' }[process.platform];
const OTHER = HOST === 'linux' ? 'windows' : 'linux';
const rec = (osName, host = 'test') => `record.${osName}.${host}.json`; // 1.1.0 per-host record file name
const sh = (cmd, args, cwd, input) => { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', input }); assert.equal(r.status, 0, `${cmd} ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const g = (cwd, ...a) => sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], cwd);

const ROOT = tmpdir('ci-local-');
const KEY = path.join(ROOT, 'k');
const KEY2 = path.join(ROOT, 'k2');
sh('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'test', '-f', KEY]);
sh('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'test2', '-f', KEY2]);
const pub = (k) => fs.readFileSync(`${k}.pub`, 'utf8').trim().split(' ').slice(0, 2).join(' ');
const PRINCIPALS = ['dim@test', 'dim@win2', 'dim@lin1', 'dim@mac1'];
const signers = (valid = '20991231') => `# fixture\n${PRINCIPALS.map((p) => `${p} namespaces="ci-result@hhay",valid-before="${valid}" ${pub(KEY)}`).join('\n')}\n`;
const node = (code) => `node -e "${code}"`;
const manifest = (over = {}) => JSON.stringify({ schema: 'ci-local/1', os_required: [HOST], toolchain: { node: process.versions.node.split('.')[0] }, setup: [], suites: [{ id: 'unit', run: [node('process.exit(0)')], required: true, os: 'any', paths: ['**'], timeout_min: 2 }], ...over }, null, 2);
const anyManifest = (over = {}) => manifest({ os_required: 'any', ...over });

let n = 0;
// A repo whose main has ci.mjs + manifest + signers.
function fixture({ man = manifest(), sig = signers(), ciSrc = CI_SRC } = {}) {
  const repo = path.join(ROOT, `r${++n}`);
  fs.mkdirSync(path.join(repo, '.standards/ci-local'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'ci'));
  fs.copyFileSync(ciSrc, path.join(repo, '.standards/ci-local/ci.mjs'));
  fs.writeFileSync(path.join(repo, '.standards/ci-local/allowed_signers.org'), sig);
  fs.writeFileSync(path.join(repo, 'ci/suites.json'), man);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  sh('git', ['init', '-q', '-b', 'main'], repo);
  g(repo, 'add', '-A'); g(repo, 'commit', '-q', '-m', 'main');
  return repo;
}
const env = { ...process.env, CI_SIGNER: 'dim@test' };
function ci(repo, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [path.join(repo, '.standards/ci-local/ci.mjs'), ...args, '--json'], { cwd: repo, encoding: 'utf8', env: { ...env, ...extraEnv } });
  let j; try { j = JSON.parse(r.stdout); } catch { assert.fail(`no envelope (exit ${r.status}) for ${args.join(' ')}: ${r.stdout}${r.stderr}${r.error ?? ''}`); }
  return { code: r.status, ...j };
}
function branch(repo, name, files) {
  g(repo, 'checkout', '-q', '-b', name, 'main');
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), c); }
  g(repo, 'add', '-A'); g(repo, 'commit', '-q', '-m', name);
  const sha = g(repo, 'rev-parse', 'HEAD');
  g(repo, 'checkout', '-q', 'main');
  return sha;
}
// run + sign + publish (local ref only) for a commit on THIS host; returns the record path.
function publish(repo, sha, { key = KEY, out, signer } = {}) {
  const o = out ?? path.join(repo, '..', `out-${sha.slice(0, 8)}-${n}`);
  const r = ci(repo, ['run', '--checkout', '--sha', sha, '--out', o, ...(signer ? ['--signer', signer] : [])]);
  assert.ok(r.ok, JSON.stringify(r));
  const file = r.result.record;
  assert.equal(ci(repo, ['sign', file, '--key', key]).ok, true);
  assert.equal(ci(repo, ['publish', file, '--no-push']).ok, true);
  return { rec: file, run: r };
}
// A record for a host OS we are not running on: built from the manifest, signed with the fixture key, put on the ref.
function simulate(repo, sha, osName, { signer = { linux: 'dim@lin1', macos: 'dim@mac1', windows: 'dim@win2' }[osName], status = {}, outcome = 'pass', reason = null, probes, key = KEY, version = VERSION } = {}) {
  const tree = treeOf(repo, sha);
  const man = JSON.parse(g(repo, 'show', `${sha}:ci/suites.json`));
  const toolchain = { os: osName, arch: 'x64', probes: probes ?? { node: process.versions.node } };
  const suites = man.suites.map((s) => ({ id: s.id, required: s.required, status: status[s.id] ?? ((s.os ?? 'any') !== 'any' && s.os !== osName ? 'skipped:os' : 'passed'), duration_s: 0.1, log_sha256: null }));
  const record = { schema: 'ci-record/1', key: crypto.createHash('sha256').update(JSON.stringify({ tree, toolchain, ci_local_version: version })).digest('hex'), tree, commit: sha, base: null, ci_local_version: version, toolchain, manifest_sha256: 'x', os: osName, host: 'sim', signer, created: '2026-11-14T12:00:00Z', outcome, reason, suites };
  const f = path.join(ROOT, `sim${++n}`, rec(osName, signer.split('@')[1]));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify(record, null, 2)}\n`);
  assert.equal(ci(repo, ['sign', f, '--key', key]).ok, true);
  assert.equal(ci(repo, ['publish', f, '--no-push']).ok, true);
  return f;
}
// Put arbitrary files on refs/ci/<tree> (for forged / unsigned records).
function putRef(repo, tree, files) {
  const lines = Object.entries(files).map(([name, c]) => `100644 blob ${sh('git', ['hash-object', '-w', '--stdin'], repo, c)}\t${name}`).join('\n');
  const t = sh('git', ['mktree'], repo, `${lines}\n`);
  const c = g(repo, 'commit-tree', t, '-m', 'forged');
  g(repo, 'update-ref', `refs/ci/${tree}`, c);
}
const treeOf = (repo, sha) => g(repo, 'rev-parse', `${sha}^{tree}`);
const reasons = (v) => v.result.reasons.map((r) => r.code);
const notes = (v) => v.result.notes.map((r) => r.code);
const feat = (repo) => branch(repo, 'feat', { 'b.txt': 'b\n' });

test('a passing manifest run + sign + publish + verify succeeds; a second run reuses the record', () => {
  const repo = fixture();
  const sha = feat(repo);
  const { rec: f, run } = publish(repo, sha);
  assert.equal(path.basename(f), rec(HOST));
  assert.equal(run.result.outcome, 'pass');
  assert.deepEqual(run.result.suites, [{ id: 'unit', status: 'passed' }]);
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(r.tree, treeOf(repo, sha)); assert.equal(r.signer, 'dim@test'); assert.equal(r.os, HOST); assert.equal(r.ci_local_version, VERSION);
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 0, JSON.stringify(v)); assert.equal(v.result.verdict, 'pass'); assert.deepEqual(v.result.records.map((x) => x.os), [HOST]);
  assert.equal(ci(repo, ['run', '--checkout', '--sha', sha, '--out', path.dirname(f)]).result.reuse, true);
});

test('VERSION equals the profile version (1.0.1 shipped 1.0.0)', () => {
  const cj = JSON.parse(fs.readFileSync(path.join(DIR, '.standards/ci-local/check.json'), 'utf8'));
  const expected = process.env.CI_LOCAL_SRC ? fs.readFileSync(path.join(KIT_ROOT, 'profiles/ci-local/CHANGELOG.md'), 'utf8').match(/^## (\d+\.\d+\.\d+)/m)[1] : cj.version;
  assert.equal(VERSION, expected);
  const r = spawnSync(process.execPath, [CI_SRC, '--help'], { encoding: 'utf8' });
  assert.match(r.stdout, new RegExp(`^ci-local ${expected.replace(/\./g, '\\.')}:`));
});

test('publish keeps the other hosts\' records already on the ref', () => {
  const repo = fixture();
  const sha = feat(repo);
  publish(repo, sha);
  simulate(repo, sha, OTHER, { signer: 'dim@lin1' });
  const names = g(repo, 'ls-tree', '--name-only', `refs/ci/${treeOf(repo, sha)}`).split('\n');
  assert.deepEqual(names, [rec(HOST), `${rec(HOST)}.sig`, rec(OTHER, 'lin1'), `${rec(OTHER, 'lin1')}.sig`, 'summary.txt'].sort());
});

test('per-host record files: two hosts on one OS keep separate files; a host re-running replaces only its own', () => {
  const repo = fixture({ man: anyManifest() });
  const sha = feat(repo);
  const o = path.join(ROOT, `o${++n}`);
  const a = publish(repo, sha, { out: o });
  const b = publish(repo, sha, { out: o, signer: 'dim@win2' });
  assert.equal(path.basename(a.rec), rec(HOST, 'test')); assert.equal(path.basename(b.rec), rec(HOST, 'win2'));
  assert.equal(b.run.result.reuse, false, 'the other host does not reuse test\'s record');
  assert.equal(ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]).result.reuse, true);
  const before = g(repo, 'show', `refs/ci/${treeOf(repo, sha)}:${rec(HOST, 'test')}`);
  fs.rmSync(b.rec); fs.rmSync(`${b.rec}.sig`);
  publish(repo, sha, { out: o, signer: 'dim@win2' });
  assert.equal(g(repo, 'show', `refs/ci/${treeOf(repo, sha)}:${rec(HOST, 'test')}`), before);
  assert.deepEqual(ci(repo, ['verify', '--sha', sha]).result.records.map((x) => x.signer).sort(), ['dim@test', 'dim@win2']);
});

test('publish pushes refs/ci/<tree> to a remote and verify fetches it in a fresh clone', () => {
  const repo = fixture();
  const bare = path.join(ROOT, `bare${++n}.git`);
  sh('git', ['init', '-q', '--bare', '-b', 'main', bare], ROOT);
  g(repo, 'remote', 'add', 'origin', bare); g(repo, 'push', '-q', 'origin', 'main');
  const sha = feat(repo); g(repo, 'push', '-q', 'origin', 'feat');
  const o = path.join(ROOT, `out${++n}`);
  const r = ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]);
  ci(repo, ['sign', r.result.record, '--key', KEY]);
  const p = ci(repo, ['publish', r.result.record]);
  assert.equal(p.result.pushed, true, JSON.stringify(p));
  const clone = path.join(ROOT, `clone${++n}`);
  sh('git', ['clone', '-q', bare, clone], ROOT);
  g(clone, 'fetch', '-q', 'origin', 'feat:feat');
  const v = ci(clone, ['verify', '--sha', 'feat']);
  assert.equal(v.code, 0, JSON.stringify(v));
});

test('unverifiable records are ignored and listed as notes: tampered, unsigned, wrong signer, expired key never pass', () => {
  let repo = fixture();
  let sha = feat(repo);
  let v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 2); assert.equal(v.result.verdict, 'pending'); assert.deepEqual(v.result.waiting, ['no record yet']);
  assert.equal(ci(repo, ['status', '--sha', sha, '--repo', 'o/r', '--dry-run']).result.request.body.description, 'no record yet');

  // tampered: edit the record after signing
  const o = path.join(ROOT, `o${++n}`);
  const f = ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]).result.record;
  ci(repo, ['sign', f, '--key', KEY]);
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.suites[0].status = 'passed'; j.created = '2000-01-01T00:00:00Z';
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
  ci(repo, ['publish', f, '--no-push']);
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 2); assert.deepEqual(notes(v), ['bad-signature']); assert.deepEqual(reasons(v), []);

  // unsigned: record on the ref without a .sig
  putRef(repo, treeOf(repo, sha), { [rec(HOST)]: fs.readFileSync(f) });
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 2); assert.deepEqual(notes(v), ['unsigned']); assert.match(v.result.notes[0].detail, new RegExp(`${rec(HOST).replace(/\./g, '\\.')} has no \\.sig`));

  // wrong signer: valid record signed by a key that is not in allowed signers
  repo = fixture(); sha = feat(repo);
  publish(repo, sha, { key: KEY2 });
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 2); assert.deepEqual(notes(v), ['bad-signature']);

  // expired key
  repo = fixture({ sig: signers('20200101') }); sha = feat(repo);
  publish(repo, sha);
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 2); assert.deepEqual(notes(v), ['bad-signature']);
});

test('an unverifiable record never blocks a good one in any-mode, and a good one never rescues it', () => {
  const repo = fixture({ man: anyManifest() });
  const sha = feat(repo);
  simulate(repo, sha, 'linux', { signer: 'dim@lin1', key: KEY2 });      // signed by a key not in the signers file
  let v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 2); assert.deepEqual(notes(v), ['bad-signature']); assert.deepEqual(v.result.waiting, ['no usable record yet']);
  simulate(repo, sha, 'macos', { signer: 'dim@mac1' });
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 0, JSON.stringify(v)); assert.deepEqual(notes(v), ['bad-signature']); assert.deepEqual(v.result.records.map((x) => x.os), ['macos']);
});

test('verify ignores a record bound to the wrong tree, version or toolchain (notes, never a pass)', () => {
  const repo = fixture({ man: anyManifest() });
  const a = branch(repo, 'a', { 'b.txt': 'b\n' });
  const b = branch(repo, 'b', { 'c.txt': 'c\n' });
  const f = simulate(repo, a, 'linux', { signer: 'dim@lin1' });       // record + sig for tree(a)
  putRef(repo, treeOf(repo, b), { [path.basename(f)]: fs.readFileSync(f), [`${path.basename(f)}.sig`]: fs.readFileSync(`${f}.sig`) }); // replay onto tree(b)
  let v = ci(repo, ['verify', '--sha', b]);
  assert.equal(v.code, 2); assert.deepEqual(notes(v), ['wrong-tree']); assert.match(v.result.notes[0].detail, /record\.tree .* != head tree/);

  const c = branch(repo, 'c', { 'd.txt': 'd\n' });
  simulate(repo, c, 'linux', { signer: 'dim@lin1', version: '1.0.0' });
  v = ci(repo, ['verify', '--sha', c]);
  assert.equal(v.code, 2); assert.deepEqual(notes(v), ['ci-version-mismatch']);

  const d = branch(repo, 'd', { 'e.txt': 'e\n' });
  simulate(repo, d, 'linux', { signer: 'dim@lin1', probes: { node: '1.2.3' } });
  v = ci(repo, ['verify', '--sha', d]);
  assert.equal(v.code, 2); assert.deepEqual(notes(v), ['toolchain-mismatch']); assert.match(v.result.notes[0].detail, /node have 1\.2\.3 pin \d+/);
});

test('any-mode: one passing record from a simulated linux, macos or windows host is enough', () => {
  for (const osName of ['linux', 'macos', 'windows']) {
    const repo = fixture({ man: anyManifest() });
    const sha = feat(repo);
    simulate(repo, sha, osName);
    const v = ci(repo, ['verify', '--sha', sha]);
    assert.equal(v.code, 0, `${osName}: ${JSON.stringify(v)}`); assert.equal(v.result.verdict, 'pass'); assert.equal(v.result.os_required, 'any');
    assert.deepEqual(v.result.records.map((x) => x.os), [osName]);
    assert.equal(ci(repo, ['status', '--sha', sha, '--repo', 'o/r', '--dry-run']).result.request.body.state, 'success');
  }
});

test('any-mode: a real red from any host is red; passing records elsewhere do not rescue it', () => {
  let repo = fixture({ man: anyManifest() });
  let sha = feat(repo);
  simulate(repo, sha, 'linux', { signer: 'dim@lin1' });
  simulate(repo, sha, 'macos', { signer: 'dim@mac1', status: { unit: 'failed' }, outcome: 'fail', reason: 'suite-failed: unit' });
  let v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.deepEqual(reasons(v).sort(), ['record-failed', 'suite-failed']); assert.match(JSON.stringify(v.result.reasons), /unit failed on macos/);
  assert.equal(ci(repo, ['status', '--sha', sha, '--repo', 'o/r', '--dry-run']).result.request.body.state, 'failure');

  // a record outcome of fail with every required suite green (e.g. a failed setup or optional suite) is still a failure
  repo = fixture({ man: anyManifest() }); sha = feat(repo);
  simulate(repo, sha, 'linux', { outcome: 'fail', reason: 'setup-failed: x' });
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.deepEqual(reasons(v), ['record-failed']);
});

test('a failing record for the tree and OS is never out-voted: a later pass by the same host (replacing its file) cannot clear it', () => {
  let repo = fixture({ man: anyManifest() });
  let sha = feat(repo);
  simulate(repo, sha, 'linux', { signer: 'dim@lin1', status: { unit: 'failed' }, outcome: 'fail', reason: 'suite-failed: unit' });
  simulate(repo, sha, 'linux', { signer: 'dim@lin1' }); // same file name: the red is only in the ref history now
  let v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1, JSON.stringify(v.result));
  assert.ok(reasons(v).includes('record-failed'), reasons(v).join());
  assert.match(JSON.stringify(v.result.reasons), /replaced by a later record/);
  assert.equal(ci(repo, ['status', '--sha', sha, '--repo', 'o/r', '--dry-run']).result.request.body.state, 'failure');

  // a new tree (the fix) starts clean: no inherited red
  repo = fixture({ man: anyManifest() }); sha = feat(repo);
  simulate(repo, sha, 'linux', { signer: 'dim@lin1', outcome: 'fail', reason: 'suite-failed: unit', status: { unit: 'failed' } });
  const sha2 = branch(repo, 'feat2', { 'c.txt': 'c\n' });
  simulate(repo, sha2, 'linux', { signer: 'dim@lin1' });
  assert.equal(ci(repo, ['verify', '--sha', sha2]).code, 0);
});

test('all-of mode on simulated hosts: every listed OS needs a record; one missing is pending; a red on any is red; others are ignored', () => {
  const man = manifest({ os_required: ['linux', 'macos'] });
  let repo = fixture({ man }); let sha = feat(repo);
  simulate(repo, sha, 'linux');
  let v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 2); assert.deepEqual(v.result.missing_os, ['macos']);
  assert.equal(ci(repo, ['status', '--sha', sha, '--repo', 'o/r', '--dry-run']).result.request.body.description, 'waiting for macos record');
  simulate(repo, sha, 'windows', { signer: 'dim@win2' }); // not in os_required: ignored
  assert.equal(ci(repo, ['verify', '--sha', sha]).code, 2);
  simulate(repo, sha, 'macos');
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 0, JSON.stringify(v)); assert.deepEqual(v.result.records.map((x) => x.os).sort(), ['linux', 'macos']);
  assert.equal(ci(repo, ['verify', '--sha', sha, '--os', 'linux']).code, 0);

  repo = fixture({ man }); sha = feat(repo);
  simulate(repo, sha, 'linux'); simulate(repo, sha, 'macos', { status: { unit: 'failed' }, outcome: 'fail', reason: 'suite-failed: unit' });
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.ok(reasons(v).includes('suite-failed'));

  // the local-merge shape: --os limits the check to one host, even in any-mode
  repo = fixture({ man: anyManifest() }); sha = feat(repo);
  simulate(repo, sha, 'linux');
  assert.equal(ci(repo, ['verify', '--sha', sha, '--os', 'linux']).code, 0);
  assert.equal(ci(repo, ['verify', '--sha', sha, '--os', 'macos']).code, 2);
});

test('a missing required OS is pending (exit 2) naming the OS; --os limits the check to one host (real host record)', () => {
  const repo = fixture({ man: manifest({ os_required: [HOST, OTHER] }) });
  const sha = feat(repo);
  publish(repo, sha);
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 2, JSON.stringify(v)); assert.equal(v.result.verdict, 'pending'); assert.deepEqual(v.result.missing_os, [OTHER]);
  const s = ci(repo, ['status', '--sha', sha, '--repo', 'o/r', '--dry-run']);
  assert.equal(s.result.request.body.state, 'pending'); assert.equal(s.result.request.body.description, `waiting for ${OTHER} record`);
  assert.equal(ci(repo, ['verify', '--sha', sha, '--os', HOST]).code, 0);
});

test('the legacy record.<os>.json file name is still read', () => {
  const repo = fixture({ man: anyManifest() });
  const sha = feat(repo);
  const f = simulate(repo, sha, 'linux', { signer: 'dim@lin1' });
  putRef(repo, treeOf(repo, sha), { 'record.linux.json': fs.readFileSync(f), 'record.linux.json.sig': fs.readFileSync(`${f}.sig`) });
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 0, JSON.stringify(v)); assert.deepEqual(v.result.records.map((x) => x.os), ['linux']);
});

test('a failing required suite writes a red record and verify names the suite; flaky passes on retry', () => {
  const repo = fixture({ man: manifest({ suites: [{ id: 'unit', run: [node('process.exit(1)')], required: true, os: 'any' }] }) });
  const sha = feat(repo);
  const o = path.join(ROOT, `o${++n}`);
  const r = ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]);
  assert.equal(r.code, 1); assert.equal(r.result.outcome, 'fail'); assert.match(r.result.reason, /^suite-failed: unit/);
  ci(repo, ['sign', r.result.record, '--key', KEY]); ci(repo, ['publish', r.result.record, '--no-push']);
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.ok(reasons(v).includes('suite-failed')); assert.match(JSON.stringify(v.result.reasons), /unit failed on/);
  assert.equal(ci(repo, ['status', '--sha', sha, '--repo', 'o/r', '--dry-run']).result.request.body.state, 'failure');

  // flaky: fails once, passes on the retry
  const flag = path.join(ROOT, `flag${n}`).replace(/\\/g, '/');
  const code = `const f='${flag}';const fs=require('fs');if(fs.existsSync(f)){process.exit(0)}fs.writeFileSync(f,'x');process.exit(1)`;
  const repo2 = fixture({ man: manifest({ suites: [{ id: 'unit', run: [node(code)], required: true, os: 'any' }] }) });
  const sha2 = feat(repo2);
  const r2 = ci(repo2, ['run', '--checkout', '--sha', sha2, '--out', path.join(ROOT, `o${++n}`)]);
  assert.equal(r2.code, 0); assert.deepEqual(r2.result.suites, [{ id: 'unit', status: 'flaky' }]);
});

test('host not capable: a pin the host does not meet writes NO record, exits 3 with error.code host-not-capable, every gap listed', () => {
  const repo = fixture({ man: manifest({ toolchain: { node: '999', git: { version: '999', probe: 'git --version' } } }) });
  const sha = feat(repo);
  const o = path.join(ROOT, `o${++n}`);
  const r = ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]);
  assert.equal(r.ok, false); assert.equal(r.code, 3); assert.equal(r.error.code, 'host-not-capable');
  assert.match(r.error.message, /node: have \d+/); assert.match(r.error.message, /git: have \d+/);
  assert.deepEqual(fs.existsSync(o) ? fs.readdirSync(o).filter((x) => x.startsWith('record.')) : [], []);
  // and without --checkout, on a clean detached checkout
  g(repo, 'checkout', '-q', '--detach', sha);
  const r2 = ci(repo, ['run', '--out', o]);
  assert.equal(r2.error.code, 'host-not-capable'); assert.equal(r2.code, 3);
  assert.deepEqual(fs.existsSync(o) ? fs.readdirSync(o).filter((x) => x.startsWith('record.')) : [], []);
});

test('run --preflight probes only: exit 0 when capable, host-not-capable (no record, no checkout needed) when not', () => {
  let repo = fixture();
  let r = ci(repo, ['run', '--preflight']); // an attached checkout is fine for a preflight
  assert.equal(r.code, 0, JSON.stringify(r)); assert.equal(r.result.preflight, true); assert.equal(r.result.capable, true); assert.equal(r.result.os, HOST);
  repo = fixture({ man: manifest({ toolchain: { node: '999' } }) });
  r = ci(repo, ['run', '--preflight']);
  assert.equal(r.code, 3); assert.equal(r.error.code, 'host-not-capable');
});

test('toolchain_os is merged over toolchain for that OS only: run, preflight and verify', () => {
  // run: this host's override makes it incapable; another OS's override is invisible to it
  let repo = fixture({ man: anyManifest({ toolchain_os: { [HOST]: { node: '999' } } }) });
  assert.equal(ci(repo, ['run', '--preflight']).error.code, 'host-not-capable');
  repo = fixture({ man: anyManifest({ toolchain_os: { [OTHER]: { node: '999' } } }) });
  const sha = feat(repo);
  assert.equal(ci(repo, ['run', '--preflight']).code, 0);
  publish(repo, sha);
  assert.equal(ci(repo, ['verify', '--sha', sha]).code, 0);
  // custom {version, probe} entries are probed and recorded
  repo = fixture({ man: anyManifest({ toolchain_os: { [HOST]: { git: { version: '2', probe: 'git --version' } } } }) });
  const sha2 = feat(repo);
  const { rec: f } = publish(repo, sha2);
  assert.match(JSON.parse(fs.readFileSync(f, 'utf8')).toolchain.probes.git, /^2\./);
  assert.equal(ci(repo, ['verify', '--sha', sha2]).code, 0);

  // verify: a simulated macos record is checked against toolchain + toolchain_os.macos
  const man = anyManifest({ toolchain: { node: '999' }, toolchain_os: { macos: { node: '1' } } });
  repo = fixture({ man }); const sha3 = feat(repo);
  simulate(repo, sha3, 'macos', { probes: { node: '1.2.3' } });
  assert.equal(ci(repo, ['verify', '--sha', sha3]).code, 0);
  simulate(repo, sha3, 'linux', { probes: { node: '1.2.3' } });  // linux keeps the base pin 999: ignored, macos still carries the pass
  const v = ci(repo, ['verify', '--sha', sha3]);
  assert.equal(v.code, 0); assert.deepEqual(notes(v), ['toolchain-mismatch']);
});

test('path selection: skipped:path is agreed when the diff misses the paths, and rejected when it hits them', () => {
  const man = manifest({ suites: [{ id: 'docs', run: [node('process.exit(0)')], required: true, os: 'any', paths: ['docs/**'] }] });
  let repo = fixture({ man });
  let sha = branch(repo, 'feat', { 'src/x.txt': 'x\n' });
  let r = ci(repo, ['run', '--checkout', '--sha', sha, '--out', path.join(ROOT, `o${++n}`)]);
  assert.deepEqual(r.result.suites, [{ id: 'docs', status: 'skipped:path' }]);
  publish(repo, sha);
  assert.equal(ci(repo, ['verify', '--sha', sha]).code, 0);

  repo = fixture({ man });
  sha = branch(repo, 'feat', { 'docs/y.md': 'y\n' });
  const o = path.join(ROOT, `o${++n}`);
  const f = ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]).result.record;
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); assert.equal(j.suites[0].status, 'passed'); j.suites[0].status = 'skipped:path';
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
  ci(repo, ['sign', f, '--key', KEY]); ci(repo, ['publish', f, '--no-push']);
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.deepEqual(reasons(v), ['skipped-path-abuse']);
});

test('if_exists: an absent guard file records skipped:absent; claiming it when the file exists fails', () => {
  const man = manifest({ suites: [{ id: 'cargo', run: [node('process.exit(1)')], required: true, os: 'any', if_exists: ['Cargo.toml'] }] });
  let repo = fixture({ man });
  let sha = feat(repo);
  assert.deepEqual(ci(repo, ['run', '--checkout', '--sha', sha, '--out', path.join(ROOT, `o${++n}`)]).result.suites, [{ id: 'cargo', status: 'skipped:absent' }]);
  publish(repo, sha);
  assert.equal(ci(repo, ['verify', '--sha', sha]).code, 0);

  repo = fixture({ man });
  sha = branch(repo, 'feat', { 'Cargo.toml': '[package]\n' });
  const o = path.join(ROOT, `o${++n}`);
  const f = ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]).result.record;
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.suites[0].status = 'skipped:absent'; j.outcome = 'pass';
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
  ci(repo, ['sign', f, '--key', KEY]); ci(repo, ['publish', f, '--no-push']);
  assert.deepEqual(reasons(ci(repo, ['verify', '--sha', sha])), ['skipped-absent-abuse']);
});

test('skipped:os is pending ("needs a <os> host") until a host the suite includes passes it; claiming it on an included OS is skipped-os-abuse', () => {
  const man = anyManifest({ suites: [{ id: 'native', run: [node('process.exit(0)')], required: true, os: OTHER }] });
  // the real host (not OTHER) honestly skips the suite
  let repo = fixture({ man });
  let sha = feat(repo);
  assert.deepEqual(publish(repo, sha).run.result.suites, [{ id: 'native', status: 'skipped:os' }]);
  let v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 2, JSON.stringify(v)); assert.equal(v.result.verdict, 'pending'); assert.deepEqual(v.result.waiting, [`native: needs a ${OTHER} host`]);
  const s = ci(repo, ['status', '--sha', sha, '--repo', 'o/r', '--dry-run']).result.request.body;
  assert.equal(s.state, 'pending'); assert.equal(s.description, `native: needs a ${OTHER} host`);
  // a record from a host the suite includes settles it
  simulate(repo, sha, OTHER);
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 0, JSON.stringify(v));

  // abuse: the OTHER-host record itself claims skipped:os on its own OS
  repo = fixture({ man }); sha = feat(repo);
  simulate(repo, sha, OTHER, { status: { native: 'skipped:os' } });
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.deepEqual(reasons(v), ['skipped-os-abuse']); assert.match(v.result.reasons[0].detail, new RegExp(`on a ${OTHER} record`));

  // and an os:any suite can never be skipped:os anywhere
  repo = fixture({ man: anyManifest() }); sha = feat(repo);
  simulate(repo, sha, 'linux', { status: { unit: 'skipped:os' } });
  assert.deepEqual(reasons(ci(repo, ['verify', '--sha', sha])), ['skipped-os-abuse']);
});

test('lint: in all-of mode a suite os outside os_required is refused (no host could run it); any-mode allows it', () => {
  const bad = fixture({ man: manifest({ os_required: ['linux'], suites: [{ id: 'native', run: ['x'], required: true, os: 'windows' }] }) });
  const c = ci(bad, ['check-manifest']);
  assert.equal(c.code, 1); assert.match(c.result.findings.join('\n'), /ci\/suites\.json: suites\[0\] \(native\): os "windows" is not in os_required, so no host could run it/);
  assert.equal(ci(fixture({ man: anyManifest({ suites: [{ id: 'native', run: ['x'], required: true, os: 'windows' }] }) }), ['check-manifest']).code, 0);
  assert.equal(ci(fixture({ man: manifest({ os_required: ['linux', 'windows'], suites: [{ id: 'native', run: ['x'], required: true, os: 'windows' }] }) }), ['check-manifest']).code, 0);
  const t = ci(fixture({ man: anyManifest({ toolchain_os: { beos: {}, linux: { nope: '1' } } }) }), ['check-manifest']);
  assert.match(t.result.findings.join('\n'), /toolchain_os: unknown OS "beos"/); assert.match(t.result.findings.join('\n'), /toolchain_os\.linux\.nope: no built-in probe/);
});

test('1.5.0 gates only .standards/ci-local: ci/suites.json, ci/scripts/** and .github edits pass with no approval; a ci-local edit fails manifest-changed unless --approved', () => {
  let repo = fixture();
  let sha = branch(repo, 'feat', { 'ci/suites.json': manifest({ suites: [{ id: 'unit', run: [node('process.exit(0)')], required: false, os: 'any' }] }) });
  publish(repo, sha);
  let v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 0, JSON.stringify(v)); assert.ok(!reasons(v).includes('manifest-changed'));

  repo = fixture({ man: anyManifest() });
  sha = branch(repo, 'feat', { 'ci/scripts/secret-scan.mjs': 'process.exit(0)\n', '.github/workflows/x.yml': 'on: push\n' });
  simulate(repo, sha, 'linux');
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 0, JSON.stringify(v));

  repo = fixture({ man: anyManifest() });
  sha = branch(repo, 'feat', { '.standards/ci-local/templates/x.json': '{}\n' });
  simulate(repo, sha, 'linux');
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.deepEqual(reasons(v), ['manifest-changed']); assert.match(v.result.reasons[0].detail, /\.standards\/ci-local\/templates\/x\.json/);
  assert.doesNotMatch(v.result.reasons[0].detail, /label/i);
  assert.equal(ci(repo, ['verify', '--sha', sha, '--approved']).code, 0);
});

test('1.5.0 --approved is a supported flag: no deprecation or label wording in the source', () => {
  const src = fs.readFileSync(CI_SRC, 'utf8');
  assert.doesNotMatch(src, /deprecated/i); assert.doesNotMatch(src, /ci-manifest-approved/); assert.doesNotMatch(src, /label/i);
});

test('1.5.0 status: a default-branch suite id missing from the head ci/suites.json adds "; suites dropped: <ids>" to the status description and the result', () => {
  const some = (ids) => anyManifest({ suites: ids.map((id) => ({ id, run: [node('process.exit(0)')], required: false, os: 'any' })) });
  const repo = fixture({ man: some(['unit', 'lint', 'docs']) });
  const sha = branch(repo, 'feat', { 'ci/suites.json': some(['unit']) });
  simulate(repo, sha, 'linux');
  const d = ci(repo, ['status', '--sha', sha, '--repo', 'acme/widgets', '--dry-run']);
  assert.equal(d.code, 0, JSON.stringify(d)); assert.equal(d.result.verdict, 'pass');
  assert.equal(d.result.request.body.state, 'success');
  assert.equal(d.result.request.body.description, 'signed records verified; suites dropped: lint, docs');
  assert.deepEqual(ci(repo, ['verify', '--sha', sha]).result.suites_dropped, ['lint', 'docs']);
  const ok = branch(repo, 'more', { 'ci/suites.json': some(['unit', 'lint', 'docs', 'extra']) });
  simulate(repo, ok, 'linux');
  assert.equal(ci(repo, ['status', '--sha', ok, '--repo', 'acme/widgets', '--dry-run']).result.request.body.description, 'signed records verified');
});

test('run refuses a dirty or non-detached checkout and an invalid manifest', () => {
  const repo = fixture();
  let r = ci(repo, ['run']);
  assert.equal(r.ok, false); assert.equal(r.error.code, 'not-clean-checkout'); assert.equal(r.code, 1);
  const bad = fixture({ man: JSON.stringify({ schema: 'ci-local/1', suites: [{ id: 'x', run: ['a'], required: true }] }) });
  const sha = bad && g(bad, 'rev-parse', 'HEAD');
  r = ci(bad, ['run', '--checkout', '--sha', sha, '--out', path.join(ROOT, `o${++n}`)]);
  assert.equal(r.error.code, 'manifest-invalid'); assert.match(r.error.message, /os_required is mandatory/);
});

test('check-manifest: a clean manifest passes; a missing os_required and a wildcard signer fail naming the file', () => {
  const repo = fixture();
  assert.equal(ci(repo, ['check-manifest']).code, 0);
  assert.equal(ci(fixture({ man: anyManifest() }), ['check-manifest']).code, 0);
  fs.writeFileSync(path.join(repo, 'ci/suites.json'), JSON.stringify({ schema: 'ci-local/1', suites: [{ id: 'a', run: ['x'], required: true }] }));
  fs.writeFileSync(path.join(repo, '.standards/ci-local/allowed_signers.org'), `* namespaces="ci-result@hhay" ${pub(KEY)}\n`);
  const c = ci(repo, ['check-manifest']);
  assert.equal(c.code, 1);
  const f = c.result.findings.join('\n');
  assert.match(f, /ci\/suites\.json: os_required is mandatory/); assert.match(f, /allowed_signers\.org:1: wildcard principal "\*"/); assert.match(f, /allowed_signers\.org:1: missing valid-before/);
});

test('status --dry-run prints the exact request; a real POST sends it with the token; no token fails', async () => {
  const repo = fixture();
  const sha = feat(repo);
  publish(repo, sha);
  const tree = treeOf(repo, sha);
  const d = ci(repo, ['status', '--sha', sha, '--repo', 'acme/widgets', '--dry-run']);
  assert.equal(d.code, 0);
  assert.deepEqual(d.result.request, {
    method: 'POST',
    url: `https://api.github.com/repos/acme/widgets/statuses/${sha}`,
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer <GH_TOKEN>', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': `ci-local/${VERSION}` },
    body: { state: 'success', context: 'builder-ci', description: 'signed records verified', target_url: `https://github.com/acme/widgets/tree/refs/ci/${tree}` },
  });

  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { got.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }); res.writeHead(201); res.end('{}'); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const run = async (extra) => {
      const { stdout } = await promisify(execFile)(process.execPath, [path.join(repo, '.standards/ci-local/ci.mjs'), 'status', '--sha', sha, '--repo', 'acme/widgets', '--api-base', base, '--json'], { cwd: repo, env: { ...env, ...extra } }).catch((e) => e);
      return JSON.parse(stdout);
    };
    const ok = await run({ GH_TOKEN: 'tok123', GITHUB_TOKEN: '' });
    assert.equal(ok.ok, true, JSON.stringify(ok)); assert.equal(ok.result.http, 201);
    assert.deepEqual(got, [{ url: `/repos/acme/widgets/statuses/${sha}`, auth: 'Bearer tok123', body: d.result.request.body }]);
    const no = await run({ GH_TOKEN: '', GITHUB_TOKEN: '' });
    assert.equal(no.ok, false); assert.equal(no.error.code, 'no-token');
  } finally { srv.close(); }
});

test('1.6.0 status reads no reviews: no CODEOWNERS or review code, no GitHub GET; an approval on the PR does not lift manifest-changed; --approved does', async () => {
  const src = fs.readFileSync(CI_SRC, 'utf8');
  assert.doesNotMatch(src, /codeowners/i); assert.doesNotMatch(src, /\/reviews/); assert.doesNotMatch(src, /commits\/\$\{/);
  assert.equal((await import(pathToFileURL(CI_SRC).href)).codeownersRules, undefined);
  const repo = fixture({ man: anyManifest() });
  fs.mkdirSync(path.join(repo, '.github'));
  fs.writeFileSync(path.join(repo, '.github/CODEOWNERS'), '/.standards/ @owner\n');
  g(repo, 'add', '-A'); g(repo, 'commit', '-q', '-m', 'codeowners');
  const sha = branch(repo, 'feat', { '.standards/ci-local/templates/x.json': '{}\n' });
  simulate(repo, sha, 'linux');
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      seen.push(`${req.method} ${req.url}`);
      if (req.method === 'GET') { res.writeHead(200); res.end(JSON.stringify([{ number: 7, state: 'open', head: { sha }, user: { login: 'owner' }, commit_id: sha }])); return; }
      res.writeHead(201); res.end('{}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const status = async (extra = []) => {
      const { stdout } = await promisify(execFile)(process.execPath, [path.join(repo, '.standards/ci-local/ci.mjs'), 'status', '--sha', sha, '--repo', 'acme/widgets', '--api-base', base, '--default-branch', 'main', '--json', ...extra], { cwd: repo, env: { ...env, GH_TOKEN: 'tok', GITHUB_TOKEN: '' } }).catch((e) => e);
      return JSON.parse(stdout).result;
    };
    let s = await status();
    assert.equal(s.verdict, 'fail'); assert.equal(s.manifest_approval, undefined);
    s = await status(['--approved']);
    assert.equal(s.verdict, 'pass', JSON.stringify(s));
    assert.deepEqual(seen, [`POST /repos/acme/widgets/statuses/${sha}`, `POST /repos/acme/widgets/statuses/${sha}`], 'only status POSTs, no GET');
  } finally { srv.close(); }
});

test('envelope and exit codes: unknown verb is usage (64); the vendored check.json lists the manifest command', () => {
  const repo = fixture();
  const r = ci(repo, ['bogus']);
  assert.equal(r.code, 64); assert.equal(r.ok, false); assert.equal(r.error.code, 'usage');
  const cj = JSON.parse(fs.readFileSync(path.join(DIR, '.standards/ci-local/check.json'), 'utf8'));
  assert.deepEqual(cj.commands, [{ id: 'manifest', tool: 'ci', run: ['node', '.standards/ci-local/ci.mjs', 'check-manifest'] }]);
});

test('compat: a tree that vendors 1.0.1 still runs, signs, publishes and verifies with its own 1.0.1 ci.mjs', () => {
  const repo = fixture({ ciSrc: CI_101 }); // os_required list form, the only form 1.0.1 knows
  const sha = feat(repo);
  const o = path.join(ROOT, `o${++n}`);
  const r = ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]);
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.equal(path.basename(r.result.record), `record.${HOST}.json`); // 1.0.1 writes the legacy name
  assert.equal(JSON.parse(fs.readFileSync(r.result.record, 'utf8')).ci_local_version, '1.0.0');
  assert.equal(ci(repo, ['sign', r.result.record, '--key', KEY]).ok, true);
  assert.equal(ci(repo, ['publish', r.result.record, '--no-push']).ok, true);
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 0, JSON.stringify(v)); assert.equal(v.result.verdict, 'pass');
  assert.equal(ci(repo, ['status', '--sha', sha, '--repo', 'o/r', '--dry-run']).result.request.body.state, 'success');
  // 1.1.0 reading the same ref ignores the 1.0.x record (version mismatch -> a re-run), it does not fail the PR
  const forward = path.join(repo, '.standards/ci-local/ci.mjs');
  fs.copyFileSync(CI_SRC, forward); g(repo, 'add', '-A'); g(repo, 'commit', '-q', '-m', 'resync');
  const r2 = spawnSync(process.execPath, [forward, 'verify', '--sha', sha, '--default-branch', 'main', '--approved', '--json'], { cwd: repo, encoding: 'utf8', env });
  const j = JSON.parse(r2.stdout);
  assert.equal(r2.status, 2); assert.deepEqual(j.result.notes.map((x) => x.code), ['ci-version-mismatch']);
});

test('pins are minimums: dotted-number >=, missing parts 0; exact opts one pin into equal-or-dot-extension', async () => {
  const { versionMatches } = await import(pathToFileURL(CI_SRC).href);
  for (const [pin, have] of [['1.99', '1.100.0'], ['1.99', '1.99'], ['1.99', '1.99.4'], ['22', '26.1.0'], ['1.23', '1.26.2'], ['1.2', '1.2.0'], ['v1.2', 'v1.10']]) assert.equal(versionMatches(pin, have), true, `${pin} <= ${have}`);
  for (const [pin, have] of [['1.100', '1.99.9'], ['26', '22.3.0'], ['1.2.1', '1.2'], ['2', null]]) assert.equal(versionMatches(pin, have), false, `${pin} > ${have}`);
  assert.equal(versionMatches({ version: '1.99', exact: true }, '1.100'), false);
  assert.equal(versionMatches({ version: '1.99', exact: true }, '1.99.2'), true);
  assert.equal(versionMatches({ version: '1.99', exact: false }, '1.100'), true);
  assert.equal(versionMatches('stable', 'stable'), true); assert.equal(versionMatches('stable', '1.2'), false);
});

test('run: a host newer than the pin is capable and the record stores the ACTUAL version; an exact pin it does not equal is host-not-capable', () => {
  const major = Number(process.versions.node.split('.')[0]);
  const repo = fixture({ man: manifest({ toolchain: { node: String(major - 1) } }) });
  const sha = feat(repo);
  assert.equal(ci(repo, ['run', '--preflight']).code, 0);
  const { rec: f } = publish(repo, sha);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).toolchain.probes.node, process.versions.node);
  assert.equal(ci(repo, ['verify', '--sha', sha]).code, 0);
  const ex = fixture({ man: manifest({ toolchain: { node: { version: String(major - 1), exact: true } } }) });
  const r = ci(ex, ['run', '--preflight']);
  assert.equal(r.code, 3); assert.equal(r.error.code, 'host-not-capable'); assert.match(r.error.message, /node: have .*exact pin/);
  assert.equal(ci(fixture({ man: manifest({ toolchain: { node: { version: String(major), exact: true } } }) }), ['run', '--preflight']).code, 0);
});

test('verify: a record whose probe is above the pin passes (1.100 vs 1.99); an exact pin ignores it as toolchain-mismatch; lint takes exact', () => {
  const tc = { rustc: { version: '1.99', probe: 'git --version' } };
  let repo = fixture({ man: anyManifest({ toolchain: tc }) }); let sha = feat(repo);
  simulate(repo, sha, 'linux', { probes: { rustc: '1.100.0' } });
  assert.equal(ci(repo, ['verify', '--sha', sha]).code, 0);
  repo = fixture({ man: anyManifest({ toolchain: { rustc: { ...tc.rustc, exact: true } } }) }); sha = feat(repo);
  simulate(repo, sha, 'linux', { probes: { rustc: '1.100.0' } });
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 2); assert.deepEqual(notes(v), ['toolchain-mismatch']);
  assert.equal(ci(fixture({ man: anyManifest({ toolchain: { node: { version: '1', exact: 'yes' } } }) }), ['check-manifest']).code, 1);
  assert.equal(ci(fixture({ man: anyManifest({ toolchain: { node: { version: '1', exact: true } } }) }), ['check-manifest']).code, 0);
});

test('no manifest: run reports error.code no-manifest; verify of a tree without ci/suites.json is PENDING (exit 2, "no-manifest: ..."), not red', () => {
  const repo = fixture();
  g(repo, 'checkout', '-q', '-b', 'old', 'main'); g(repo, 'rm', '-q', 'ci/suites.json'); g(repo, 'commit', '-q', '-m', 'no manifest');
  const sha = g(repo, 'rev-parse', 'HEAD'); g(repo, 'checkout', '-q', 'main');
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 2, JSON.stringify(v)); assert.equal(v.result.verdict, 'pending'); assert.deepEqual(reasons(v), []);
  assert.match(v.result.waiting[0], /^no-manifest: ci\/suites\.json not at /);
  const st = ci(repo, ['status', '--sha', sha, '--repo', 'o/r', '--dry-run']);
  assert.match(JSON.stringify(st), /"state":\s*"pending"/); assert.match(JSON.stringify(st), /no-manifest/);
  g(repo, 'checkout', '-q', '--detach', sha);
  const r = ci(repo, ['run']);
  assert.equal(r.code, 1); assert.equal(r.error.code, 'no-manifest');
});

// ---- 1.2.0: stack templates + `ci init` ----
const STACKS = ['dotnet', 'node', 'python-uv', 'rust', 'static-site'];
function initRepo() {
  const repo = path.join(ROOT, `init${++n}`);
  fs.mkdirSync(path.join(repo, '.standards'), { recursive: true });
  fs.cpSync(path.join(DIR, '.standards/ci-local'), path.join(repo, '.standards/ci-local'), { recursive: true });
  sh('git', ['init', '-q', '-b', 'main'], repo);
  return repo;
}

test('init: every shipped stack template passes check-manifest, is os_required any with os-any suites and the secret-scan suite', () => {
  const dir = path.join(DIR, '.standards/ci-local/templates');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort(), STACKS);
  for (const s of STACKS) {
    const repo = initRepo();
    const r = ci(repo, ['init', '--stack', s]);
    assert.equal(r.code, 0, `${s}: ${JSON.stringify(r)}`);
    assert.deepEqual(r.result.written, ['ci/suites.json', 'ci/scripts/secret-scan.mjs']);
    const m = JSON.parse(fs.readFileSync(path.join(repo, 'ci/suites.json'), 'utf8'));
    assert.equal(m.os_required, 'any');
    assert.ok(m.suites.every((x) => x.os === 'any' && x.required === true), s);
    assert.ok(m.suites.some((x) => x.id === 'secret-scan' && x.run[0] === 'node ci/scripts/secret-scan.mjs'), s);
    assert.equal(ci(repo, ['check-manifest']).code, 0, `${s}: ${JSON.stringify(ci(repo, ['check-manifest']))}`);
    if (s === 'rust') assert.equal(m.toolchain_os.windows.gcc.probe, 'gcc --version');
  }
});

test('init: refuses an existing manifest without --force, unknown/missing stack is usage, secret-scan finds shapes and never prints them', () => {
  const repo = initRepo();
  assert.equal(ci(repo, ['init', '--stack', 'node']).code, 0);
  const again = ci(repo, ['init', '--stack', 'rust']);
  assert.equal(again.code, 1); assert.equal(again.error.code, 'exists');
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, 'ci/suites.json'), 'utf8')).toolchain.node, '20');
  assert.equal(ci(repo, ['init', '--stack', 'rust', '--force']).code, 0);
  assert.equal(ci(repo, ['init', '--stack', 'cobol', '--force']).code, 64);
  assert.equal(ci(repo, ['init']).code, 64);
  // the scanner: clean tree passes; a planted token fails naming file:line + rule only
  const scan = () => spawnSync(process.execPath, ['ci/scripts/secret-scan.mjs'], { cwd: repo, encoding: 'utf8' });
  g(repo, 'add', '-A');
  assert.equal(scan().status, 0, scan().stdout);
  const tok = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
  fs.writeFileSync(path.join(repo, 'cfg.txt'), `ok\ntoken = ${tok}\n`);
  g(repo, 'add', '-A');
  const bad = scan();
  assert.equal(bad.status, 1); assert.match(bad.stdout, /cfg\.txt:2: github-token/); assert.ok(!bad.stdout.includes(tok));
  fs.writeFileSync(path.join(repo, 'cfg.txt'), `token = ${tok} # secret-scan:allow\n`);
  assert.equal(scan().status, 0);
});
