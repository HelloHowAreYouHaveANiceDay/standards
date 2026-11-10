// Kit integrity: SHA256SUMS match files, VERSIONS/CHANGELOG/check.json agree, append-only guard, release script.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  KIT_ROOT, APPEND_ONLY, RELEASE, sha256, walk, node, git, tmpdir, cmpSemver,
} from './helpers.mjs';

const PROFILES = path.join(KIT_ROOT, 'profiles');
const names = () => fs.readdirSync(PROFILES).filter((n) => fs.statSync(path.join(PROFILES, n)).isDirectory());
const versions = (n) => fs.readdirSync(path.join(PROFILES, n)).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort(cmpSemver);

test('the v1 profiles exist: base, go-base, go-strict at 1.0.0', () => {
  for (const n of ['base', 'go-base', 'go-strict']) assert.ok(versions(n).includes('1.0.0'), n);
});

test('every version dir: SHA256SUMS lists exactly its files with matching sha256, follower-relative, LF', () => {
  for (const n of names()) for (const v of versions(n)) {
    const dir = path.join(PROFILES, n, v);
    const files = walk(dir);
    const sumsText = files.SHA256SUMS.toString();
    delete files.SHA256SUMS;
    assert.ok(!sumsText.includes('\r'), `${n}/${v} SHA256SUMS is LF`);
    const lines = sumsText.split('\n').filter(Boolean);
    const listed = {};
    for (const l of lines) {
      const m = /^([0-9a-f]{64}) {2}(\S.*)$/.exec(l);
      assert.ok(m, `${n}/${v}: bad line ${l}`);
      assert.ok(!m[2].startsWith('/') && !m[2].split('/').includes('..'), `${n}/${v}: follower-relative ${m[2]}`);
      listed[m[2]] = m[1];
    }
    assert.deepEqual(Object.keys(listed).sort(), Object.keys(files).sort(), `${n}/${v}: listed == present`);
    for (const [f, s] of Object.entries(listed)) assert.equal(sha256(files[f]), s, `${n}/${v}/${f}`);
    assert.deepEqual(lines, [...lines].sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : 1)), `${n}/${v}: sorted by path`);
    for (const [f, b] of Object.entries(files)) assert.ok(!b.includes(13), `${n}/${v}/${f} has no CR`);
  }
});

test('VERSIONS lists the version dirs; CHANGELOG has a heading per version; check.json names profile + version', () => {
  for (const n of names()) {
    const vs = versions(n);
    assert.equal(fs.readFileSync(path.join(PROFILES, n, 'VERSIONS'), 'utf8'), vs.map((v) => `${v}\n`).join(''), n);
    const cl = fs.readFileSync(path.join(PROFILES, n, 'CHANGELOG.md'), 'utf8');
    for (const v of vs) {
      assert.match(cl, new RegExp(`^## ${v.replace(/\./g, '\\.')}\\b`, 'm'), `${n} CHANGELOG ${v}`);
      const cj = JSON.parse(fs.readFileSync(path.join(PROFILES, n, v, '.standards', n, 'check.json'), 'utf8'));
      assert.equal(cj.profile, n);
      assert.equal(cj.version, v);
      assert.ok(Array.isArray(cj.commands));
    }
  }
});

test('go profiles: standalone golangci v2 configs, nolintlint strict, tools pinned at v2.12.2, host-built', () => {
  for (const n of ['go-base', 'go-strict']) {
    const dir = path.join(PROFILES, n, '1.0.0');
    const y = fs.readFileSync(path.join(dir, '.standards', n, 'golangci.yml'), 'utf8');
    assert.match(y, /^version: "2"$/m);
    assert.match(y, /^ {2}default: none$/m);
    for (const l of ['errcheck', 'govet', 'staticcheck', 'unused', 'ineffassign', 'nolintlint']) assert.match(y, new RegExp(`^ {4}- ${l}$`, 'm'), `${n} ${l}`);
    assert.match(y, /nolintlint:\n\s+require-explanation: true\n\s+require-specific: true/);
    const cj = JSON.parse(fs.readFileSync(path.join(dir, '.standards', n, 'check.json'), 'utf8'));
    assert.deepEqual(cj.commands.map((c) => c.id), ['go-vet', 'gofmt', 'golangci-lint']);
    const g = cj.commands[2];
    assert.equal(g.install.go, 'github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2');
    assert.equal(g.needsRef, 'origin/main');
    assert.ok(g.run.includes('--new-from-merge-base=origin/main'));
    assert.deepEqual(cj.generate, [{ kind: 'golangci-merge', from: `.standards/${n}/golangci.yml`, overlay: '.golangci.local.yml', to: '.golangci.yml' }]);
  }
  const strict = fs.readFileSync(path.join(PROFILES, 'go-strict/1.0.0/.standards/go-strict/golangci.yml'), 'utf8');
  for (const l of ['gosec', 'gocritic', 'exhaustive', 'misspell', 'bodyclose']) assert.match(strict, new RegExp(`^ {4}- ${l}$`, 'm'));
  const base = fs.readFileSync(path.join(PROFILES, 'go-base/1.0.0/.standards/go-base/golangci.yml'), 'utf8');
  for (const l of ['gosec', 'gocritic', 'exhaustive', 'misspell', 'bodyclose']) assert.doesNotMatch(base, new RegExp(`^ {4}- ${l}$`, 'm'));
});

