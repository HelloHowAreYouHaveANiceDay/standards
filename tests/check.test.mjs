// check.mjs (vendored, zero-dep): lock verification + fragment commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  KIT_ROOT, SYNC, makeKit, makeFollower, writeProfile, checkJson, node, git, tmpdir,
} from './helpers.mjs';

const check = (repo, ...args) => node([path.join(repo, '.standards', 'check.mjs'), ...args], { cwd: repo });
const sync = (cwd, ...args) => node([SYNC, ...args], { cwd });

// demo profile whose commands are plain node one-liners (no Go needed).
function demoKit(commands) {
  return makeKit((k) => writeProfile(k, 'demo', '1.0.0', {
    '.standards/demo/check.json': checkJson('demo', '1.0.0', { commands }),
  }));
}
function synced(kit, profiles = ['base@1.0.0', 'demo@1.0.0'], files) {
  const repo = makeFollower(files);
  const r = sync(repo, 'init', ...profiles, '--kit', kit);
  assert.equal(r.code, 0, r.out);
  return repo;
}

test('clean synced repo passes', () => {
  const repo = synced(demoKit([{ id: 'hello', tool: 'demo-hello', run: ['node', '-e', "console.log('hello ran')"] }]));
  const r = check(repo);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /hello ran/);
  assert.match(r.out, /standards: OK/);
});

test('a changed vendored byte fails, naming the file and the lock', () => {
  const repo = synced(demoKit([]));
  fs.appendFileSync(path.join(repo, '.editorconfig'), ' ');
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.match(r.out, /standards: FAIL \[lock\] \.editorconfig: sha256 [0-9a-f]{64} != \.standards\/base\.SHA256SUMS/);
});

test('a CRLF checkout of a vendored file fails the lock (renormalize first)', () => {
  const repo = synced(demoKit([]));
  const f = path.join(repo, '.standards', 'RULES.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\n/g, '\r\n'));
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL \[lock\] \.standards\/RULES\.md/);
});

test('a missing vendored file, an unlisted file in .standards/, and a stray lock all fail', () => {
  const repo = synced(demoKit([]));
  fs.rmSync(path.join(repo, '.gitattributes'));
  fs.writeFileSync(path.join(repo, '.standards', 'extra.txt'), 'x\n');
  fs.writeFileSync(path.join(repo, '.standards', 'ghost.SHA256SUMS'), '');
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL \[lock\] \.gitattributes: missing/);
  assert.match(r.out, /FAIL \[lock\] \.standards\/extra\.txt: not listed in any lock/);
  assert.match(r.out, /FAIL \[lock\] \.standards\/ghost\.SHA256SUMS: profile ghost is not in \.standards\.json/);
});

test('manifest version that does not match the locked fragment fails (manifest edited without sync)', () => {
  const repo = synced(demoKit([]));
  const m = JSON.parse(fs.readFileSync(path.join(repo, '.standards.json'), 'utf8'));
  m.profiles.demo = '1.1.0';
  fs.writeFileSync(path.join(repo, '.standards.json'), `${JSON.stringify(m, null, 2)}\n`);
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL \[lock\] \.standards\.json: demo is 1\.1\.0 but the lock holds 1\.0\.0/);
});

test('lock failure stops before any tool runs', () => {
  const repo = synced(demoKit([{ id: 'x', tool: 'demo-x', run: ['node', '-e', "console.log('TOOL-RAN')"] }]));
  fs.appendFileSync(path.join(repo, '.gitattributes'), '\n');
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.out, /TOOL-RAN/);
});

test('hand edit of the generated .golangci.yml fails; so does an overlay edited without re-sync', () => {
  const repo = makeFollower();
  assert.equal(sync(repo, 'init', 'base@1.0.0', 'go-strict@1.0.0', '--kit', KIT_ROOT).code, 0);
  let r = check(repo, '--locks-only');
  assert.equal(r.code, 0, r.out);
  const gen = path.join(repo, '.golangci.yml');
  const orig = fs.readFileSync(gen);
  fs.writeFileSync(gen, orig.toString().replace('    - gosec\n', ''));
  r = check(repo, '--locks-only');
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL \[generated\] \.golangci\.yml: sha256 [0-9a-f]{64} != \.standards\/generated\.SHA256SUMS/);
  assert.match(r.out, /\.golangci\.local\.yml/);
  fs.writeFileSync(gen, orig);
  fs.writeFileSync(path.join(repo, '.golangci.local.yml'), 'linters:\n  enable: [dupl]  # reason\n');
  r = check(repo, '--locks-only');
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL \[generated\] \.golangci\.local\.yml: changed since \.golangci\.yml was generated/);
});

