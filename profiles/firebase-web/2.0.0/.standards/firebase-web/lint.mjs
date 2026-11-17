#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile firebase-web); do not edit -- re-run sync.
// Zero dependencies, offline, no credentials. Checks a Firebase web app repo for the mistakes that ship
// silently: rules files that never compile in CI, open or unbounded rules, committed credentials, drifting CLI
// installs, and function / hosting settings that leave an endpoint open (rules F1-F11).
//
//   node .standards/firebase-web/lint.mjs [root]
//
// Findings print `standards: FAIL|WARN [firebase-web/<check>] <file>[:<line>]: <what> (fix: ...)`. WARN never fails
// the gate. F1-F3 keep their 1.0.0 check names (config, rules, rules-tested, secrets, sdk, cli, versions); F4-F11
// print their rule id. Pattern checks, not proofs: rule helpers resolve by name, function option objects by a
// const in the functions source. Standard text: docs/firebase.md in the standards kit.
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

const blank = (m) => m.replace(/[^\n]/g, ' ');
// Rules text with comments blanked out, so offsets and line numbers match the file.
const blankRulesComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// Reasoned markers: `<marker> -- <reason>` in a // comment on the line or in the comment block right above it.
//   // standards: schema -- fields are checked by the callable         (F5)
//   // standards: no-app-check -- webhook, signed by the sender        (F8)
const SCHEMA_OK = /\/\/\s*standards:\s*schema\s+--\s*\S/;
const NO_APPCHECK_OK = /\/\/\s*standards:\s*no-app-check\s+--\s*\S/;

function markerNear(lines, i, re) {
  if (re.test(lines[i])) return true;
  for (let j = i - 1; j >= 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[j]); j--) if (re.test(lines[j])) return true;
  return false;
}

// ---- rules parsing (F4, F5, F6) ---------------------------------------------------------------------------
function balanced(s, open, openCh, closeCh) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === openCh) d++;
    else if (s[i] === closeCh && --d === 0) return i;
  }
  return -1;
}

