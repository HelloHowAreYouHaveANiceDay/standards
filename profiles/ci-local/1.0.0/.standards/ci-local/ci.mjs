#!/usr/bin/env node
// ci-local: builder-side CI (spec: _design-ci/spec-builder-side-ci.v3.md). Zero dependencies, node >= 20.
//
//   node .standards/ci-local/ci.mjs <verb> [options] [--json]
//
//   run             run ci/suites.json for THIS host's OS on a clean detached checkout, write record.<os>.json
//   sign RECORD     ssh-keygen -Y sign (namespace ci-result@hhay) -> RECORD.sig
//   publish RECORD  put RECORD + .sig on refs/ci/<tree> (keeps the other OS records) and push it
//   verify          the mechanical check: signatures, tree, toolchain, suites, required OSes
//   status          verify, then POST commit status `builder-ci` (the only poster; --dry-run prints the request)
//   check-manifest  lint ci/suites.json and the allowed-signers file
//
// Envelope with --json: {ok:true,result} | {ok:false,error:{code,message}}.
// Exit: 0 ok/pass, 1 fail (verify/run red, lint findings), 2 pending (verify: required OS record missing),
//       3 error (tooling, git, network), 64 usage.
// Windows and Linux are tested; macOS paths are written but UNTESTED.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VERSION = '1.0.0';
const NS = 'ci-result@hhay';
const SCHEMA = 'ci-local/1';
const RECORD_SCHEMA = 'ci-record/1';
const SIGNERS_PATH = '.standards/ci-local/allowed_signers.org';
const MANIFEST_PATH = 'ci/suites.json';
const OS_CLASSES = ['windows', 'linux', 'macos'];
const FILE_CAP = 3000;
const CONTEXT = 'builder-ci';

class CiError extends Error {
  constructor(code, message, exit = 3) { super(message); this.code = code; this.exit = exit; }
}
const usage = (m) => new CiError('usage', m, 64);

// ---------- small helpers ----------
export const hostOs = () => ({ win32: 'windows', linux: 'linux', darwin: 'macos' })[process.platform] ?? process.platform;
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: opts.binary ? 'buffer' : 'utf8', input: opts.input, cwd: opts.cwd, env: opts.env ?? process.env, shell: opts.shell, timeout: opts.timeout, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return { code: r.status ?? (r.error ? 127 : 1), out: r.stdout ?? '', err: (r.stderr ?? '') + (r.error ? String(r.error.message) : ''), timedOut: r.error?.code === 'ETIMEDOUT' };
}
const git = (cwd, args, opts = {}) => run('git', args, { cwd, ...opts });
function gitOk(cwd, args, what, opts) {
  const r = git(cwd, args, opts);
  if (r.code !== 0) throw new CiError('git', `${what ?? `git ${args.join(' ')}`}: ${r.err.trim() || r.out.trim()}`);
  return opts?.binary ? r.out : r.out.trim();
}
const gitTry = (cwd, args) => { const r = git(cwd, args); return r.code === 0 ? r.out.trim() : null; };

// Version rule (one function, run and verify): equal to the pin or extending it at a dot boundary.
export function versionMatches(pin, actual) {
  const p = String(pin).replace(/^v/, ''); const a = String(actual ?? '').replace(/^v/, '');
  return a === p || a.startsWith(`${p}.`);
}

export function globToRegExp(g) {
  let s = '';
  for (let i = 0; i < g.length;) {
    if (g.startsWith('**/', i)) { s += '(?:.*/)?'; i += 3; } else if (g.startsWith('**', i)) { s += '.*'; i += 2; } else if (g[i] === '*') { s += '[^/]*'; i++; } else if (g[i] === '?') { s += '[^/]'; i++; } else { s += g[i].replace(/[.+^${}()|[\]\\]/g, '\\$&'); i++; }
  }
  return new RegExp(`^${s}$`);
}

// ---------- manifest ----------
const BUILTIN_PROBES = {
  node: ['node', '--version'], pnpm: ['pnpm', '--version'], npm: ['npm', '--version'], python: [process.platform === 'win32' ? 'python' : 'python3', '--version'],
  uv: ['uv', '--version'], java: ['java', '-version'], go: ['go', 'version'], dotnet: ['dotnet', '--version'], cargo: ['cargo', '--version'],
  rustc: ['rustc', '--version'], 'firebase-tools': ['firebase', '--version'], playwright: ['playwright', '--version'],
};

