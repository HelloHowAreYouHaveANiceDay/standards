#!/usr/bin/env node
// Fixture sync (kit CI): sync every profile into fresh temp follower repos from this clone (file:// kit),
// run the vendored check.mjs there with the real pinned tools, and prove the gates bite:
//   - clean fixture: check.mjs passes;
//   - a new unchecked error on a PR branch: golangci (ratchet vs origin/main) fails, naming file:line;
//   - an unformatted file: gofmt fails, naming the file;
//   - vue-ts: real pinned npm tools; a floating promise, a type error, unformatted code and a drifted pin each fail;
//   - firebase-web: open rules, an untested rules file and a global CLI install each fail; a reasoned marker passes.
// --out <file> writes "<sha256>  <fixture>/<path>" for every synced file, for the Windows-vs-Linux byte comparison.
//
//   node tests/fixture-sync.mjs [--out synced.txt] [--only base,go-strict]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, SYNC, sha256, walk, node, git, run, tmpdir } from './helpers.mjs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : null;
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;

const GO_MOD = 'module example.com/fixture\n\ngo 1.23\n';
const MAIN_GO = 'package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tif _, err := fmt.Fprintln(os.Stdout, "ok"); err != nil {\n\t\tos.Exit(1)\n\t}\n}\n';
const BAD_GO = 'package main\n\nimport "os"\n\nfunc init() {\n\tos.Remove("fixture.tmp")\n}\n';
const UNFORMATTED_GO = 'package main\n\nfunc   helper() int { return 1 }\n\nvar _ = helper\n';
const OVERLAY = '# fixture overlay (site-cli drift shape)\nlinters:\n  settings:\n    gosec:\n      excludes:\n        - G124  # cookie flags -- fixture reason\n';

const VUE_PINS = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'profiles/vue-ts/1.0.0/.standards/vue-ts/check.json'), 'utf8')).tools;
const VUE_FILES = {
  '.gitignore': 'node_modules/\n',
  'package.json': `${JSON.stringify({ name: 'fixture', private: true, type: 'module', dependencies: { vue: '3.5.41' }, devDependencies: { ...VUE_PINS, '@types/node': '24.10.1' } }, null, 2)}\n`,
  'tsconfig.json': '{\n  "files": [],\n  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]\n}\n',
  'tsconfig.app.json': '{\n  "extends": "./.standards/vue-ts/tsconfig.app.json",\n  "compilerOptions": { "tsBuildInfoFile": "./node_modules/.tmp/app.tsbuildinfo" },\n  "include": ["src/**/*.ts", "src/**/*.vue"]\n}\n',
  'tsconfig.node.json': '{\n  "extends": "./.standards/vue-ts/tsconfig.node.json",\n  "compilerOptions": {\n    "tsBuildInfoFile": "./node_modules/.tmp/node.tsbuildinfo",\n    "types": ["node"]\n  },\n  "include": ["scripts/**/*.ts"]\n}\n',
  'scripts/hello.ts': "import process from 'node:process'\n\nprocess.stdout.write('ok\\n')\n",
  'eslint.config.mjs': "import standards from './.standards/vue-ts/eslint.base.mjs'\n\nexport default standards()\n",
  'src/env.d.ts': "declare module '*.vue' {\n  import type { DefineComponent } from 'vue'\n  const component: DefineComponent\n  export default component\n}\n",
  'src/main.ts': "import { createApp } from 'vue'\nimport HelloApp from './HelloApp.vue'\n\nexport function first(xs: string[]): string {\n  return xs[0] ?? ''\n}\n\ncreateApp(HelloApp).mount('#app')\n",
  'src/HelloApp.vue': '<script setup lang="ts">\nimport { ref } from \'vue\'\n\nconst count = ref(0)\n</script>\n\n<template>\n  <button type="button" @click="count++">{{ count }}</button>\n</template>\n',
};
const FLOATING = "export async function save(): Promise<void> {}\n\nexport function go(): void {\n  save()\n}\n";
const TYPE_ERR = "export const n: number = 'not a number'\n";
const UNFORMATTED = 'export const  x = { a:1 }\n';
const RULES = "rules_version = '2'\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /users/{uid} {\n      allow read, write: if request.auth != null && request.auth.uid == uid;\n    }\n  }\n}\n";
const FB_FILES = {
  'package.json': `${JSON.stringify({ name: 'fixture', private: true, devDependencies: { 'firebase-tools': '15.26.0' } }, null, 2)}\n`,
  'firebase.json': `${JSON.stringify({ firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' } }, null, 2)}\n`,
  'firestore.rules': RULES,
  'firestore.indexes.json': '{ "indexes": [], "fieldOverrides": [] }\n',
  'tests/rules.test.mjs': "import { initializeTestEnvironment } from '@firebase/rules-unit-testing'\nimport fs from 'node:fs'\n\nexport const env = () => initializeTestEnvironment({ projectId: 'demo-x', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } })\n",
};

