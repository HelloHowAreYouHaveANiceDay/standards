// ci-local 1.0.0: run / sign / publish / verify / status / check-manifest against fixture repos with a throwaway
// ed25519 key. Every failure mode asserts a NAMED reason. ssh-keygen -Y and git are real; nothing touches GitHub
// (status POSTs go to a local http server).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { KIT_ROOT, tmpdir } from './helpers.mjs';

const DIR = process.env.CI_LOCAL_SRC ? path.join(KIT_ROOT, 'src/profiles/ci-local') : path.join(KIT_ROOT, 'profiles/ci-local/1.0.0');
const CI_SRC = path.join(DIR, '.standards/ci-local/ci.mjs');
const HOST = { win32: 'windows', linux: 'linux', darwin: 'macos' }[process.platform];
const OTHER = HOST === 'linux' ? 'windows' : 'linux';
const sh = (cmd, args, cwd, input) => { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', input }); assert.equal(r.status, 0, `${cmd} ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const g = (cwd, ...a) => sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], cwd);

const ROOT = tmpdir('ci-local-');
const KEY = path.join(ROOT, 'k');
const KEY2 = path.join(ROOT, 'k2');
sh('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'test', '-f', KEY]);
sh('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'test2', '-f', KEY2]);
const pub = (k) => fs.readFileSync(`${k}.pub`, 'utf8').trim().split(' ').slice(0, 2).join(' ');
const signers = (valid = '20991231') => `# fixture\ndim@test namespaces="ci-result@hhay",valid-before="${valid}" ${pub(KEY)}\n`;
const node = (code) => `node -e "${code}"`;
const manifest = (over = {}) => JSON.stringify({ schema: 'ci-local/1', os_required: [HOST], toolchain: { node: process.versions.node.split('.')[0] }, setup: [], suites: [{ id: 'unit', run: [node('process.exit(0)')], required: true, os: 'any', paths: ['**'], timeout_min: 2 }], ...over }, null, 2);

let n = 0;
// A repo whose main has ci.mjs + manifest + signers; returns {repo, main, ci(args), out}.
function fixture({ man = manifest(), sig = signers() } = {}) {
  const repo = path.join(ROOT, `r${++n}`);
  fs.mkdirSync(path.join(repo, '.standards/ci-local'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'ci'));
  fs.copyFileSync(CI_SRC, path.join(repo, '.standards/ci-local/ci.mjs'));
  fs.writeFileSync(path.join(repo, '.standards/ci-local/allowed_signers.org'), sig);
  fs.writeFileSync(path.join(repo, 'ci/suites.json'), man);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  sh('git', ['init', '-q', '-b', 'main'], repo);
  g(repo, 'add', '-A'); g(repo, 'commit', '-q', '-m', 'main');
  return repo;
}
const env = { ...process.env, CI_SIGNER: 'dim@test' };
function ci(repo, args) {
  const r = spawnSync(process.execPath, [path.join(repo, '.standards/ci-local/ci.mjs'), ...args, '--json'], { cwd: repo, encoding: 'utf8', env });
  let j; try { j = JSON.parse(r.stdout); } catch { assert.fail(`no envelope (exit ${r.status}): ${r.stdout}${r.stderr}`); }
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
// run + sign + publish (local ref only) for a commit; returns the record path.
function publish(repo, sha, { key = KEY, out } = {}) {
  const o = out ?? path.join(repo, '..', `out-${sha.slice(0, 8)}-${n}`);
  const r = ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]);
  const rec = path.join(o, `record.${HOST}.json`);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(ci(repo, ['sign', rec, '--key', key]).ok, true);
  assert.equal(ci(repo, ['publish', rec, '--no-push']).ok, true);
  return { rec, run: r };
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

test('a passing manifest run + sign + publish + verify succeeds; a second run reuses the record', () => {
  const repo = fixture();
  const sha = branch(repo, 'feat', { 'b.txt': 'b\n' });
  const { rec, run } = publish(repo, sha);
  assert.equal(run.result.outcome, 'pass');
  assert.deepEqual(run.result.suites, [{ id: 'unit', status: 'passed' }]);
  const r = JSON.parse(fs.readFileSync(rec, 'utf8'));
  assert.equal(r.tree, treeOf(repo, sha)); assert.equal(r.signer, 'dim@test'); assert.equal(r.os, HOST); assert.equal(r.ci_local_version, '1.0.0');
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 0, JSON.stringify(v)); assert.equal(v.result.verdict, 'pass'); assert.deepEqual(v.result.records.map((x) => x.os), [HOST]);
  assert.equal(ci(repo, ['run', '--checkout', '--sha', sha, '--out', path.dirname(rec)]).result.reuse, true);
});

test('publish keeps the other OS record already on the ref', () => {
  const repo = fixture();
  const sha = branch(repo, 'feat', { 'b.txt': 'b\n' });
  const { rec } = publish(repo, sha);
  const other = path.join(path.dirname(rec), `record.${OTHER}.json`);
  const j = JSON.parse(fs.readFileSync(rec, 'utf8')); j.os = OTHER; j.toolchain.os = OTHER;
  fs.writeFileSync(other, JSON.stringify(j));
  ci(repo, ['sign', other, '--key', KEY]); ci(repo, ['publish', other, '--no-push']);
  const names = g(repo, 'ls-tree', '--name-only', `refs/ci/${treeOf(repo, sha)}`).split('\n');
  assert.deepEqual(names, [`record.${HOST}.json`, `record.${HOST}.json.sig`, `record.${OTHER}.json`, `record.${OTHER}.json.sig`, 'summary.txt'].sort());
});

test('publish pushes refs/ci/<tree> to a remote and verify fetches it in a fresh clone', () => {
  const repo = fixture();
  const bare = path.join(ROOT, `bare${++n}.git`);
  sh('git', ['init', '-q', '--bare', '-b', 'main', bare], ROOT);
  g(repo, 'remote', 'add', 'origin', bare); g(repo, 'push', '-q', 'origin', 'main');
  const sha = branch(repo, 'feat', { 'b.txt': 'b\n' }); g(repo, 'push', '-q', 'origin', 'feat');
  const o = path.join(ROOT, `out${++n}`);
  ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]);
  ci(repo, ['sign', path.join(o, `record.${HOST}.json`), '--key', KEY]);
  const p = ci(repo, ['publish', path.join(o, `record.${HOST}.json`)]);
  assert.equal(p.result.pushed, true, JSON.stringify(p));
  const clone = path.join(ROOT, `clone${++n}`);
  sh('git', ['clone', '-q', bare, clone], ROOT);
  g(clone, 'fetch', '-q', 'origin', 'feat:feat');
  const v = ci(clone, ['verify', '--sha', 'feat']);
  assert.equal(v.code, 0, JSON.stringify(v));
});