// { name -> body text } for `function name(args) { ... }` in (comment-blanked) rules text.
export function rulesFunctions(src) {
  const fns = {};
  for (const m of src.matchAll(/\bfunction\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const end = balanced(src, open, '{', '}');
    if (end > 0) fns[m[1]] = src.slice(open + 1, end).trim();
  }
  return fns;
}

const METHOD = '(?:create|update|delete|write|read|get|list)';
// Every `allow <methods>: if <cond>;` (cond null when there is none) with its start offset.
export function rulesAllows(src) {
  const out = [];
  for (const m of src.matchAll(new RegExp(`\\ballow\\s+(${METHOD}(?:\\s*,\\s*${METHOD})*)\\s*(?::\\s*if\\s+([^;]*?))?\\s*;`, 'g'))) {
    out.push({ index: m.index, methods: m[1].split(',').map((x) => x.trim()), cond: m[2] === undefined ? null : m[2].trim() });
  }
  return out;
}

// The condition plus the bodies of the helpers it calls, followed transitively (depth 3).
function expandCond(cond, fns, depth = 3, seen = new Set()) {
  let text = cond;
  if (depth === 0) return text;
  for (const m of cond.matchAll(/\b(\w+)\s*\(/g)) {
    const name = m[1];
    if (fns[name] !== undefined && !seen.has(name)) {
      seen.add(name);
      text += ` ${expandCond(fns[name], fns, depth - 1, seen)}`;
    }
  }
  return text;
}

const norm = (s) => s.replace(/\s+/g, '');
const isAuthOnly = (t) => /^\(*request\.auth!=null\)*$/.test(norm(t));
const returnExpr = (body) => { const m = /^return\s+([\s\S]*?);?$/.exec(body.trim()); return m ? m[1] : null; };

// F4 / F5 / F6 over one rules file. Returns [{ rule, level, line, what }].
export function lintRulesShape(text) {
  const src = blankRulesComments(text);
  const raw = text.split(/\r?\n/);
  const fns = rulesFunctions(src);
  const storage = /service\s+firebase\.storage/.test(src);
  const firestore = /service\s+cloud\.firestore/.test(src);
  const out = [];
  for (const a of rulesAllows(src)) {
    if (a.cond === null || a.cond === 'false') continue; // condition-less is F1's; `if false` denies
    const line = lineOf(src, a.index);
    const writes = a.methods.some((m) => m === 'write' || m === 'create' || m === 'update');
    const expanded = expandCond(a.cond, fns);
    const methods = a.methods.join(', ');
    if (storage && writes) {
      const miss = [/request\.resource\.size\b/.test(expanded) ? null : 'request.resource.size', /request\.resource\.contentType\b/.test(expanded) ? null : 'request.resource.contentType'].filter(Boolean);
      if (miss.length) out.push({ rule: 'F4', level: 'FAIL', line, what: `storage \`allow ${methods}\` does not check ${miss.join(' or ')} (fix: cap the size and pin the type, e.g. \`request.resource.size < 10 * 1024 * 1024 && request.resource.contentType.matches('image/.*')\`)` });
    }
    if (firestore && writes && !/\b(keys|affectedKeys)\(\)\s*\.\s*(hasOnly|hasAll)\s*\(/.test(expanded) && !markerNear(raw, line - 1, SCHEMA_OK)) {
      out.push({ rule: 'F5', level: 'WARN', line, what: `Firestore \`allow ${methods}\` has no field allowlist (fix: \`request.resource.data.keys().hasOnly([...])\` or \`request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])\`, or \`// standards: schema -- <reason>\` above it)` });
    }
    if ((storage || firestore) && a.methods.some((m) => m === 'write' || m === 'create' || m === 'update' || m === 'delete')) {
      let only = isAuthOnly(a.cond);
      const call = /^(\w+)\s*\(\s*\)$/.exec(a.cond);
      if (!only && call && fns[call[1]] !== undefined) { const r = returnExpr(fns[call[1]]); only = r !== null && isAuthOnly(r); }
      if (only) out.push({ rule: 'F6', level: 'FAIL', line, what: `\`allow ${methods}\` needs only \`request.auth != null\`, which every sign-up satisfies (fix: tie the write to ownership, membership or a custom claim)` });
    }
  }
  return out;
}

// ---- functions source parsing (F7-F9, F11) ----------------------------------------------------------------
// JS/TS text with comments blanked (newlines kept), skipping quotes and template literals.
export function stripJsComments(s) {
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i];
    const n = s[i + 1];
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') {
      const e = s.indexOf('*/', i + 2);
      const end = e < 0 ? s.length : e + 2;
      out += blank(s.slice(i, end));
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; j++; }
      out += s.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Top-level comma-separated arguments of the call whose `(` is at `open`.
function callArgs(s, open) {
  const args = [];
  let d = 0;
  let start = open + 1;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') { i++; while (i < s.length && s[i] !== c) { if (s[i] === '\\') i++; i++; } continue; }
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') {
      d--;
      if (d === 0) { args.push(s.slice(start, i).trim()); return args; }
    } else if (c === ',' && d === 1) { args.push(s.slice(start, i).trim()); start = i + 1; }
  }
  return args;
}

// The value text of `const|let|var NAME [: T] = <value>` (object/array literal balanced, else to `;`).
function constValue(src, name) {
  const m = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b\\s*(?::[^=]+)?=\\s*`).exec(src);
  if (!m) return null;
  const at = m.index + m[0].length;
  if (src[at] === '{' || src[at] === '[') { const e = balanced(src, at, src[at], src[at] === '{' ? '}' : ']'); return e > 0 ? src.slice(at, e + 1) : null; }
  const e = src.indexOf(';', at);
  return src.slice(at, e < 0 ? undefined : e).trim();
}
const findConst = (srcs, n) => { for (const s of srcs) { const v = constValue(s, n); if (v !== null) return v; } return null; };

// A trigger's option text: the object literal, or the const it names, with `...SPREAD` consts folded in.
// null = an identifier no source file defines (the options cannot be seen).
function optionsText(arg, srcs) {
  if (arg === undefined || arg === '') return '';
  if (/^[A-Za-z_$][\w$]*$/.test(arg)) { const v = findConst(srcs, arg); return v === null ? null : optionsText(v.replace(/\s+as\s+const\s*$/, ''), srcs); }
  if (!arg.startsWith('{')) return '';
  let text = arg;
  for (const m of arg.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) { const v = optionsText(m[1], srcs); if (v) text += ` ${v}`; }
  return text;
}

const TRIGGER = /\b(onCall|onRequest|onSchedule|onDocument(?:Created|Updated|Deleted|Written)|onObject(?:Finalized|Archived|Deleted|MetadataUpdated)|onMessagePublished|onTaskDispatched|beforeUserCreated|beforeUserSignedIn)\b\s*/g;

// Every trigger call in a source: { kind, line, opts (string, or null = unseen) }.
export function functionTriggers(src, allSrcs = [src]) {
  const out = [];
  for (const m of src.matchAll(TRIGGER)) {
    let i = m.index + m[0].length;
    if (src[i] === '<') { let d = 0; for (; i < src.length; i++) { if (src[i] === '<') d++; else if (src[i] === '>' && --d === 0) { i++; break; } } while (/\s/.test(src[i] || '')) i++; }
    if (src[i] !== '(') continue;
    const args = callArgs(src, i);
    const stringFirst = args[0] !== undefined && /^["'`]/.test(args[0]);
    let opts = stringFirst ? '' : optionsText(args[0], allSrcs);
    if (m[1] === 'onSchedule' && stringFirst && args[1] && /^[{A-Za-z_$]/.test(args[1]) && !/=>|^function|^async/.test(args[1].slice(0, 40))) opts = optionsText(args[1], allSrcs);
    // v1-style `functions.runWith({...}).https.onCall(handler)`: the options sit before the trigger.
    const stmt = src.slice(Math.max(0, m.index - 300), m.index);
    const tail = stmt.slice(stmt.lastIndexOf(';') + 1);
    if (opts === '' && /runWith\s*\(/.test(tail)) opts = tail;
    out.push({ kind: m[1], line: lineOf(src, m.index), opts });
  }
  return out;
}