// npm's JS entry next to this node (Windows: <dir>/node_modules/npm, posix: <prefix>/lib/node_modules/npm).
const NPM_CLI = [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find((f) => fs.existsSync(f));
const npm = (args, cwd) => (NPM_CLI ? node([NPM_CLI, ...args], { cwd }) : run('npm', args, { cwd }));
const check = (dir) => node([path.join(dir, '.standards', 'check.mjs')], { cwd: dir });
const commitAll = (dir, msg) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); };

const FIXTURES = [
  { id: 'base', profiles: ['base@1.0.0'], go: false },
  { id: 'go-base', profiles: ['base@1.0.0', 'go-base@1.0.0'], go: true },
  { id: 'go-strict', profiles: ['base@1.0.0', 'go-strict@1.0.0'], go: true },
  { id: 'go-strict-overlay', profiles: ['base@1.0.0', 'go-strict@1.0.0'], go: true, overlay: true },
  { id: 'vue-ts', profiles: ['base@1.0.0', 'vue-ts@1.0.0'], vue: true },
  { id: 'firebase-web', profiles: ['base@1.0.0', 'firebase-web@1.0.0'], firebase: true },
  ...(await loadPlugins()),
].filter((f) => !only || only.includes(f.id));

// Pluggable fixtures (one file per profile, so profiles land without touching this file):
// tests/fixtures/<id>.mjs exports `fixture` = {
//   id, profiles: ['base@1.0.0', '<name>@<x.y.z>'], files: { rel: text },
//   prepare?(dir, h) -> boolean   // install tools after sync + commit; false skips the fixture
//   inject?(dir, h)               // after the clean pass: write a defect, h.step(check fails), remove it, ...
// }
// h = { step(ok, msg, detail), check() -> {code, out}, git(...args), node(args, opts), run(cmd, args, opts), npm(args) }.
async function loadPlugins() {
  const dir = path.join(KIT_ROOT, 'tests', 'fixtures');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    out.push({ ...mod.fixture, plugin: true });
  }
  return out;
}

const kitUrl = pathToFileURL(KIT_ROOT).href;
const lines = [];
let failed = 0;
const step = (ok, msg, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) { failed++; if (detail) console.log(detail.split('\n').map((l) => `     | ${l}`).join('\n')); }
};