export function validateManifest(m) {
  const e = [];
  const isStrArr = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x);
  if (!m || typeof m !== 'object' || Array.isArray(m)) return [`${MANIFEST_PATH}: not a JSON object`];
  if (m.schema !== SCHEMA) e.push(`schema must be "${SCHEMA}"`);
  if (!isStrArr(m.os_required) || !m.os_required.length) e.push('os_required is mandatory: a non-empty list of windows|linux|macos');
  else for (const o of m.os_required) if (!OS_CLASSES.includes(o)) e.push(`os_required: unknown OS "${o}"`);
  if (m.toolchain !== undefined) {
    if (typeof m.toolchain !== 'object' || Array.isArray(m.toolchain) || !m.toolchain) e.push('toolchain must be an object');
    else for (const [k, v] of Object.entries(m.toolchain)) {
      const custom = v && typeof v === 'object';
      if (!custom && typeof v !== 'string') e.push(`toolchain.${k}: a version string or {version, probe}`);
      else if (custom && (typeof v.version !== 'string' || typeof v.probe !== 'string')) e.push(`toolchain.${k}: custom entries need version and probe strings`);
      else if (!custom && !BUILTIN_PROBES[k]) e.push(`toolchain.${k}: no built-in probe; use {version, probe}`);
    }
  }
  if (m.setup !== undefined && !isStrArr(m.setup)) e.push('setup must be a list of command strings');
  if (!Array.isArray(m.suites) || !m.suites.length) e.push('suites must be a non-empty list');
  else {
    const seen = new Set();
    m.suites.forEach((s, i) => {
      const w = `suites[${i}]${s?.id ? ` (${s.id})` : ''}`;
      if (!s || typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) return e.push(`${w}: id must match [a-z0-9-]+`);
      if (seen.has(s.id)) e.push(`${w}: duplicate id`);
      seen.add(s.id);
      if (!isStrArr(s.run) || !s.run.length) e.push(`${w}: run must be a non-empty list of command strings`);
      if (typeof s.required !== 'boolean') e.push(`${w}: required must be true or false`);
      if (!['any', ...OS_CLASSES].includes(s.os ?? 'any')) e.push(`${w}: os must be any|linux|windows|macos`);
      if (s.paths !== undefined && !isStrArr(s.paths)) e.push(`${w}: paths must be a list of globs`);
      if (s.if_exists !== undefined && !isStrArr(s.if_exists)) e.push(`${w}: if_exists must be a list of repo paths`);
      if (s.timeout_min !== undefined && !(Number.isFinite(s.timeout_min) && s.timeout_min > 0)) e.push(`${w}: timeout_min must be a number > 0`);
      if (s.ports !== undefined && !(Number.isInteger(s.ports) && s.ports > 0)) e.push(`${w}: ports must be a positive integer`);
    });
  }
  return e;
}

function readManifestAt(cwd, rev) {
  const raw = rev ? gitTry(cwd, ['show', `${rev}:${MANIFEST_PATH}`]) : (fs.existsSync(path.join(cwd, MANIFEST_PATH)) ? fs.readFileSync(path.join(cwd, MANIFEST_PATH), 'utf8') : null);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch (e) { throw new CiError('manifest-invalid', `${MANIFEST_PATH}: not valid JSON (${e.message})`, 1); }
}

// ---------- allowed signers ----------
export function lintSigners(text) {
  const e = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const w = `${SIGNERS_PATH}:${i + 1}`;
    const principal = t.split(/\s+/)[0];
    if (/[*?]/.test(principal)) e.push(`${w}: wildcard principal "${principal}"`);
    if (!/namespaces="[^"]*ci-result@hhay[^"]*"/.test(t) && !/namespaces=ci-result@hhay/.test(t)) e.push(`${w}: missing namespaces="${NS}"`);
    if (!/valid-before="?\d{8}/.test(t)) e.push(`${w}: missing valid-before`);
  });
  return e;
}