const APP_CHECK_VERIFY = /\bappCheck\s*\([^)]*\)\s*\.\s*verifyToken\s*\(|\bgetAppCheck\s*\([^)]*\)\s*\.\s*verifyToken\s*\(|X-Firebase-AppCheck/i;

function lintFunctions(root, files, cfg, fail, warn) {
  const sources = asList(cfg.functions).map((e) => (e && typeof e.source === 'string' ? e.source : 'functions').replace(/\/$/, ''));
  if (!sources.length) return;
  const code = files.filter((f) => /\.(ts|js|mjs|cjs)$/.test(f)
    && sources.some((s) => f.startsWith(`${s}/`))
    && !/(^|\/)(node_modules|lib|dist|scripts|__tests__|__fixtures__)\//.test(f)
    && !/\.(test|spec)\./.test(f) && !/\.d\.ts$/.test(f));
  const text = {};
  for (const f of code) { try { text[f] = stripJsComments(read(root, f)); } catch { /* unreadable */ } }
  const all = Object.values(text);

  // setGlobalOptions({...}) anywhere in the functions source applies to every function.
  let globalOpts = '';
  for (const s of all) for (const m of s.matchAll(/\bsetGlobalOptions\s*\(/g)) globalOpts += ` ${optionsText(callArgs(s, m.index + m[0].length - 1)[0], all) || ''}`;

  for (const [f, s] of Object.entries(text)) {
    // F7: secrets come from defineSecret, never functions.config() or a secret-named process.env read.
    s.split('\n').forEach((ln, i) => {
      if (/\bfunctions\s*\.\s*config\s*\(\s*\)/.test(ln)) fail('F7', `${f}:${i + 1}`, 'reads functions.config(), which is gone from current runtimes (fix: `defineSecret` / `defineString` from firebase-functions/params)');
      for (const m of ln.matchAll(/process\.env\s*(?:\.\s*([A-Za-z0-9_$]+)|\[\s*['"]([^'"]+)['"]\s*\])/g)) {
        const name = m[1] || m[2];
        if (/(SECRET|KEY|TOKEN|PASSWORD)/.test(name)) fail('F7', `${f}:${i + 1}`, `reads process.env.${name}; an env var is not a secret store (fix: \`defineSecret('${name}')\` and list it in the function's \`secrets\` option)`);
      }
    });
    const raw = read(root, f).split(/\r?\n/);
    for (const t of functionTriggers(s, all)) {
      const where = `${f}:${t.line}`;
      const opts = t.opts === null ? null : `${t.opts} ${globalOpts}`;
      // F9
      if (opts === null) fail('F9', where, `${t.kind} options name a const no source here defines, so maxInstances cannot be seen (fix: inline the options or define the const in the functions source)`);
      else if (!/\bmaxInstances\s*:/.test(opts)) fail('F9', where, `${t.kind} has no maxInstances, so a request flood scales the bill without bound (fix: \`maxInstances: <n>\` in its options or \`setGlobalOptions({ maxInstances })\`)`);
      // F8
      if (t.kind === 'onCall') {
        if (opts !== null && !/\benforceAppCheck\s*:\s*true\b/.test(opts) && !markerNear(raw, t.line - 1, NO_APPCHECK_OK)) warn('F8', where, 'onCall without `enforceAppCheck: true` (fix: set it, or `// standards: no-app-check -- <reason>` above)');
      } else if (t.kind === 'onRequest') {
        if (!APP_CHECK_VERIFY.test(s) && !markerNear(raw, t.line - 1, NO_APPCHECK_OK)) warn('F8', where, 'onRequest does not verify an App Check token (fix: `getAppCheck().verifyToken(req.header("X-Firebase-AppCheck"))`, or `// standards: no-app-check -- <reason>` above)');
        // F11
        const c = opts && /\bcors\s*:\s*(\[[^\]]*\]|[^,}]+)/.exec(opts);
        if (c) {
          let v = c[1].trim();
          if (/^[A-Za-z_$][\w$]*$/.test(v)) v = findConst(all, v) ?? v;
          if (v === 'true' || /['"]\*['"]/.test(v)) fail('F11', where, 'onRequest allows every origin (`cors: true` or `\'*\'`) (fix: list the app origins, e.g. `cors: ["https://app.example.com"]`)');
        }
      }
    }
  }
}

// ---- hosting headers (F10) --------------------------------------------------------------------------------
function lintHosting(cfg, warn) {
  asList(cfg.hosting).forEach((h, i) => {
    if (!h || typeof h !== 'object') return;
    const keys = new Set();
    for (const rule of asList(h.headers)) for (const hd of asList(rule && rule.headers)) if (hd && typeof hd.key === 'string') keys.add(hd.key.toLowerCase());
    const tag = Array.isArray(cfg.hosting) ? `hosting[${i}]` : 'hosting';
    if (!keys.has('content-security-policy')) {
      warn('F10', 'firebase.json', keys.has('content-security-policy-report-only')
        ? `${tag} sends Content-Security-Policy-Report-Only only; nothing is enforced (fix: promote it to Content-Security-Policy once the report is clean)`
        : `${tag} sends no Content-Security-Policy header (fix: add one under hosting.headers)`);
    }
    if (!keys.has('strict-transport-security')) warn('F10', 'firebase.json', `${tag} sends no Strict-Transport-Security header (fix: \`max-age=31536000; includeSubDomains\`)`);
  });
}

const SECRET_NAME = /(^|\/)([^/]*-firebase-adminsdk-[^/]*\.json|service-?account[^/]*\.json|serviceAccountKey\.json)$/i;
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;
const ENV_OK = /(^|\/)\.env\.(template|example|sample)$/;

// Returns { fails, warns } (printed lines).
export function lint(root) {
  const fails = [];
  const warns = [];
  const fail = (check, file, what) => fails.push(`standards: FAIL [firebase-web/${check}] ${file}: ${what}`);
  const warn = (check, file, what) => warns.push(`standards: WARN [firebase-web/${check}] ${file}: ${what}`);
  let cfg;
  try { cfg = JSON.parse(read(root, 'firebase.json')); } catch (e) { fail('config', 'firebase.json', `missing or not JSON (${e.code || e.message})`); return { fails, warns }; }
  const files = tracked(root);
  const fileSet = new Set(files);

  // 1. declared rules/index files exist and are tracked; rules are not open
  const rules = declaredRules(cfg);
  for (const { svc, file } of rules) {
    if (!fileSet.has(file)) { fail('config', 'firebase.json', `${svc}.rules points at ${file}, which is not a tracked file`); continue; }
    const text = read(root, file);
    for (const b of lintRulesText(text)) fail('rules', file, b);
    if (svc !== 'database') for (const f of lintRulesShape(text)) (f.level === 'FAIL' ? fail : warn)(f.rule, `${file}:${f.line}`, f.what);
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

  // 7. functions source (F7-F9, F11) and hosting headers (F10)
  lintFunctions(root, files, cfg, fail, warn);
  lintHosting(cfg, warn);

  return { fails, warns };
}

export function main(root = process.cwd()) {
  const { fails, warns } = lint(root);
  for (const l of [...fails, ...warns]) console.log(l);
  if (fails.length) console.log(`standards: firebase-web: ${fails.length} finding(s)${warns.length ? `, ${warns.length} warning(s)` : ''}`);
  else console.log(`standards: [firebase-web/lint] OK${warns.length ? ` with ${warns.length} warning(s)` : ''}`);
  return fails.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
