import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { configRatchet, publishedIntegrity, ratchetConfigs } from '../src/profiles/base/.standards/check.mjs';
import { git, makeFollower, makeKit, node, realProfileFiles, SYNC, tmpdir, writeProfile } from './helpers.mjs';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

test('new eslint suppression entries and counts fail with a file and line', () => {
  const base = { 'eslint-suppressions.json': json({}) };
  const head = { 'eslint-suppressions.json': json({ 'src/a.js': { 'no-alert': { count: 1 } } }) };
  const failures = ratchetConfigs(base, head);
  assert.ok(failures.some((failure) => /eslint-suppressions\.json:4:.*new suppression.*src\/a\.js.*no-alert/.test(failure)));
});

test('increasing existing ESLint suppression counts fails', () => {
  const base = { 'eslint-suppressions.json': json({ 'src/a.js': { 'no-alert': { count: 1 } } }) };
  const head = { 'eslint-suppressions.json': json({ 'src/a.js': { 'no-alert': { count: 2 } } }) };
  assert.match(ratchetConfigs(base, head)[0], /eslint-suppressions\.json:.*total suppression count increased from 1 to 2/);
});

test('disabling a golangci linter fails', () => {
  const base = { '.golangci.local.yml': 'linters:\n  disable: []\n' };
  const head = { '.golangci.local.yml': 'linters:\n  disable:\n    - errcheck\n' };
  assert.match(ratchetConfigs(base, head)[0], /\.golangci\.local\.yml:3:.*disabled.*errcheck/);
});

test('adding a golangci exclusion fails', () => {
  const base = { '.golangci.local.yml': 'linters:\n  exclusions:\n    rules: []\n' };
  const head = { '.golangci.local.yml': 'linters:\n  exclusions:\n    rules:\n      - path: ".*generated.go"\n' };
  assert.match(ratchetConfigs(base, head)[0], /\.golangci\.local\.yml:4:.*exclusion/);
});

test('raising a golangci threshold fails', () => {
  const base = { '.golangci.local.yml': 'linters:\n  settings:\n    dupl:\n      threshold: 100\n' };
  const head = { '.golangci.local.yml': 'linters:\n  settings:\n    dupl:\n      threshold: 200\n' };
  assert.match(ratchetConfigs(base, head)[0], /\.golangci\.local\.yml:4:.*threshold.*100.*200/);
});

test('dropping or downgrading a standards profile and adding an opt-out fail', () => {
  const base = { '.standards.json': json({ profiles: { base: '1.1.0', 'ts-base': '1.2.0' } }) };
  const dropped = { '.standards.json': json({ profiles: { base: '1.1.0' } }) };
  const downgraded = { '.standards.json': json({ profiles: { base: '1.1.0', 'ts-base': '1.1.0' } }) };
  const optedOut = { '.standards.json': json({ profiles: { base: '1.1.0', 'ts-base': '1.2.0' }, skip: true }) };
  assert.match(ratchetConfigs(base, dropped)[0], /\.standards\.json:.*dropped profile ts-base/);
  assert.match(ratchetConfigs(base, downgraded)[0], /\.standards\.json:.*downgraded ts-base/);
  assert.match(ratchetConfigs(base, optedOut)[0], /\.standards\.json:.*opt-out/);
});

test('reductions in suppressions and stricter configs pass', () => {
  const base = {
    'eslint-suppressions.json': json({ files: { 'src/a.js': { 'no-alert': 2 } } }),
    '.golangci.local.yml': 'linters:\n  disable:\n    - errcheck\n  settings:\n    dupl:\n      threshold: 100\n',
    '.standards.json': json({ profiles: { base: '1.1.0', 'ts-base': '1.2.0' } }),
  };
  const head = {
    'eslint-suppressions.json': json({ files: { 'src/a.js': { 'no-alert': 1 } } }),
    '.golangci.local.yml': 'linters:\n  disable: []\n  settings:\n    dupl:\n      threshold: 50\n',
    '.standards.json': json({ profiles: { base: '1.1.0', 'ts-base': '1.3.0' } }),
  };
  assert.deepEqual(ratchetConfigs(base, head), []);
});

test('changed vendored standards files must match the pinned kit release', async () => {
  const kit = makeKit();
  const root = tmpdir('standards-ratchet-');
  fs.mkdirSync(path.join(root, '.standards'), { recursive: true });
  fs.writeFileSync(path.join(root, '.standards', 'check.mjs'), 'tampered\n');
  const failures = await publishedIntegrity(root, ['.standards/check.mjs'], {
    kit,
    profiles: { base: '1.0.0' },
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /\.standards\/check\.mjs: differs from kit-published content/);
});

test('the gate compares changed config with origin/main merge base', async () => {
  const repo = makeFollower({ '.golangci.local.yml': 'linters:\n  disable: []\n' });
  const bare = path.join(tmpdir('standards-ratchet-origin-'), 'origin.git');
  git(repo, 'clone', '-q', '--bare', repo, bare);
  git(repo, 'remote', 'add', 'origin', bare);
  git(repo, 'fetch', '-q', 'origin', 'main');
  fs.writeFileSync(path.join(repo, '.golangci.local.yml'), 'linters:\n  disable:\n    - errcheck\n');
  git(repo, 'add', '.golangci.local.yml');
  git(repo, 'commit', '-q', '-m', 'weaken lint config');
  const failures = await configRatchet(repo);
  assert.match(failures[0], /\.golangci\.local\.yml:3: disabled linter.*errcheck/);
});

test('follower branch demo: adding a suppression fails and removing it passes', () => {
  const kit = makeKit((dir) => writeProfile(dir, 'base', '1.1.1', realProfileFiles('base', '1.1.1')));
  const repo = makeFollower();
  let r = node([SYNC, 'init', 'base@1.1.1', '--kit', kit], { cwd: repo });
  assert.equal(r.code, 0, r.out);
  const manifestFile = path.join(repo, '.standards.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.kit = kit;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(repo, 'eslint-suppressions.json'), '{}\n');
  git(repo, 'add', '.standards.json', '.standards', 'AGENTS.md', '.gitattributes', '.editorconfig', 'eslint-suppressions.json');
  git(repo, 'commit', '-q', '-m', 'sync standards base profile');
  const bare = path.join(tmpdir('standards-follower-origin-'), 'origin.git');
  git(repo, 'clone', '-q', '--bare', repo, bare);
  git(repo, 'remote', 'add', 'origin', bare);
  git(repo, 'fetch', '-q', 'origin', 'main');

  const suppressions = path.join(repo, 'eslint-suppressions.json');
  fs.writeFileSync(suppressions, json({ 'src/a.js': { 'no-alert': { count: 1 } } }));
  git(repo, 'add', 'eslint-suppressions.json');
  git(repo, 'commit', '-q', '-m', 'add one suppression');
  const gate = path.join(repo, '.standards', 'check.mjs');
  r = node([gate], { cwd: repo });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /eslint-suppressions\.json:\d+: new suppression entry/);
  assert.match(r.out, /total suppression count increased from 0 to 1/);

  fs.writeFileSync(suppressions, '{}\n');
  git(repo, 'add', 'eslint-suppressions.json');
  git(repo, 'commit', '-q', '-m', 'remove the suppression');
  r = node([gate], { cwd: repo });
  assert.equal(r.code, 0, r.out);
});