test('fragment commands run in manifest/profile order; a failing command names profile + tool', () => {
  const repo = synced(demoKit([
    { id: 'a', tool: 'demo-a', run: ['node', '-e', "console.log('A-RAN')"] },
    { id: 'b', tool: 'demo-b', run: ['node', '-e', "console.error('b.go:3:1: boom'); process.exit(3)"] },
    { id: 'c', tool: 'demo-c', run: ['node', '-e', "console.log('C-RAN')"] },
  ]));
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.ok(r.out.indexOf('A-RAN') < r.out.indexOf('b.go:3:1: boom'));
  assert.ok(r.out.indexOf('b.go:3:1: boom') < r.out.indexOf('C-RAN'), 'later commands still run');
  assert.match(r.out, /standards: FAIL \[demo\/demo-b\] exit 3/);
  assert.match(r.out, /standards: 1 failure/);
});

test('failOnOutput turns each output line into a failure line naming the file', () => {
  const repo = synced(demoKit([
    { id: 'fmt', tool: 'demo-fmt', run: ['node', '-e', "console.log('pkg/a.go\\nmain.go')"], failOnOutput: true, outputLine: '{line}: not formatted (fix: demo -w {line})' },
  ]));
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.match(r.out, /standards: FAIL \[demo\/demo-fmt\] pkg\/a\.go: not formatted \(fix: demo -w pkg\/a\.go\)/);
  assert.match(r.out, /standards: FAIL \[demo\/demo-fmt\] main\.go: not formatted/);
});

test('{goFiles} expands to the .go files of go list package dirs (no testdata, no vendor)', { skip: !hasGo() && 'go not on PATH' }, () => {
  const repo = synced(demoKit([
    { id: 'list', tool: 'demo-list', run: ['node', '-e', 'for (const a of process.argv.slice(1)) console.log(a)', '{goFiles}'] },
  ]), undefined, {
    'go.mod': 'module fixture\n\ngo 1.22\n',
    'main.go': 'package main\n\nfunc main() {}\n',
    'sub/x_windows.go': 'package sub\n',
    'sub/x_test.go': 'package sub\n',
    'testdata/skip.go': 'package skip\n',
    'vendor/v/skip.go': 'package v\n',
  });
  const r = check(repo);
  assert.equal(r.code, 0, r.out);
  const listed = r.out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.endsWith('.go')).sort();
  assert.deepEqual(listed, ['main.go', 'sub/x_test.go', 'sub/x_windows.go']);
});

test('needsRef: origin/main missing -> check runs `git fetch --no-tags origin main` first', () => {
  const repo = synced(demoKit([
    { id: 'ref', tool: 'demo-ref', needsRef: 'origin/main', run: ['git', 'rev-parse', '--verify', 'origin/main'] },
  ]));
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'sync');
  const bare = path.join(tmpdir('standards-origin-'), 'o.git');
  git(repo, 'clone', '-q', '--bare', repo, bare);
  git(repo, 'remote', 'add', 'origin', bare);
  const r = check(repo);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /git fetch --no-tags origin main/);
});

test('checkoutCacheEnv: the tool cache lives in this checkout\'s git dir, so two checkouts never share one', () => {
  const cmd = { id: 'cache', tool: 'demo-cache', checkoutCacheEnv: 'DEMO_CACHE', run: ['node', '-e', "console.log(['CACHE', process.env.DEMO_CACHE].join('>'))"] };
  const a = synced(demoKit([cmd]));
  git(a, 'add', '-A'); git(a, 'commit', '-q', '-m', 'sync');
  const b = path.join(tmpdir('standards-other-'), 'sub', 'repo'); // e.g. actions/checkout `path: repo`
  git(a, 'clone', '-q', a, b);
  const cacheOf = (repo) => {
    const r = node([path.join(repo, '.standards', 'check.mjs')], { cwd: repo, env: { DEMO_CACHE: path.join(os.tmpdir(), 'shared') } });
    assert.equal(r.code, 0, r.out);
    return /^CACHE>(.*)$/m.exec(r.out)[1].trim();
  };
  const ca = cacheOf(a); const cb = cacheOf(b);
  assert.ok(path.isAbsolute(ca), ca);
  assert.equal(path.relative(path.join(a, '.git'), ca).startsWith('..'), false, `${ca} not under ${a}/.git`);
  assert.equal(path.relative(path.join(b, '.git'), cb).startsWith('..'), false, `${cb} not under ${b}/.git`);
  assert.ok(fs.existsSync(ca), 'cache dir created');
});

test('check.mjs imports only node: built-ins (zero-dependency rule)', () => {
  const src = fs.readFileSync(path.join(KIT_ROOT, 'src/profiles/base/.standards/check.mjs'), 'utf8');
  const specs = [...src.matchAll(/(?:import\s[^'"]*from\s*|import\(\s*|require\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(specs.length > 0);
  for (const s of specs) assert.match(s, /^node:/, s);
});

function hasGo() {
  return node(['-e', "require('child_process').execFileSync('go',['version'])"]).code === 0;
}