for (const fx of FIXTURES) {
  const dir = tmpdir(`fixture-${fx.id}-`);
  git(dir, 'init', '-q', '-b', 'main');
  const files = { 'README.md': `# ${fx.id}\n` };
  if (fx.go) Object.assign(files, { 'go.mod': GO_MOD, 'main.go': MAIN_GO });
  if (fx.overlay) files['.golangci.local.yml'] = OVERLAY;
  if (fx.vue) Object.assign(files, VUE_FILES);
  if (fx.firebase) Object.assign(files, FB_FILES);
  if (fx.files) Object.assign(files, fx.files);
  for (const f of Object.keys(files)) fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  for (const [f, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), b);
  const s = node([SYNC, 'init', ...fx.profiles, '--kit', kitUrl], { cwd: dir });
  step(s.code === 0, `${fx.id}: sync init ${fx.profiles.join(' ')}`, s.out);
  if (s.code !== 0) continue;
  for (const [rel, buf] of Object.entries(walk(dir)).sort(([a], [b]) => (a < b ? -1 : 1))) lines.push(`${sha256(buf)}  ${fx.id}/${rel}`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'bootstrap standards');
  const bare = path.join(tmpdir(`origin-${fx.id}-`), 'origin.git');
  git(dir, 'clone', '-q', '--bare', dir, bare);
  git(dir, 'remote', 'add', 'origin', bare); // origin/main deliberately not fetched: check.mjs must fetch it
  if (fx.vue) {
    const i = npm(['install', '--no-audit', '--no-fund', '--ignore-scripts'], dir);
    step(i.code === 0, `${fx.id}: npm install (pinned tools)`, i.out);
    if (i.code !== 0) continue;
  }
  const h = {
    step: (ok, msg, detail = '') => step(ok, `${fx.id}: ${msg}`, detail),
    check: () => check(dir),
    git: (...a) => git(dir, ...a),
    node: (a, o = {}) => node(a, { cwd: dir, ...o }),
    run: (c, a, o = {}) => run(c, a, { cwd: dir, ...o }),
    npm: (a) => npm(a, dir),
  };
  if (fx.prepare && !(await fx.prepare(dir, h))) continue;
  const clean = node([path.join(dir, '.standards', 'check.mjs')], { cwd: dir });
  step(clean.code === 0, `${fx.id}: check.mjs passes on the clean fixture`, clean.out);
  if (fx.plugin) { if (fx.inject) await fx.inject(dir, h); continue; }
  if (fx.vue) { vueInjections(fx, dir); continue; }
  if (fx.firebase) { firebaseInjections(fx, dir); continue; }
  if (!fx.go) continue;
  git(dir, 'checkout', '-q', '-b', 'pr');
  fs.writeFileSync(path.join(dir, 'bad.go'), BAD_GO);
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'new finding');
  const bad = node([path.join(dir, '.standards', 'check.mjs')], { cwd: dir });
  step(bad.code === 1 && /bad\.go:6:\d+:.*errcheck/.test(bad.out) && /FAIL \[[a-z-]+\/golangci-lint v2\.12\.2\] exit 1/.test(bad.out),
    `${fx.id}: a new unchecked error fails golangci (ratchet vs origin/main) naming bad.go:6`, bad.out);
  // Same commit, second checkout at another path (a self-hosted runner's other workspace, a worktree, a
  // `path: <repo>` subdir checkout): golangci's package cache is keyed by content, not location, so a
  // shared cache hands back the first checkout's file paths and the ratchet silently drops the finding.
  const other = path.join(tmpdir(`fixture-${fx.id}-other-`), fx.id);
  git(KIT_ROOT, 'clone', '-q', '-b', 'pr', dir, other);
  const again = node([path.join(other, '.standards', 'check.mjs')], { cwd: other });
  step(again.code === 1 && /(^|\n)bad\.go:6:\d+:.*errcheck/.test(again.out),
    `${fx.id}: the same finding in a second checkout at another path still fails, naming bad.go:6`, again.out);
  fs.rmSync(path.join(dir, 'bad.go'));
  fs.writeFileSync(path.join(dir, 'fmt.go'), UNFORMATTED_GO);
  const fmt = node([path.join(dir, '.standards', 'check.mjs')], { cwd: dir });
  step(fmt.code === 1 && /FAIL \[[a-z-]+\/gofmt\] fmt\.go: not gofmt-formatted/.test(fmt.out), `${fx.id}: an unformatted file fails gofmt naming fmt.go`, fmt.out);
}

