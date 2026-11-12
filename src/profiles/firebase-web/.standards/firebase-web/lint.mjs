#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile firebase-web); do not edit -- re-run sync.
// Zero dependencies, offline, no credentials. Checks a Firebase web app repo for the mistakes that ship
// silently: rules files that never compile in CI, open rules, committed credentials, drifting CLI installs.
//
//   node .standards/firebase-web/lint.mjs
//
// Every finding prints `standards: FAIL [firebase-web/<check>] <file>: <what> (fix: ...)`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RULES_KEYS = [['firestore', 'rules'], ['storage', 'rules'], ['database', 'rules']];

function tracked(root) {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${(r.stderr || '').trim()}`);
  return r.stdout.split('\0').filter(Boolean);
}

const read = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// The rules files firebase.json declares (firestore/storage may be arrays of targets).
export function declaredRules(cfg) {
  const out = [];
  for (const [svc, key] of RULES_KEYS) for (const e of asList(cfg[svc])) if (e && typeof e[key] === 'string') out.push({ svc, file: e[key] });
  return out;
}

// An intentionally public rule carries a reasoned marker on its line or the line above:
//   // standards: public -- invite lookup by unguessable token
//   allow get: if true;
const PUBLIC_OK = /\/\/\s*standards:\s*public\s+--\s*\S/;

export function lintRulesText(text) {
  const src = stripComments(text);
  const bad = [];
  if (/service\s+(cloud\.firestore|firebase\.storage)/.test(src)) {
    if (!/rules_version\s*=\s*['"]2['"]/.test(src)) bad.push("missing rules_version = '2' (v1 wildcards match differently)");
  }
  const lines = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split(/\r?\n/);
  lines.forEach((raw, i) => {
    const code = raw.replace(/\/\/.*$/, '');
    const open = /allow\s+[a-z, ]+:\s*if\s+true\s*;/.test(code) ? '`allow ...: if true` grants everyone access'
      : /allow\s+[a-z, ]+\s*;/.test(code) ? '`allow ...;` with no condition grants everyone access' : null;
    if (open && !PUBLIC_OK.test(raw) && !(i > 0 && PUBLIC_OK.test(lines[i - 1]))) {
      bad.push(`line ${i + 1}: ${open} (fix: narrow it, or mark it \`// standards: public -- <reason>\` on the line above)`);
    }
  });
  if (/request\.time\s*<\s*timestamp\.date\(/.test(src)) bad.push('test-mode expiry (`request.time < timestamp.date(...)`) left in the rules');
  return bad;
}

const SECRET_NAME = /(^|\/)([^/]*-firebase-adminsdk-[^/]*\.json|service-?account[^/]*\.json|serviceAccountKey\.json)$/i;
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;
const ENV_OK = /(^|\/)\.env\.(template|example|sample)$/;