test('verify fails with a named reason: no record, tampered record, unsigned, wrong signer, expired key', () => {
  let repo = fixture();
  let sha = branch(repo, 'feat', { 'b.txt': 'b\n' });
  let v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.deepEqual(reasons(v), ['no-record']);

  // tampered: edit the record after signing
  let { rec } = (() => {
    const o = path.join(ROOT, `o${++n}`);
    ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]);
    const f = path.join(o, `record.${HOST}.json`);
    ci(repo, ['sign', f, '--key', KEY]);
    const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.suites[0].status = 'passed'; j.created = '2000-01-01T00:00:00Z';
    fs.writeFileSync(f, JSON.stringify(j, null, 2));
    ci(repo, ['publish', f, '--no-push']);
    return { rec: f };
  })();
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.deepEqual(reasons(v), ['bad-signature']);

  // unsigned: record on the ref without a .sig
  const tree = treeOf(repo, sha);
  putRef(repo, tree, { [`record.${HOST}.json`]: fs.readFileSync(rec) });
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.deepEqual(reasons(v), ['unsigned']); assert.match(v.result.reasons[0].detail, new RegExp(`record\\.${HOST}\\.json has no \\.sig`));

  // wrong signer: valid record signed by a key that is not in allowed signers
  repo = fixture(); sha = branch(repo, 'feat', { 'b.txt': 'b\n' });
  publish(repo, sha, { key: KEY2 });
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.deepEqual(reasons(v), ['bad-signature']);

  // expired key
  repo = fixture({ sig: signers('20200101') }); sha = branch(repo, 'feat', { 'b.txt': 'b\n' });
  publish(repo, sha);
  v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.deepEqual(reasons(v), ['bad-signature']);
});