function vueInjections(fx, dir) {
  const cases = [
    ['src/save.ts', FLOATING, (o) => /src[\\/]save\.ts[\s\S]*no-floating-promises/.test(o) && /FAIL \[vue-ts\/eslint 10\.14\.0\]/.test(o), 'a floating promise fails eslint (type-aware) naming src/save.ts'],
    ['src/bad.ts', TYPE_ERR, (o) => /src\/bad\.ts\(1,14\): error TS2322/.test(o) && /FAIL \[vue-ts\/vue-tsc 3\.3\.14\]/.test(o), 'a type error fails vue-tsc --build naming src/bad.ts'],
    ['src/ugly.ts', UNFORMATTED, (o) => /src\/ugly\.ts/.test(o.replace(/\x1b\[[0-9;]*m/g, '')) && /FAIL \[vue-ts\/prettier 3\.10\.0\]/.test(o), 'an unformatted file fails prettier --check naming src/ugly.ts'],
  ];
  for (const [rel, body, ok, msg] of cases) {
    fs.writeFileSync(path.join(dir, rel), body);
    const r = check(dir);
    step(r.code === 1 && ok(r.out), `${fx.id}: ${msg}`, `exit ${r.code}\n${r.out}`);
    fs.rmSync(path.join(dir, rel));
  }
  const pj = path.join(dir, 'package.json');
  const orig = fs.readFileSync(pj);
  const p = JSON.parse(orig); p.devDependencies.eslint = '^10.0.0';
  fs.writeFileSync(pj, `${JSON.stringify(p, null, 2)}\n`);
  const r = check(dir);
  step(r.code === 1 && /FAIL \[vue-ts\/pins\] package\.json: eslint is "\^10\.0\.0", the profile pins exactly "10\.14\.0"/.test(r.out), `${fx.id}: a drifted pin fails the pins step`, r.out);
  fs.writeFileSync(pj, orig);
  const disable = 'export const y = 1 // eslint-disable-line no-console\n';
  fs.writeFileSync(path.join(dir, 'src/dis.ts'), disable);
  const d = check(dir);
  step(d.code === 1 && /src[\\/]dis\.ts[\s\S]*(Unused eslint-disable|require-description)/.test(d.out), `${fx.id}: an unused / reasonless eslint-disable fails`, d.out);
  fs.rmSync(path.join(dir, 'src/dis.ts'));
  const again = check(dir);
  step(again.code === 0, `${fx.id}: check.mjs passes again after the injections are removed`, again.out);
}

function firebaseInjections(fx, dir) {
  const rules = path.join(dir, 'firestore.rules');
  fs.writeFileSync(rules, RULES.replace('if request.auth != null && request.auth.uid == uid', 'if true'));
  let r = check(dir);
  step(r.code === 1 && /FAIL \[firebase-web\/rules\] firestore\.rules: line 5: `allow \.\.\.: if true`/.test(r.out), `${fx.id}: an open rule fails naming firestore.rules line 5`, r.out);
  fs.writeFileSync(rules, RULES.replace('      allow read, write: if request.auth != null && request.auth.uid == uid;', '      // standards: public -- fixture reason\n      allow read: if true;'));
  r = check(dir);
  step(r.code === 0, `${fx.id}: a reasoned public marker passes`, r.out);
  fs.writeFileSync(rules, RULES);
  fs.writeFileSync(path.join(dir, 'storage.rules'), "rules_version = '2'\nservice firebase.storage {\n  match /b/{bucket}/o {\n    match /{all=**} {\n      allow read, write: if false;\n    }\n  }\n}\n");
  fs.writeFileSync(path.join(dir, 'firebase.json'), `${JSON.stringify({ firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }, storage: { rules: 'storage.rules' } }, null, 2)}\n`);
  git(dir, 'add', 'storage.rules');
  r = check(dir);
  step(r.code === 1 && /FAIL \[firebase-web\/rules-tested\] storage\.rules: no test/.test(r.out), `${fx.id}: a rules file no test loads fails`, r.out);
  git(dir, 'rm', '-q', '--cached', 'storage.rules');
  fs.rmSync(path.join(dir, 'storage.rules'));
  fs.writeFileSync(path.join(dir, 'firebase.json'), FB_FILES['firebase.json']);
  fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github/workflows/ci.yml'), 'jobs:\n  t:\n    steps:\n      - run: npm install -g firebase-tools\n');
  git(dir, 'add', '.github');
  r = check(dir);
  step(r.code === 1 && /FAIL \[firebase-web\/cli\] \.github\/workflows\/ci\.yml:4: global firebase-tools install/.test(r.out), `${fx.id}: a global firebase-tools install fails naming ci.yml:4`, r.out);
  git(dir, 'rm', '-q', '-r', '--cached', '.github');
  fs.rmSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sa.json'), '{ "type": "service_account", "private_key": "x", "client_email": "y" }\n');
  git(dir, 'add', 'sa.json');
  r = check(dir);
  step(r.code === 1 && /FAIL \[firebase-web\/secrets\] sa\.json: contains a service-account private_key/.test(r.out), `${fx.id}: a committed service-account key fails`, r.out);
  git(dir, 'rm', '-q', '--cached', 'sa.json');
  fs.rmSync(path.join(dir, 'sa.json'));
  r = check(dir);
  step(r.code === 0, `${fx.id}: check.mjs passes again after the injections are removed`, r.out);
}

if (out) fs.writeFileSync(out, `${lines.join('\n')}\n`);
console.log(failed ? `fixture-sync: ${failed} failure(s)` : `fixture-sync: OK (${FIXTURES.length} fixtures, ${lines.length} synced files hashed)`);
process.exitCode = failed ? 1 : 0;