// ---------- git context ----------
function defaultBranchRef(cwd, override) {
  const cands = [];
  if (override) cands.push(override);
  const sym = gitTry(cwd, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']);
  if (sym) cands.push(sym);
  cands.push('origin/main', 'main', 'origin/master', 'master');
  for (const c of cands) if (gitTry(cwd, ['rev-parse', '--verify', '-q', `${c}^{commit}`])) return c;
  return null;
}

function changedFiles(cwd, head, defRef) {
  if (!defRef) return { files: null, base: null };
  const base = gitTry(cwd, ['merge-base', head, defRef]);
  if (!base) return { files: null, base: null };
  const out = gitOk(cwd, ['diff', '--name-only', `${base}`, head], 'git diff');
  const files = out ? out.split('\n') : [];
  return { files: files.length >= FILE_CAP ? null : files, base };
}

function suiteSelected(suite, files) {
  if (files === null || !suite.paths) return true; // no base, API cap, or no paths: every suite counts as selected
  const res = suite.paths.map(globToRegExp);
  return files.some((f) => res.some((r) => r.test(f)));
}

// ---------- toolchain ----------
function probeVersion(name, pin) {
  const custom = pin && typeof pin === 'object';
  const spec = custom ? pin.probe.split(/\s+/) : BUILTIN_PROBES[name];
  const r = run(spec[0], spec.slice(1), { shell: process.platform === 'win32', timeout: 60000 });
  const text = `${r.out}\n${r.err}`;
  const m = text.match(/(\d+(?:\.\d+)+)/) ?? text.match(/\b(\d+)\b/);
  return r.code === 0 && m ? m[1] : null;
}
const pinVersion = (p) => (p && typeof p === 'object' ? p.version : p);

function toolchainOf(manifest, osClass) {
  const probes = {}; const drift = [];
  for (const [name, pin] of Object.entries(manifest.toolchain ?? {})) {
    const v = probeVersion(name, pin);
    probes[name] = v;
    if (v === null) drift.push(`${name}: not found (pin ${pinVersion(pin)})`);
    else if (!versionMatches(pinVersion(pin), v)) drift.push(`${name}: have ${v}, pin ${pinVersion(pin)}`);
  }
  return { toolchain: { os: osClass, arch: os.arch(), probes }, drift };
}

const recordKey = (tree, toolchain) => sha256(JSON.stringify({ tree, toolchain, ci_local_version: VERSION }));

// ---------- args ----------
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = (eq > 0 ? a.slice(2, eq) : a.slice(2));
      if (['json', 'dry-run', 'approved', 'checkout', 'no-push', 'help'].includes(k)) o[k] = true;
      else if (eq > 0) o[k] = a.slice(eq + 1);
      else if (i + 1 < argv.length) o[k] = argv[++i];
      else throw usage(`--${k} needs a value`);
    } else o._.push(a);
  }
  return o;
}
const repoRoot = (o) => path.resolve(o.root ?? process.cwd());