test('base: root .editorconfig (root = true, lf) and .gitattributes (* text=auto eol=lf + binaries)', () => {
  const dir = path.join(PROFILES, 'base/1.0.0');
  const ec = fs.readFileSync(path.join(dir, '.editorconfig'), 'utf8');
  assert.match(ec, /^root = true$/m);
  assert.match(ec, /^end_of_line = lf$/m);
  assert.match(ec, /^insert_final_newline = true$/m);
  assert.match(ec, /^trim_trailing_whitespace = true$/m);
  assert.match(ec, /^\[\*\.go\]\nindent_style = tab$/m);
  const ga = fs.readFileSync(path.join(dir, '.gitattributes'), 'utf8');
  assert.match(ga, /^\* text=auto eol=lf$/m);
  for (const b of ['png', 'pdf', 'zip', 'exe', 'dll', 'rvt']) assert.match(ga, new RegExp(`^\\*\\.${b} binary$`, 'm'));
  const ag = fs.readFileSync(path.join(dir, '.standards/AGENTS.md'), 'utf8');
  assert.match(ag, /node \.standards\/check\.mjs/);
  assert.match(ag, /\.golangci\.local\.yml/);
});

// ------------------------------------------------------------ append-only (inject)
function appendOnlyRepo() {
  const dir = tmpdir('standards-ao-');
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'profiles/x/1.0.0'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'profiles/x/1.0.0/a.txt'), 'a\n');
  fs.writeFileSync(path.join(dir, 'profiles/x/CHANGELOG.md'), '## 1.0.0\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'v1');
  git(dir, 'checkout', '-q', '-b', 'pr');
  return dir;
}
const ao = (dir) => node([APPEND_ONLY, 'main'], { cwd: dir });

test('append-only: adding a version dir and editing CHANGELOG passes', () => {
  const dir = appendOnlyRepo();
  fs.mkdirSync(path.join(dir, 'profiles/x/1.1.0'));
  fs.writeFileSync(path.join(dir, 'profiles/x/1.1.0/a.txt'), 'b\n');
  fs.appendFileSync(path.join(dir, 'profiles/x/CHANGELOG.md'), '## 1.1.0\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'v1.1');
  const r = ao(dir);
  assert.equal(r.code, 0, r.out);
});

test('append-only: an edited existing version dir fails (inject)', () => {
  const dir = appendOnlyRepo();
  fs.appendFileSync(path.join(dir, 'profiles/x/1.0.0/a.txt'), 'edit\n');
  git(dir, 'commit', '-q', '-am', 'edit');
  const r = ao(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /M\s+profiles\/x\/1\.0\.0\/a\.txt/);
});

test('append-only: a deleted or renamed file in an existing version dir fails', () => {
  const dir = appendOnlyRepo();
  git(dir, 'mv', 'profiles/x/1.0.0/a.txt', 'profiles/x/1.0.0/b.txt');
  git(dir, 'commit', '-q', '-m', 'rename');
  const r = ao(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /D\s+profiles\/x\/1\.0\.0\/a\.txt/);
});

// ------------------------------------------------------------ release script
test('release: snapshots src/profiles/<name> into a new version dir with SHA256SUMS; refuses an existing dir', () => {
  const kit = tmpdir('standards-rel-');
  fs.mkdirSync(path.join(kit, 'src/profiles/demo/.standards/demo'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'src/profiles/demo/.standards/demo/check.json'), '{\n  "profile": "demo",\n  "version": "0.0.0",\n  "commands": []\n}\n');
  fs.writeFileSync(path.join(kit, 'src/profiles/demo/x.txt'), 'x\n');
  fs.mkdirSync(path.join(kit, 'profiles/demo'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'profiles/demo/CHANGELOG.md'), '# demo\n\n## 1.2.3\n\n- first\n');
  let r = node([RELEASE, 'demo', '1.2.3', '--kit-root', kit]);
  assert.equal(r.code, 0, r.out);
  const out = path.join(kit, 'profiles/demo/1.2.3');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, '.standards/demo/check.json'), 'utf8')).version, '1.2.3');
  assert.equal(fs.readFileSync(path.join(out, 'x.txt'), 'utf8'), 'x\n');
  assert.match(fs.readFileSync(path.join(out, 'SHA256SUMS'), 'utf8'), /^[0-9a-f]{64} {2}\.standards\/demo\/check\.json\n[0-9a-f]{64} {2}x\.txt\n$/);
  assert.equal(fs.readFileSync(path.join(kit, 'profiles/demo/VERSIONS'), 'utf8'), '1.2.3\n');
  r = node([RELEASE, 'demo', '1.2.3', '--kit-root', kit]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /already exists/);
  r = node([RELEASE, 'demo', '1.3.0', '--kit-root', kit]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /CHANGELOG/);
});
