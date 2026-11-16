// release-local 1.0.0: release / deploy / check against fixture repos. `ci verify` is a stub vendored as the sibling
// .standards/ci-local/ci.mjs (exit code from STUB_CI_EXIT); `gh` is a PATH shim that logs argv and never touches GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { KIT_ROOT, tmpdir } from './helpers.mjs';

const DIR = process.env.RELEASE_LOCAL_SRC || !fs.existsSync(path.join(KIT_ROOT, 'profiles/release-local/1.0.0'))
  ? path.join(KIT_ROOT, 'src/profiles/release-local') : path.join(KIT_ROOT, 'profiles/release-local/1.0.0');
const REL = path.join(DIR, '.standards/release-local/release.mjs');
const ROOT = tmpdir('release-local-');
const win = process.platform === 'win32';
const sh = (cwd, cmd, args) => { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, `${cmd} ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const g = (cwd, ...a) => sh(cwd, 'git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
const w = (repo, rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };

// Fake gh: logs {argv, token} as one JSON line to $GH_LOG, exits $GH_EXIT (default 0), prints a release URL.
const SHIM = path.join(ROOT, 'shim');
fs.mkdirSync(SHIM);
fs.writeFileSync(path.join(SHIM, 'gh.mjs'), `import fs from 'node:fs';
fs.appendFileSync(process.env.GH_LOG, JSON.stringify({ argv: process.argv.slice(2), token: process.env.GH_TOKEN ?? null, files: process.argv.slice(2).filter((a) => fs.existsSync(a) && fs.statSync(a).isFile()).map((a) => [a.split(/[\\\\/]/).pop(), fs.readFileSync(a, 'utf8').length]) }) + '\\n');
console.log('https://github.com/o/r/releases/tag/' + process.argv[4]);
process.exit(Number(process.env.GH_EXIT ?? 0));
`);
fs.writeFileSync(path.join(SHIM, 'gh'), `#!/bin/sh\nexec node "$(dirname "$0")/gh.mjs" "$@"\n`, { mode: 0o755 });
fs.writeFileSync(path.join(SHIM, 'gh.cmd'), '@echo off\r\nnode "%~dp0gh.mjs" %*\r\n');

const STUB_CI = `const code = Number(process.env.STUB_CI_EXIT ?? 0);
const verdict = { 0: 'pass', 1: 'fail', 2: 'pending' }[code] ?? 'error';
console.log(JSON.stringify({ ok: true, result: { verdict, reasons: [] , sha: process.argv[process.argv.indexOf('--sha') + 1] } }));
process.exit(code);
`;
let n = 0;
function fixture({ release = {}, deploy, files = {}, tag = 'v1.2.3', pkgVersion = '1.2.3', name } = {}) {
  const repo = path.join(ROOT, name ?? `r${++n}`);
  fs.mkdirSync(repo, { recursive: true });
  w(repo, '.standards/ci-local/ci.mjs', STUB_CI);
  w(repo, '.standards/release-local/release.mjs', fs.readFileSync(REL, 'utf8'));
  w(repo, 'package.json', JSON.stringify({ name: 'x', version: pkgVersion }));
  w(repo, 'build.mjs', "import fs from 'node:fs'; fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/app-' + process.argv[2] + '.zip', 'zip-' + process.argv[2]); fs.writeFileSync('dist/b.txt', 'bee');\n");
  w(repo, 'ci/release.json', JSON.stringify({ schema: 'release/1', version_source: { file: 'package.json', json: 'version' }, build: [['node', 'build.mjs', '{version}']], assets: ['dist/*.zip', 'dist/b.txt'], ...release }, null, 2));
  if (deploy) w(repo, 'ci/deploy.json', JSON.stringify({ schema: 'deploy/1', ...deploy }, null, 2));
  for (const [f, c] of Object.entries(files)) w(repo, f, c);
  w(repo, '.gitignore', 'dist/\nseen.txt\nran.txt\npost-ran.txt\n');
  sh(repo, 'git', ['init', '-q', '-b', 'main']);
  g(repo, 'add', '-A'); g(repo, 'commit', '-q', '-m', 'main');
  if (tag) g(repo, 'tag', tag);
  return repo;
}
function rel(repo, args, extra = {}) {
  const log = path.join(ROOT, `gh-${++n}.log`);
  const env = { ...process.env, PATH: `${SHIM}${path.delimiter}${process.env.PATH}`, GH_LOG: log, GH_TOKEN: 'tok-SECRET-123', HERMES_DEPLOY_SECRETS_DIR: path.join(ROOT, 'no-secrets'), ...extra };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const r = spawnSync(process.execPath, [path.join(repo, '.standards/release-local/release.mjs'), ...args, '--json'], { cwd: repo, encoding: 'utf8', env });
  let j; try { j = JSON.parse(r.stdout); } catch { assert.fail(`no envelope (exit ${r.status}): ${r.stdout}${r.stderr}`); }
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { code: r.status, ...j, calls, raw: r.stdout + r.stderr };
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('release: version==tag, ci green, build, sha256, gh release create with token, post hook last', () => {
  const repo = fixture({ release: { post: [['node', 'post.mjs', '{tag}', '{version}']] }, files: { 'post.mjs': "import fs from 'node:fs'; fs.writeFileSync('post-ran.txt', [process.argv[2], process.argv[3], process.env.RELEASE_TAG, process.env.RELEASE_SHA].join(' '));\n" } });
  const r = rel(repo, ['release', 'v1.2.3']);
  assert.equal(r.code, 0, r.raw);
  assert.equal(r.result.published, true);
  assert.deepEqual(r.result.assets, ['dist/app-1.2.3.zip', 'dist/b.txt']);
  assert.equal(r.result.sha256['app-1.2.3.zip'], sha256('zip-1.2.3'));
  assert.equal(r.result.sha256['b.txt'], sha256('bee'));
  assert.equal(r.calls.length, 1);
  const c = r.calls[0];
  assert.deepEqual(c.argv.slice(0, 2), ['release', 'create']);
  assert.equal(c.argv[2], 'v1.2.3');
  assert.ok(c.argv.includes('--verify-tag'));
  assert.equal(c.token, 'tok-SECRET-123');
  assert.deepEqual(c.files.map((f) => f[0]).sort(), ['SHA256SUMS', 'app-1.2.3.zip', 'b.txt']);
  assert.equal(fs.readFileSync(path.join(repo, 'post-ran.txt'), 'utf8'), `v1.2.3 1.2.3 v1.2.3 ${g(repo, 'rev-parse', 'HEAD')}`);
  assert.ok(!r.raw.includes('tok-SECRET-123'), 'token never printed');
});

test('release: tag != version -> version-mismatch, nothing built or published', () => {
  const repo = fixture({ pkgVersion: '1.2.4' });
  const r = rel(repo, ['release', 'v1.2.3']);
  assert.equal(r.code, 1); assert.equal(r.error.code, 'version-mismatch');
  assert.equal(r.calls.length, 0); assert.ok(!fs.existsSync(path.join(repo, 'dist')));
});

test('release: version sources toml and regex', () => {
  const toml = fixture({ release: { version_source: { file: 'Cargo.toml', toml: 'package.version' } }, files: { 'Cargo.toml': '[workspace.package]\nversion = "9.9.9"\n\n[package]\nname = "x"\nversion = "1.2.3" # c\n' } });
  assert.equal(rel(toml, ['release', 'v1.2.3', '--dry-run']).code, 0);
  const re = fixture({ release: { version_source: { file: 'v.py', regex: "__version__ = '([^']+)'" } }, files: { 'v.py': "__version__ = '1.2.3'\n" } });
  assert.equal(rel(re, ['release', 'v1.2.3', '--dry-run']).code, 0);
});

test('release: ci verify red -> ci-not-green (1); pending -> ci-pending (2); neither builds nor publishes', () => {
  const repo = fixture();
  const red = rel(repo, ['release', 'v1.2.3'], { STUB_CI_EXIT: '1' });
  assert.equal(red.code, 1); assert.equal(red.error.code, 'ci-not-green'); assert.match(red.error.message, /fail/);
  const pend = rel(repo, ['release', 'v1.2.3'], { STUB_CI_EXIT: '2' });
  assert.equal(pend.code, 2); assert.equal(pend.error.code, 'ci-pending');
  assert.equal(red.calls.length + pend.calls.length, 0); assert.ok(!fs.existsSync(path.join(repo, 'dist')));
});

test('release: no tag, wrong HEAD, dirty tree, missing token, missing asset, failing build', () => {
  const noTag = fixture({ tag: null });
  assert.equal(rel(noTag, ['release', 'v1.2.3']).error.code, 'git');
  const moved = fixture();
  w(moved, 'x.txt', 'x'); g(moved, 'add', '-A'); g(moved, 'commit', '-q', '-m', 'later');
  assert.equal(rel(moved, ['release', 'v1.2.3']).error.code, 'wrong-checkout');
  const dirty = fixture();
  w(dirty, 'stray.txt', 'x');
  assert.equal(rel(dirty, ['release', 'v1.2.3']).error.code, 'dirty-checkout');
  const ok = fixture();
  assert.equal(rel(ok, ['release', 'v1.2.3'], { GH_TOKEN: undefined }).error.code, 'no-token');
  const noAsset = fixture({ release: { assets: ['dist/nope.bin'] } });
  assert.equal(rel(noAsset, ['release', 'v1.2.3']).error.code, 'asset-missing');
  const bad = fixture({ release: { build: [['node', '-e', 'process.exit(7)']] } });
  const r = rel(bad, ['release', 'v1.2.3']);
  assert.equal(r.error.code, 'build-failed'); assert.equal(r.calls.length, 0);
});

test('release: gh failure -> gh-failed (3); post hook failure says the release IS published', () => {
  const repo = fixture();
  const r = rel(repo, ['release', 'v1.2.3'], { GH_EXIT: '1' });
  assert.equal(r.code, 3); assert.equal(r.error.code, 'gh-failed');
  const hook = fixture({ release: { post: [['node', '-e', 'process.exit(5)']] } });
  const p = rel(hook, ['release', 'v1.2.3']);
  assert.equal(p.error.code, 'post-failed'); assert.match(p.error.message, /IS published/); assert.equal(p.calls.length, 1);
});

test('release: --dry-run runs the gates and the build but never calls gh (and needs no token)', () => {
  const repo = fixture();
  const r = rel(repo, ['release', 'v1.2.3', '--dry-run'], { GH_TOKEN: undefined });
  assert.equal(r.code, 0); assert.equal(r.result.dry_run, true); assert.equal(r.result.published, false); assert.equal(r.calls.length, 0);
  assert.equal(rel(repo, ['release', 'v1.2.3', '--dry-run'], { STUB_CI_EXIT: '1' }).error.code, 'ci-not-green');
});

const secretsDir = (repoName, text) => { const d = path.join(ROOT, `secrets-${repoName}`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `${repoName}.env`), text); return d; };

test('deploy: green record + secrets file -> steps run with the env; secret values never reach output', () => {
  const name = 'dep-ok';
  const repo = fixture({ name, tag: null, deploy: { steps: [['node', 'show.mjs'], 'node show.mjs'] }, files: { 'show.mjs': "import fs from 'node:fs'; console.log('value=' + process.env.API_TOKEN); fs.appendFileSync('seen.txt', process.env.API_TOKEN + ',' + process.env.QUOTED + '\\n');\n" } });
  const dir = secretsDir(name, '# c\nAPI_TOKEN=abcd-1234-SECRET\nexport QUOTED="two words"\n');
  const head = g(repo, 'rev-parse', 'HEAD');
  const r = rel(repo, ['deploy', head], { HERMES_DEPLOY_SECRETS_DIR: dir });
  assert.equal(r.code, 0, r.raw);
  assert.equal(fs.readFileSync(path.join(repo, 'seen.txt'), 'utf8'), 'abcd-1234-SECRET,two words\nabcd-1234-SECRET,two words\n');
  assert.ok(!r.raw.includes('abcd-1234-SECRET') && !r.raw.includes('two words'), 'secrets never printed');
  assert.equal(r.result.repo_secrets, `${name}.env`);
});

test('deploy: no secrets file -> secrets-missing (1), no step runs; secrets:false opts out', () => {
  const repo = fixture({ name: 'dep-nosecrets', tag: null, deploy: { steps: [['node', '-e', "require('fs').writeFileSync('ran.txt','1')"]] }, });
  const head = g(repo, 'rev-parse', 'HEAD');
  const r = rel(repo, ['deploy', head]);
  assert.equal(r.code, 1); assert.equal(r.error.code, 'secrets-missing');
  assert.ok(!fs.existsSync(path.join(repo, 'ran.txt')));
  const open = fixture({ name: 'dep-open', tag: null, deploy: { secrets: false, steps: [['node', '-e', "require('fs').writeFileSync('ran.txt','1')"]] }, });
  assert.equal(rel(open, ['deploy', g(open, 'rev-parse', 'HEAD')]).code, 0);
  assert.ok(fs.existsSync(path.join(open, 'ran.txt')));
});

test('deploy: record not green -> ci-not-green / ci-pending; step failure -> deploy-failed; wrong HEAD refused', () => {
  const name = 'dep-red';
  const repo = fixture({ name, tag: null, deploy: { steps: [['node', '-e', 'process.exit(3)']] } });
  const dir = secretsDir(name, 'K=v-12345\n');
  const head = g(repo, 'rev-parse', 'HEAD');
  assert.equal(rel(repo, ['deploy', head], { HERMES_DEPLOY_SECRETS_DIR: dir, STUB_CI_EXIT: '1' }).error.code, 'ci-not-green');
  assert.equal(rel(repo, ['deploy', head], { HERMES_DEPLOY_SECRETS_DIR: dir, STUB_CI_EXIT: '2' }).code, 2);
  assert.equal(rel(repo, ['deploy', head], { HERMES_DEPLOY_SECRETS_DIR: dir }).error.code, 'deploy-failed');
  w(repo, 'y.txt', 'y'); g(repo, 'add', '-A'); g(repo, 'commit', '-q', '-m', 'next');
  assert.equal(rel(repo, ['deploy', head], { HERMES_DEPLOY_SECRETS_DIR: dir }).error.code, 'wrong-checkout');
});

test('check: lints ci/release.json and ci/deploy.json; absent files pass', () => {
  const repo = fixture({ tag: null });
  assert.equal(rel(repo, ['check']).code, 0);
  w(repo, 'ci/release.json', JSON.stringify({ schema: 'release/1', post: ['not-argv'], version_source: { file: 'package.json' } }));
  w(repo, 'ci/deploy.json', JSON.stringify({ schema: 'deploy/1', steps: [] }));
  const r = rel(repo, ['check']);
  assert.equal(r.code, 1);
  assert.match(r.result.findings.join('\n'), /ci\/release\.json: post must be a list of argv lists/);
  assert.match(r.result.findings.join('\n'), /ci\/deploy\.json: steps must be a non-empty list/);
});

test('release-local is zero-dependency (node: imports only)', () => {
  const src = fs.readFileSync(REL, 'utf8');
  assert.deepEqual([...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).filter((m) => !m.startsWith('node:')), []);
  assert.deepEqual(fs.readdirSync(path.join(DIR, '.standards/release-local')).sort(), ['check.json', 'release.mjs']);
});