// ---------- run ----------
function cmdRun(o) {
  const cwd = repoRoot(o);
  const sha = o.sha ? gitOk(cwd, ['rev-parse', '--verify', `${o.sha}^{commit}`], `unknown commit ${o.sha}`) : gitOk(cwd, ['rev-parse', 'HEAD'], 'HEAD');
  if (o.checkout) return runInScratchCheckout(cwd, sha, o);
  const head = gitOk(cwd, ['rev-parse', 'HEAD'], 'HEAD');
  const dirty = gitOk(cwd, ['status', '--porcelain'], 'git status');
  const detached = git(cwd, ['symbolic-ref', '-q', 'HEAD']).code !== 0;
  if (head !== sha || dirty || !detached) {
    throw new CiError('not-clean-checkout', `refusing: need a clean, detached checkout of ${sha.slice(0, 12)} (HEAD=${head.slice(0, 12)}, detached=${detached}, dirty=${!!dirty}); use --checkout to make one`, 1);
  }
  const tree = gitOk(cwd, ['rev-parse', `${sha}^{tree}`], 'tree');
  const manifest = readManifestAt(cwd, null);
  if (!manifest) throw new CiError('manifest-missing', `${MANIFEST_PATH} not found`, 1);
  const bad = validateManifest(manifest);
  if (bad.length) throw new CiError('manifest-invalid', `${MANIFEST_PATH}: ${bad.join('; ')}`, 1);
  const osClass = hostOs();
  const out = path.resolve(o.out ?? process.env.CI_OUT ?? path.join(os.tmpdir(), 'ci-local', tree.slice(0, 12)));
  fs.mkdirSync(path.join(out, 'logs'), { recursive: true });
  const recPath = path.join(out, `record.${osClass}.json`);
  const { toolchain, drift } = toolchainOf(manifest, osClass);
  const key = recordKey(tree, toolchain);

  if (fs.existsSync(recPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(recPath, 'utf8'));
      if (prev.key === key && prev.outcome === 'pass') return { exit: 0, result: { reuse: true, record: recPath, key, outcome: 'pass', tree, os: osClass } };
    } catch { /* stale or corrupt: rerun */ }
  }

  const defRef = defaultBranchRef(cwd, o['default-branch']);
  const { files, base } = changedFiles(cwd, sha, defRef);
  const signer = o.signer ?? process.env.CI_SIGNER ?? `${os.userInfo().username}@${os.hostname()}`;
  const record = { schema: RECORD_SCHEMA, key, tree, commit: sha, base, ci_local_version: VERSION, toolchain, manifest_sha256: sha256(fs.readFileSync(path.join(cwd, MANIFEST_PATH))), os: osClass, host: os.hostname(), signer, created: nowIso(), outcome: 'pass', reason: null, suites: [] };
  const finish = (outcome, reason) => {
    record.outcome = outcome; record.reason = reason;
    fs.writeFileSync(recPath, `${JSON.stringify(record, null, 2)}\n`);
    for (const f of [`${recPath}.sig`]) fs.rmSync(f, { force: true }); // a new record invalidates any old signature
    return { exit: outcome === 'pass' ? 0 : 1, result: { reuse: false, record: recPath, key, outcome, reason, tree, os: osClass, suites: record.suites.map((s) => ({ id: s.id, status: s.status })) } };
  };

  if (drift.length) return finish('fail', `toolchain-drift: ${drift.join('; ')}`);
  for (const cmd of manifest.setup ?? []) {
    const r = run(cmd, [], { cwd, shell: true, timeout: 30 * 60000 });
    if (r.code !== 0) return finish('fail', `setup-failed: ${cmd}: ${(r.err || r.out).trim().slice(-200)}`);
  }
  let failed = false;
  manifest.suites.forEach((s, idx) => {
    const rec = { id: s.id, required: s.required, status: '', duration_s: 0, log_sha256: null };
    record.suites.push(rec);
    const sos = s.os ?? 'any';
    if (sos !== 'any' && sos !== osClass) { rec.status = 'skipped:os'; return; }
    const absent = (s.if_exists ?? []).filter((p) => !fs.existsSync(path.join(cwd, p)));
    if (absent.length) { rec.status = 'skipped:absent'; return; }
    if (!suiteSelected(s, files)) { rec.status = 'skipped:path'; return; }
    const env = { ...process.env };
    for (let n = 0; n < (s.ports ?? 0); n++) env[`CI_PORT_BASE_${n}`] = String(20000 + (parseInt(tree.slice(0, 4), 16) % 300) * 100 + idx * 10 + n);
    const t0 = Date.now(); let log = ''; let ok = false; let attempts = 0;
    for (; attempts < 2 && !ok; attempts++) {
      ok = true;
      for (const cmd of s.run) {
        const r = run(cmd, [], { cwd, shell: true, env, timeout: (s.timeout_min ?? 30) * 60000 });
        log += `$ ${cmd}\n${r.out}${r.err}\n[exit ${r.code}${r.timedOut ? ' timeout' : ''}]\n`;
        if (r.code !== 0) { ok = false; break; }
      }
    }
    rec.duration_s = Math.round((Date.now() - t0) / 100) / 10;
    rec.status = ok ? (attempts === 1 ? 'passed' : 'flaky') : 'failed';
    fs.writeFileSync(path.join(out, 'logs', `${s.id}.${osClass}.log`), log);
    rec.log_sha256 = sha256(log);
    if (!ok && s.required) failed = true;
    if (!ok && !s.required) rec.status = 'failed';
  });
  const anyFailed = record.suites.some((s) => s.status === 'failed');
  return finish(failed || anyFailed ? 'fail' : 'pass', failed ? `suite-failed: ${record.suites.filter((s) => s.status === 'failed' && s.required).map((s) => s.id).join(',')}` : null);
}