test('verify fails wrong-tree when a validly signed record for another tree sits on the head tree ref', () => {
  const repo = fixture();
  const a = branch(repo, 'a', { 'b.txt': 'b\n' });
  const b = branch(repo, 'b', { 'c.txt': 'c\n' });
  const { rec } = publish(repo, a);            // record for tree(a), signed
  const files = { [`record.${HOST}.json`]: fs.readFileSync(rec), [`record.${HOST}.json.sig`]: fs.readFileSync(`${rec}.sig`) };
  putRef(repo, treeOf(repo, b), files);        // replay onto tree(b)
  const v = ci(repo, ['verify', '--sha', b]);
  assert.equal(v.code, 1); assert.deepEqual(reasons(v), ['wrong-tree']); assert.match(v.result.reasons[0].detail, /record\.tree .* != head tree/);
});

test('a missing required OS is pending (exit 2) naming the OS; --os limits the check to one host', () => {
  const repo = fixture({ man: manifest({ os_required: [HOST, OTHER] }) });
  const sha = branch(repo, 'feat', { 'b.txt': 'b\n' });
  publish(repo, sha);
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 2, JSON.stringify(v)); assert.equal(v.result.verdict, 'pending'); assert.deepEqual(v.result.missing_os, [OTHER]);
  const s = ci(repo, ['status', '--sha', sha, '--repo', 'o/r', '--dry-run']);
  assert.equal(s.result.request.body.state, 'pending'); assert.equal(s.result.request.body.description, `waiting for ${OTHER} record`);
  assert.equal(ci(repo, ['verify', '--sha', sha, '--os', HOST]).code, 0);
});

test('a failing required suite writes a red record and verify names the suite; flaky passes on retry', () => {
  const repo = fixture({ man: manifest({ suites: [{ id: 'unit', run: [node('process.exit(1)')], required: true, os: 'any' }] }) });
  const sha = branch(repo, 'feat', { 'b.txt': 'b\n' });
  const o = path.join(ROOT, `o${++n}`);
  const r = ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]);
  assert.equal(r.code, 1); assert.equal(r.result.outcome, 'fail'); assert.match(r.result.reason, /^suite-failed: unit/);
  ci(repo, ['sign', path.join(o, `record.${HOST}.json`), '--key', KEY]); ci(repo, ['publish', path.join(o, `record.${HOST}.json`), '--no-push']);
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.ok(reasons(v).includes('suite-failed')); assert.match(JSON.stringify(v.result.reasons), /unit failed on/);
  assert.equal(ci(repo, ['status', '--sha', sha, '--repo', 'o/r', '--dry-run']).result.request.body.state, 'failure');

  // flaky: fails once, passes on the retry
  const flag = path.join(ROOT, `flag${n}`).replace(/\\/g, '/');
  const code = `const f='${flag}';const fs=require('fs');if(fs.existsSync(f)){process.exit(0)}fs.writeFileSync(f,'x');process.exit(1)`;
  const repo2 = fixture({ man: manifest({ suites: [{ id: 'unit', run: [node(code)], required: true, os: 'any' }] }) });
  const sha2 = branch(repo2, 'feat', { 'b.txt': 'b\n' });
  const r2 = ci(repo2, ['run', '--checkout', '--sha', sha2, '--out', path.join(ROOT, `o${++n}`)]);
  assert.equal(r2.code, 0); assert.deepEqual(r2.result.suites, [{ id: 'unit', status: 'flaky' }]);
});

test('toolchain drift: a pin the host does not meet is a red record naming the tool, no suites run', () => {
  const repo = fixture({ man: manifest({ toolchain: { node: '999' } }) });
  const sha = branch(repo, 'feat', { 'b.txt': 'b\n' });
  const r = ci(repo, ['run', '--checkout', '--sha', sha, '--out', path.join(ROOT, `o${++n}`)]);
  assert.equal(r.code, 1); assert.match(r.result.reason, /^toolchain-drift: node: have \d+/); assert.deepEqual(r.result.suites, []);
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
  ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]);
  const f = path.join(o, `record.${HOST}.json`);
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); assert.equal(j.suites[0].status, 'passed'); j.suites[0].status = 'skipped:path';
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
  ci(repo, ['sign', f, '--key', KEY]); ci(repo, ['publish', f, '--no-push']);
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.deepEqual(reasons(v), ['skipped-path-abuse']);
});