export function lint(root) {
  const fails = [];
  const fail = (check, file, what) => fails.push(`standards: FAIL [firebase-web/${check}] ${file}: ${what}`);
  let cfg;
  try { cfg = JSON.parse(read(root, 'firebase.json')); } catch (e) { fail('config', 'firebase.json', `missing or not JSON (${e.code || e.message})`); return fails; }
  const files = tracked(root);
  const fileSet = new Set(files);

  // 1. declared rules/index files exist and are tracked; rules are not open
  const rules = declaredRules(cfg);
  for (const { svc, file } of rules) {
    if (!fileSet.has(file)) { fail('config', 'firebase.json', `${svc}.rules points at ${file}, which is not a tracked file`); continue; }
    for (const b of lintRulesText(read(root, file))) fail('rules', file, b);
  }
  for (const e of asList(cfg.firestore)) {
    if (e && typeof e.indexes === 'string' && !fileSet.has(e.indexes)) fail('config', 'firebase.json', `firestore.indexes points at ${e.indexes}, which is not a tracked file (fix: firebase firestore:indexes > ${e.indexes})`);
  }

  // 2. every rules file is loaded by a rules test (the emulator only compiles rules a test loads)
  const testFiles = files.filter((f) => /\.(m?[jt]s|cjs)$/.test(f) && !f.startsWith('.standards/')).filter((f) => {
    try { return read(root, f).includes('@firebase/rules-unit-testing'); } catch { return false; }
  });
  for (const { file } of rules) {
    if (!fileSet.has(file)) continue;
    const base = path.posix.basename(file);
    if (!testFiles.some((t) => read(root, t).includes(base))) {
      fail('rules-tested', file, `no test that imports @firebase/rules-unit-testing loads it (fix: a test that passes ${base} to initializeTestEnvironment and asserts one allow + one deny)`);
    }
  }

  // 3. no committed credentials
  for (const f of files) {
    if (SECRET_NAME.test(f)) fail('secrets', f, 'looks like a service-account key; remove it from git and rotate the key');
    else if (f.endsWith('.json') && !f.startsWith('node_modules/')) {
      try { const t = read(root, f); if (t.includes('"private_key"') && t.includes('"client_email"')) fail('secrets', f, 'contains a service-account private_key; remove it from git and rotate the key'); } catch { /* unreadable */ }
    }
    if (ENV_FILE.test(f) && !ENV_OK.test(f)) fail('secrets', f, 'a tracked .env file; keep only .env.template/.env.example in git (fix: git rm --cached, add to .gitignore)');
  }

  // 4. modular SDK only
  for (const f of files.filter((x) => /^src\/.*\.(m?[jt]sx?|vue)$/.test(x))) {
    const t = read(root, f);
    if (/from\s+['"]firebase\/compat\//.test(t) || /import\s+['"]firebase\/compat\//.test(t)) fail('sdk', f, 'imports firebase/compat; use the modular SDK (firebase/app, firebase/firestore, ...)');
  }

  // 5. CLI is a pinned devDependency, never a global install in CI
  let pkg = {};
  try { pkg = JSON.parse(read(root, 'package.json')); } catch { /* reported by other profiles */ }
  const dev = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (!dev['firebase-tools']) fail('cli', 'package.json', 'firebase-tools is not a devDependency (fix: npm i -D -E firebase-tools@<version>; run it as npx firebase)');
  for (const f of files.filter((x) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(x))) {
    read(root, f).split(/\r?\n/).forEach((line, i) => {
      if (/\bnpm\s+(i|install)\b[^\n#]*\s(-g|--global)\b[^\n#]*\bfirebase-tools\b/.test(line) || /\bnpm\s+(i|install)\b[^\n#]*\bfirebase-tools\b[^\n#]*\s(-g|--global)\b/.test(line)) {
        fail('cli', `${f}:${i + 1}`, 'global firebase-tools install; use the repo-pinned devDependency (npx firebase ...) so CI runs the version tests ran with');
      }
    });
  }

  // 6. firebase and @firebase/rules-unit-testing majors agree (installed peer range)
  try {
    const rut = JSON.parse(read(root, 'node_modules/@firebase/rules-unit-testing/package.json'));
    const fb = JSON.parse(read(root, 'node_modules/firebase/package.json'));
    const peer = (rut.peerDependencies || {}).firebase;
    const m = peer && /^\^(\d+)/.exec(peer);
    if (m && fb.version.split('.')[0] !== m[1]) fail('versions', 'package.json', `firebase ${fb.version} does not satisfy @firebase/rules-unit-testing ${rut.version} peer ${peer} (fix: move both to matching majors)`);
  } catch { /* not installed: nothing to compare */ }

  return fails;
}

export function main(root = process.cwd()) {
  const fails = lint(root);
  for (const f of fails) console.log(f);
  console.log(fails.length ? `standards: firebase-web: ${fails.length} finding(s)` : 'standards: [firebase-web/lint] OK');
  return fails.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