function runInScratchCheckout(cwd, sha, o) {
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'ci-wt-'));
  const wt = path.join(scratch, 'wt');
  gitOk(cwd, ['worktree', 'add', '--detach', wt, sha], 'git worktree add');
  try {
    const out = path.resolve(o.out ?? process.env.CI_OUT ?? path.join(os.tmpdir(), 'ci-local', sha.slice(0, 12)));
    const args = [path.join(wt, '.standards', 'ci-local', 'ci.mjs'), 'run', '--sha', sha, '--out', out, '--json'];
    for (const k of ['signer', 'default-branch']) if (o[k]) args.push(`--${k}`, o[k]);
    const defRef = defaultBranchRef(cwd, o['default-branch']);
    // the scratch worktree shares refs with cwd, so default-branch resolution works there too
    if (!o['default-branch'] && defRef) args.push('--default-branch', defRef);
    const r = run(process.execPath, args, { cwd: wt });
    let env; try { env = JSON.parse(r.out); } catch { throw new CiError('run-failed', `inner run produced no envelope: ${(r.err || r.out).trim().slice(-300)}`); }
    if (!env.ok) throw new CiError(env.error.code, env.error.message, r.code || 3);
    return { exit: r.code, result: env.result };
  } finally {
    git(cwd, ['worktree', 'remove', '--force', wt]);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------- sign / publish ----------
function cmdSign(o) {
  const rec = o._[1]; if (!rec) throw usage('sign RECORD --key PATH');
  const key = o.key ?? process.env.CI_SIGNING_KEY; if (!key) throw usage('sign needs --key PATH or CI_SIGNING_KEY');
  if (!fs.existsSync(rec)) throw new CiError('no-record', `${rec} not found`);
  fs.rmSync(`${rec}.sig`, { force: true });
  const r = run('ssh-keygen', ['-Y', 'sign', '-q', '-f', key, '-n', NS, rec]);
  if (r.code !== 0 || !fs.existsSync(`${rec}.sig`)) throw new CiError('sign-failed', `ssh-keygen -Y sign: ${r.err.trim() || r.out.trim()}`);
  return { exit: 0, result: { record: rec, signature: `${rec}.sig`, namespace: NS } };
}

function readRef(cwd, ref) {
  const ls = gitTry(cwd, ['ls-tree', '-r', ref]);
  if (ls === null) return null;
  const files = {};
  for (const line of ls.split('\n').filter(Boolean)) {
    const [meta, name] = line.split('\t');
    const sha = meta.split(' ')[2];
    files[name] = gitOk(cwd, ['cat-file', 'blob', sha], 'cat-file', { binary: true });
  }
  return files;
}

function cmdPublish(o) {
  const cwd = repoRoot(o);
  const recPath = o._[1]; if (!recPath) throw usage('publish RECORD');
  if (!fs.existsSync(`${recPath}.sig`)) throw new CiError('unsigned', `${recPath}.sig not found: run \`ci sign\` first`, 1);
  const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'));
  if (!/^[0-9a-f]{40,64}$/.test(rec.tree ?? '')) throw new CiError('bad-record', 'record has no tree');
  const ref = `refs/ci/${rec.tree}`;
  const remote = o.remote ?? 'origin';
  const hasRemote = !o['no-push'] && gitTry(cwd, ['remote', 'get-url', remote]) !== null;
  const base = path.basename(recPath);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (hasRemote) git(cwd, ['fetch', '--quiet', remote, `+${ref}:${ref}`]);
    const parent = gitTry(cwd, ['rev-parse', '--verify', '-q', ref]);
    const files = (parent && readRef(cwd, ref)) || {};
    files[base] = fs.readFileSync(recPath); files[`${base}.sig`] = fs.readFileSync(`${recPath}.sig`);
    const summary = Object.keys(files).filter((n) => n.endsWith('.json')).sort().map((n) => { const r = JSON.parse(files[n].toString('utf8')); return `${n}: ${r.outcome} signer=${r.signer} host=${r.host} created=${r.created}`; }).join('\n');
    files['summary.txt'] = Buffer.from(`${summary}\n`.slice(0, 64 * 1024));
    const lines = Object.keys(files).sort().map((n) => `100644 blob ${gitOk(cwd, ['hash-object', '-w', '--stdin'], 'hash-object', { input: files[n] })}\t${n}`).join('\n');
    const tree = gitOk(cwd, ['mktree'], 'mktree', { input: `${lines}\n` });
    const env = { ...process.env, GIT_AUTHOR_NAME: 'ci-local', GIT_AUTHOR_EMAIL: 'ci-local@invalid', GIT_COMMITTER_NAME: 'ci-local', GIT_COMMITTER_EMAIL: 'ci-local@invalid' };
    const commit = gitOk(cwd, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `ci record ${rec.os} ${rec.outcome} ${rec.tree}`], 'commit-tree', { env });
    gitOk(cwd, ['update-ref', ref, commit], 'update-ref');
    if (!hasRemote) return { exit: 0, result: { ref, commit, pushed: false, files: Object.keys(files).sort() } };
    const p = git(cwd, ['push', '--quiet', remote, `${ref}:${ref}`]);
    if (p.code === 0) return { exit: 0, result: { ref, commit, pushed: true, remote, files: Object.keys(files).sort() } };
    if (attempt === 1) throw new CiError('push-failed', `git push ${ref}: ${p.err.trim()}`);
  }
  throw new CiError('push-failed', 'unreachable');
}