test('if_exists: an absent guard file records skipped:absent; claiming it when the file exists fails', () => {
  const man = manifest({ suites: [{ id: 'cargo', run: [node('process.exit(1)')], required: true, os: 'any', if_exists: ['Cargo.toml'] }] });
  let repo = fixture({ man });
  let sha = branch(repo, 'feat', { 'b.txt': 'b\n' });
  assert.deepEqual(ci(repo, ['run', '--checkout', '--sha', sha, '--out', path.join(ROOT, `o${++n}`)]).result.suites, [{ id: 'cargo', status: 'skipped:absent' }]);
  publish(repo, sha);
  assert.equal(ci(repo, ['verify', '--sha', sha]).code, 0);

  repo = fixture({ man });
  sha = branch(repo, 'feat', { 'Cargo.toml': '[package]\n' });
  const o = path.join(ROOT, `o${++n}`);
  ci(repo, ['run', '--checkout', '--sha', sha, '--out', o]);
  const f = path.join(o, `record.${HOST}.json`);
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.suites[0].status = 'skipped:absent'; j.outcome = 'pass';
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
  ci(repo, ['sign', f, '--key', KEY]); ci(repo, ['publish', f, '--no-push']);
  assert.deepEqual(reasons(ci(repo, ['verify', '--sha', sha])), ['skipped-absent-abuse']);
});

test('a suite that only skipped:os fails naming the needed host', () => {
  const other = OTHER;
  const repo = fixture({ man: manifest({ suites: [{ id: 'native', run: [node('process.exit(0)')], required: true, os: other }] }) });
  const sha = branch(repo, 'feat', { 'b.txt': 'b\n' });
  publish(repo, sha);
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.deepEqual(reasons(v), ['skipped-os']); assert.match(v.result.reasons[0].detail, new RegExp(`needs a ${other} host`));
});

test('fail closed: a head that changes ci/suites.json fails manifest-changed unless approved', () => {
  const repo = fixture();
  const sha = branch(repo, 'feat', { 'ci/suites.json': manifest({ suites: [{ id: 'unit', run: [node('process.exit(0)')], required: false, os: 'any' }] }) });
  publish(repo, sha);
  const v = ci(repo, ['verify', '--sha', sha]);
  assert.equal(v.code, 1); assert.ok(reasons(v).includes('manifest-changed')); assert.match(v.result.reasons[0].detail, /ci\/suites\.json/);
  assert.equal(ci(repo, ['verify', '--sha', sha, '--approved']).code, 0);
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
  fs.writeFileSync(path.join(repo, 'ci/suites.json'), JSON.stringify({ schema: 'ci-local/1', suites: [{ id: 'a', run: ['x'], required: true }] }));
  fs.writeFileSync(path.join(repo, '.standards/ci-local/allowed_signers.org'), `* namespaces="ci-result@hhay" ${pub(KEY)}\n`);
  const c = ci(repo, ['check-manifest']);
  assert.equal(c.code, 1);
  const f = c.result.findings.join('\n');
  assert.match(f, /ci\/suites\.json: os_required is mandatory/); assert.match(f, /allowed_signers\.org:1: wildcard principal "\*"/); assert.match(f, /allowed_signers\.org:1: missing valid-before/);
});

test('status --dry-run prints the exact request; a real POST sends it with the token; no token fails', async () => {
  const repo = fixture();
  const sha = branch(repo, 'feat', { 'b.txt': 'b\n' });
  publish(repo, sha);
  const tree = treeOf(repo, sha);
  const d = ci(repo, ['status', '--sha', sha, '--repo', 'acme/widgets', '--dry-run']);
  assert.equal(d.code, 0);
  assert.deepEqual(d.result.request, {
    method: 'POST',
    url: `https://api.github.com/repos/acme/widgets/statuses/${sha}`,
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer <GH_TOKEN>', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'ci-local/1.0.0' },
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

test('envelope and exit codes: unknown verb is usage (64); the vendored VERSION matches check.json', () => {
  const repo = fixture();
  const r = ci(repo, ['bogus']);
  assert.equal(r.code, 64); assert.equal(r.ok, false); assert.equal(r.error.code, 'usage');
  const cj = JSON.parse(fs.readFileSync(path.join(DIR, '.standards/ci-local/check.json'), 'utf8'));
  assert.deepEqual(cj.commands, [{ id: 'manifest', tool: 'ci', run: ['node', '.standards/ci-local/ci.mjs', 'check-manifest'] }]);
  if (!process.env.CI_LOCAL_SRC) assert.equal(cj.version, '1.0.0');
});