// ---------- verify ----------
function sshVerify(signersText, principal, recordBuf, sigBuf, verifyTime) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'ci-sv-'));
  try {
    fs.writeFileSync(path.join(dir, 'signers'), signersText); fs.writeFileSync(path.join(dir, 'sig'), sigBuf);
    const args = ['-Y', 'verify', '-f', path.join(dir, 'signers'), '-I', principal, '-n', NS, '-s', path.join(dir, 'sig')];
    if (verifyTime) args.push(`-Overify-time=${verifyTime}`);
    const r = run('ssh-keygen', args, { input: recordBuf });
    return { ok: r.code === 0, detail: (r.err || r.out).trim().split('\n')[0] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export function verifyCore(o, cwd) {
  const reasons = []; const fail = (code, detail) => reasons.push({ code, detail });
  let sha = o.sha;
  if (o.pr) {
    const f = git(cwd, ['fetch', '--quiet', o.remote ?? 'origin', `refs/pull/${o.pr}/head`]);
    if (f.code !== 0) throw new CiError('fetch-failed', `fetch refs/pull/${o.pr}/head: ${f.err.trim()}`);
    sha = gitOk(cwd, ['rev-parse', 'FETCH_HEAD'], 'FETCH_HEAD');
  }
  sha = gitOk(cwd, ['rev-parse', '--verify', `${sha ?? 'HEAD'}^{commit}`], `unknown commit ${sha}`);
  const tree = gitOk(cwd, ['rev-parse', `${sha}^{tree}`], 'tree');
  const defRef = defaultBranchRef(cwd, o['default-branch']);
  const summary = { sha, tree, default_branch: defRef, records: [], os_required: [] };
  const done = () => ({ sha, tree, summary, reasons });

  // signers: default branch tip only
  let signersText;
  if (o.signers) signersText = fs.readFileSync(o.signers, 'utf8');
  else if (defRef) signersText = gitTry(cwd, ['show', `${defRef}:${SIGNERS_PATH}`]);
  if (!signersText) { fail('no-signers', o.signers ? `${o.signers} empty` : `${SIGNERS_PATH} not on ${defRef ?? 'the default branch'}`); return done(); }
  const sigLint = lintSigners(signersText);
  if (sigLint.length) fail('signers-lint', sigLint[0]);

  let head;
  try { head = readManifestAt(cwd, sha); } catch (e) { fail(e.code, e.message); return done(); }
  if (!head) { fail('manifest-missing', `${MANIFEST_PATH} not at ${sha.slice(0, 12)}`); return done(); }
  const mErr = validateManifest(head);
  if (mErr.length) { fail('manifest-invalid', mErr[0]); return done(); }

  // fail closed when CI-relevant files differ from the default branch (label ci-manifest-approved = --approved)
  let defManifest = null;
  if (defRef) {
    try { defManifest = readManifestAt(cwd, defRef); } catch { /* a broken default manifest counts as absent */ }
    const diff = gitTry(cwd, ['diff', '--name-only', defRef, sha, '--', MANIFEST_PATH, '.standards/ci-local', '.github']);
    if (diff && !o.approved) fail('manifest-changed', `differs from ${defRef}: ${diff.split('\n').slice(0, 3).join(', ')} (needs the human ci-manifest-approved label)`);
  }
  const requiredOs = o.os ? [o.os] : (defManifest?.os_required ?? head.os_required);
  summary.os_required = requiredOs;

  // the record ref
  const ref = `refs/ci/${tree}`;
  if (!gitTry(cwd, ['rev-parse', '--verify', '-q', ref]) && gitTry(cwd, ['remote', 'get-url', o.remote ?? 'origin']) !== null) git(cwd, ['fetch', '--quiet', o.remote ?? 'origin', `+${ref}:${ref}`]);
  const files = readRef(cwd, ref);
  if (!files) { fail('no-record', `no ${ref} (the harness has not published)`); return done(); }

  const { files: changed } = changedFiles(cwd, sha, defRef);
  const present = {}; // os -> record (signature-verified, bound)
  for (const name of Object.keys(files).filter((n) => /^record\.[a-z]+\.json$/.test(n)).sort()) {
    const osName = name.split('.')[1];
    const sigBuf = files[`${name}.sig`];
    let rec; try { rec = JSON.parse(files[name].toString('utf8')); } catch { /* bad-signature below */ }
    if (!sigBuf) { fail('unsigned', `${name} has no .sig`); continue; }
    const v = sshVerify(signersText, rec?.signer ?? '', files[name], sigBuf, o['verify-time'] === 'record' && rec?.created ? rec.created.replace(/[-:TZ]/g, '').slice(0, 14) : null);
    if (!rec || !v.ok) { fail('bad-signature', `${name}: ${v.detail}`); continue; }
    if (rec.tree !== tree) { fail('wrong-tree', `${name}: record.tree ${String(rec.tree).slice(0, 12)} != head tree ${tree.slice(0, 12)}`); continue; }
    if (rec.os !== osName || rec.toolchain?.os !== osName) { fail('wrong-os', `${name}: record claims ${rec.os}/${rec.toolchain?.os}`); continue; }
    if (rec.ci_local_version !== VERSION) { fail('ci-version-mismatch', `${name}: record ${rec.ci_local_version}, vendored ${VERSION}`); continue; }
    const tcBad = Object.entries(head.toolchain ?? {}).filter(([k, pin]) => !versionMatches(pinVersion(pin), rec.toolchain?.probes?.[k]));
    if (tcBad.length) { fail('toolchain-mismatch', `${name}: ${tcBad.map(([k, p]) => `${k} have ${rec.toolchain?.probes?.[k] ?? 'none'} pin ${pinVersion(p)}`).join('; ')}`); continue; }
    if (rec.key !== recordKey(rec.tree, rec.toolchain)) { fail('bad-key', `${name}: key does not match tree+toolchain+version`); continue; }
    present[osName] = rec;
    summary.records.push({ os: osName, signer: rec.signer, host: rec.host, outcome: rec.outcome, created: rec.created });
  }

  // OS coverage and suites
  const missing = requiredOs.filter((x) => !present[x]);
  const usable = requiredOs.filter((x) => present[x]).map((x) => present[x]);
  for (const r of usable) if (r.outcome !== 'pass') fail('record-failed', `${r.os}: ${r.reason ?? 'outcome fail'}`);
  for (const s of head.suites.filter((x) => x.required)) {
    const sts = usable.map((r) => ({ os: r.os, st: r.suites?.find((x) => x.id === s.id)?.status }));
    const failedOn = sts.find((x) => x.st === 'failed');
    if (failedOn) { fail('suite-failed', `${s.id} failed on ${failedOn.os}`); continue; }
    if (!usable.length) continue;
    if (sts.some((x) => x.st === 'passed' || x.st === 'flaky')) continue;
    const bad = sts.find((x) => x.st === undefined); if (bad) { fail('suite-missing', `${s.id} absent from the ${bad.os} record`); continue; }
    const selected = suiteSelected(s, changed);
    const allPresent = (s.if_exists ?? []).every((p) => git(cwd, ['cat-file', '-e', `${sha}:${p}`]).code === 0);
    if (sts.every((x) => x.st === 'skipped:os')) fail('skipped-os', `${s.id}: needs a ${s.os} host`);
    else if (sts.some((x) => x.st === 'skipped:path') && selected) fail('skipped-path-abuse', `${s.id} was skipped by path but the diff selects it`);
    else if (sts.some((x) => x.st === 'skipped:absent') && allPresent) fail('skipped-absent-abuse', `${s.id} was skipped for absent files that exist at the head`);
    else if (!sts.some((x) => x.st === 'skipped:path' || x.st === 'skipped:absent')) fail('suite-missing', `${s.id}: ${sts.map((x) => `${x.os}=${x.st}`).join(' ')}`);
  }
  if (!reasons.length && missing.length) return { ...done(), pending: missing };
  return done();
}

function cmdVerify(o) {
  const cwd = repoRoot(o);
  const v = verifyCore(o, cwd);
  const verdict = v.reasons.length ? 'fail' : v.pending ? 'pending' : 'pass';
  const result = { verdict, ...v.summary, reasons: v.reasons, missing_os: v.pending ?? [] };
  return { exit: verdict === 'pass' ? 0 : verdict === 'fail' ? 1 : 2, result };
}

// ---------- status ----------
export function statusRequest({ repo, sha, verdict, reasons, missing, tree, apiBase, targetUrl }) {
  const state = { pass: 'success', pending: 'pending', fail: 'failure' }[verdict];
  const desc = verdict === 'pass' ? 'signed records verified' : verdict === 'pending' ? `waiting for ${missing.join(', ')} record` : `${reasons[0].code}: ${reasons[0].detail}`;
  return {
    method: 'POST',
    url: `${apiBase}/repos/${repo}/statuses/${sha}`,
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer <GH_TOKEN>', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': `ci-local/${VERSION}` },
    body: { state, context: CONTEXT, description: desc.length > 140 ? `${desc.slice(0, 137)}...` : desc, target_url: targetUrl ?? `https://github.com/${repo}/tree/refs/ci/${tree}` },
  };
}

async function cmdStatus(o) {
  const cwd = repoRoot(o);
  let repo = o.repo;
  if (!repo) {
    const url = gitTry(cwd, ['remote', 'get-url', o.remote ?? 'origin']) ?? '';
    repo = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
    if (!repo) throw usage('status needs --repo OWNER/REPO');
  }
  const v = verifyCore(o, cwd);
  const verdict = v.reasons.length ? 'fail' : v.pending ? 'pending' : 'pass';
  const apiBase = (o['api-base'] ?? process.env.CI_GITHUB_API ?? 'https://api.github.com').replace(/\/$/, '');
  const req = statusRequest({ repo, sha: v.sha, verdict, reasons: v.reasons, missing: v.pending ?? [], tree: v.tree, apiBase, targetUrl: o['target-url'] });
  if (o['dry-run']) return { exit: 0, result: { dry_run: true, verdict, request: req } };
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) throw new CiError('no-token', 'status needs GH_TOKEN (or GITHUB_TOKEN) in the environment');
  const res = await fetch(req.url, { method: 'POST', headers: { ...req.headers, Authorization: `Bearer ${token}` }, body: JSON.stringify(req.body) });
  const text = await res.text();
  if (!res.ok) throw new CiError('status-post-failed', `HTTP ${res.status}: ${text.slice(0, 200)}`);
  return { exit: 0, result: { posted: true, http: res.status, verdict, request: req } };
}

// ---------- check-manifest ----------
function cmdCheckManifest(o) {
  const cwd = repoRoot(o);
  const findings = [];
  const p = path.join(cwd, MANIFEST_PATH);
  if (!fs.existsSync(p)) findings.push(`${MANIFEST_PATH}: missing`);
  else {
    try { for (const e of validateManifest(JSON.parse(fs.readFileSync(p, 'utf8')))) findings.push(`${MANIFEST_PATH}: ${e}`); } catch (e) { findings.push(`${MANIFEST_PATH}: not valid JSON (${e.message})`); }
  }
  const sp = path.join(cwd, SIGNERS_PATH);
  if (fs.existsSync(sp)) findings.push(...lintSigners(fs.readFileSync(sp, 'utf8')));
  return { exit: findings.length ? 1 : 0, result: { findings } };
}

// ---------- main ----------
const VERBS = { run: cmdRun, sign: cmdSign, publish: cmdPublish, verify: cmdVerify, status: cmdStatus, 'check-manifest': cmdCheckManifest };

export async function main(argv) {
  let o; let json = argv.includes('--json');
  try {
    o = parseArgs(argv); json = !!o.json;
    const verb = o._[0];
    if (!verb || o.help) { process.stdout.write(`ci-local ${VERSION}: verbs ${Object.keys(VERBS).join(' | ')} (--json for the envelope)\n`); return verb ? 0 : 64; }
    if (!VERBS[verb]) throw usage(`unknown verb "${verb}"`);
    const { exit, result } = await VERBS[verb](o);
    if (json) process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
    else process.stdout.write(`${humanLine(verb, result)}\n`);
    return exit;
  } catch (e) {
    if (!(e instanceof CiError)) e = new CiError('internal', e?.stack ?? String(e));
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: { code: e.code, message: e.message } })}\n`);
    else process.stderr.write(`ci ${e.code}: ${e.message}\n`);
    return e.exit;
  }
}
function humanLine(verb, r) {
  if (verb === 'verify') return `verify: ${r.verdict}${r.reasons.length ? ` (${r.reasons.map((x) => `${x.code}: ${x.detail}`).join('; ')})` : r.missing_os.length ? ` (waiting for ${r.missing_os.join(', ')})` : ''}`;
  if (verb === 'check-manifest') return r.findings.length ? r.findings.join('\n') : 'ci-local manifest ok';
  if (verb === 'run') return `run: ${r.reuse ? 'reuse ' : ''}${r.outcome}${r.reason ? ` (${r.reason})` : ''} ${r.record}`;
  return JSON.stringify(r);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
