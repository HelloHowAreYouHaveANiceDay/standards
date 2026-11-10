#!/usr/bin/env node
// Standards gate. Vendored by HelloHowAreYouHaveANiceDay/standards (profile base); do not edit -- re-run sync.
// Zero dependencies: Node built-ins only, so CI needs nothing from the kit.
//
//   node .standards/check.mjs               # locks, then every profile's .standards/<name>/check.json commands
//   node .standards/check.mjs --locks-only  # locks only
//
// 1. Locks: every `.standards/<profile>.SHA256SUMS` (the kit's SHA256SUMS, verbatim) and
//    `.standards/generated.SHA256SUMS` must match the files on disk; `.standards.json` versions must match the
//    locked fragments; nothing unlisted may sit in `.standards/`. Any lock failure stops before tools run.
// 2. Fragments, in `.standards.json` order: each command runs from the repo root under the job env.
// Every failure prints one line: `standards: FAIL [<profile>/<tool>] <file>: <what>` (or `[lock]`, `[generated]`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUMS_RE = /^([0-9a-f]{64}) {2}(\S(?:.*\S)?)$/;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const posix = (p) => p.split(path.sep).join('/');

export function parseSums(text, label) {
  const out = new Map();
  const errors = [];
  text.split('\n').forEach((line, i) => {
    if (line === '') return;
    const m = SUMS_RE.exec(line);
    if (!m) errors.push(`${label}:${i + 1}: not a "<sha256>  <path>" line`);
    else out.set(m[2], m[1]);
  });
  return { sums: out, errors };
}

// Header line written by sync into generated files: `# overlay: <path> sha256:<hex>|none`.
export function overlayStamp(text) {
  const m = /^# overlay: (\S+) (?:sha256:([0-9a-f]{64})|none)$/m.exec(text);
  return m ? { path: m[1], sha: m[2] || null } : null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listFiles(dir, rel = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, r));
    else out.push(r);
  }
  return out;
}

// Returns { failures: [line], profiles: [{name, version, fragment}] }.
export function verifyLocks(root) {
  const failures = [];
  const fail = (tag, file, what) => failures.push(`standards: FAIL [${tag}] ${file}: ${what}`);
  const std = path.join(root, '.standards');
  let manifest;
  try {
    manifest = readJson(path.join(root, '.standards.json'));
  } catch (e) {
    fail('lock', '.standards.json', `unreadable (${e.code || e.message})`);
    return { failures, profiles: [] };
  }
  const wanted = manifest && typeof manifest.profiles === 'object' && manifest.profiles ? manifest.profiles : {};
  const listed = new Set();
  const profiles = [];

  const lockNames = fs.existsSync(std)
    ? fs.readdirSync(std).filter((f) => f.endsWith('.SHA256SUMS')).map((f) => f.slice(0, -'.SHA256SUMS'.length))
    : [];
  for (const n of lockNames) {
    if (n === 'generated') continue;
    if (!Object.hasOwn(wanted, n)) fail('lock', `.standards/${n}.SHA256SUMS`, `profile ${n} is not in .standards.json (re-run sync)`);
  }
  for (const [name, version] of Object.entries(wanted)) {
    const lockRel = `.standards/${name}.SHA256SUMS`;
    listed.add(lockRel);
    if (!lockNames.includes(name)) { fail('lock', lockRel, `missing lock for ${name}@${version} (run sync)`); continue; }
    const { sums, errors } = parseSums(fs.readFileSync(path.join(root, lockRel), 'utf8'), lockRel);
    errors.forEach((e) => failures.push(`standards: FAIL [lock] ${e}`));
    for (const [file, want] of sums) {
      listed.add(file);
      const abs = path.join(root, ...file.split('/'));
      if (!fs.existsSync(abs)) { fail('lock', file, `missing (listed in ${lockRel}); re-run sync`); continue; }
      const got = sha256(fs.readFileSync(abs));
      if (got !== want) fail('lock', file, `sha256 ${got} != ${lockRel} ${want} -- vendored files are read-only; restore it or re-run sync (overrides go in an overlay file)`);
    }
    const fragRel = `.standards/${name}/check.json`;
    if (!sums.has(fragRel)) { fail('lock', lockRel, `does not list ${fragRel}`); continue; }
    let fragment;
    try { fragment = readJson(path.join(root, fragRel)); } catch { continue; } // already reported as missing/changed
    if (fragment.version !== version) fail('lock', '.standards.json', `${name} is ${version} but the lock holds ${fragment.version} (run sync)`);
    profiles.push({ name, version, fragment });
  }

  // generated files (.golangci.yml): sha at generation time, plus the overlay stamp in their header.
  const genRel = '.standards/generated.SHA256SUMS';
  listed.add(genRel);
  const genAbs = path.join(root, genRel);
  const generated = fs.existsSync(genAbs) ? parseSums(fs.readFileSync(genAbs, 'utf8'), genRel) : { sums: new Map(), errors: [] };
  generated.errors.forEach((e) => failures.push(`standards: FAIL [generated] ${e}`));
  const expected = profiles.flatMap((p) => (Array.isArray(p.fragment.generate) ? p.fragment.generate : []));
  for (const g of expected) {
    if (!generated.sums.has(g.to)) fail('generated', g.to, `not recorded in ${genRel} (run sync)`);
  }
  for (const [file, want] of generated.sums) {
    const abs = path.join(root, ...file.split('/'));
    if (!fs.existsSync(abs)) { fail('generated', file, `missing (listed in ${genRel}); re-run sync`); continue; }
    const buf = fs.readFileSync(abs);
    const got = sha256(buf);
    const g = expected.find((e) => e.to === file);
    const overlayHint = g && g.overlay ? `; overrides go in ${g.overlay}, then re-run sync` : '; re-run sync';
    if (got !== want) { fail('generated', file, `sha256 ${got} != ${genRel} ${want} -- generated file, never edit it by hand${overlayHint}`); continue; }
    if (g && g.overlay) {
      const stamp = overlayStamp(buf.toString('utf8'));
      const oAbs = path.join(root, ...g.overlay.split('/'));
      const now = fs.existsSync(oAbs) ? sha256(fs.readFileSync(oAbs)) : null;
      if (!stamp || stamp.sha !== now) fail('generated', g.overlay, `changed since ${file} was generated -- re-run sync to regenerate ${file}`);
    }
  }

  // nothing unlisted inside .standards/
  for (const f of listFiles(std)) {
    const rel = `.standards/${f}`;
    if (!listed.has(rel)) fail('lock', rel, 'not listed in any lock (remove it; .standards/ holds only synced files)');
  }
  return { failures, profiles };
}

function cacheDir() {
  if (process.env.STANDARDS_CACHE) return process.env.STANDARDS_CACHE;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'standards', 'cache');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'standards');
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, ...opts });
  return { code: r.error ? -1 : r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', error: r.error };
}

// Build a Go tool for the HOST (GOOS/GOARCH of the job may target another OS), cached per module@version.
function installGoTool(root, install) {
  const host = sh('go', ['env', 'GOHOSTOS', 'GOHOSTARCH'], { cwd: root });
  if (host.code !== 0) return { error: `go env failed: ${host.out.trim() || host.error}` };
  const [goos, goarch] = host.stdout.trim().split(/\s+/);
  const dir = path.join(cacheDir(), 'go-tools', install.go.replace(/[^A-Za-z0-9.@-]+/g, '_'), `${goos}-${goarch}`);
  const bin = path.join(dir, install.bin + (goos === 'windows' ? '.exe' : ''));
  if (fs.existsSync(bin)) return { bin };
  fs.mkdirSync(dir, { recursive: true });
  console.log(`standards: installing ${install.go} for ${goos}/${goarch} into ${dir}`);
  // GOTOOLCHAIN auto: the tool's go.mod may need a newer Go than the follower's (e.g. go 1.23 repos).
  const tc = process.env.GOTOOLCHAIN;
  const env = { ...process.env, GOOS: goos, GOARCH: goarch, GOBIN: dir, GOFLAGS: '', GOTOOLCHAIN: !tc || tc === 'local' ? 'auto' : tc };
  const r = sh('go', ['install', install.go], { cwd: os.tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.code !== 0 || !fs.existsSync(bin)) return { error: `go install ${install.go} failed:\n${r.out}` };
  return { bin };
}

// `--new-from-merge-base=origin/main` needs origin/main and enough history to find the merge base.
function ensureRef(root, ref) {
  const [remote, ...rest] = ref.split('/');
  const branch = rest.join('/');
  const has = sh('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/${ref}`], { cwd: root }).code === 0;
  const shallow = sh('git', ['rev-parse', '--is-shallow-repository'], { cwd: root }).stdout.trim() === 'true';
  if (has && !shallow) return null;
  const args = ['fetch', '--no-tags', ...(shallow ? ['--unshallow'] : []), remote, `+refs/heads/${branch}:refs/remotes/${ref}`];
  console.log(`standards: ${ref} ${has ? 'is shallow' : 'missing'} -> git fetch --no-tags ${shallow ? '--unshallow ' : ''}${remote} ${branch}`);
  const r = sh('git', args, { cwd: root });
  return r.code === 0 ? null : `git ${args.join(' ')} failed: ${r.out.trim()}`;
}

// .go files of every package dir `go list ./...` reports (skips testdata/, vendor/, _dirs), repo-relative.
function goFiles(root) {
  const r = sh('go', ['list', '-e', '-f', '{{.Dir}}', './...'], { cwd: root });
  if (r.code !== 0) return { error: `go list failed: ${r.out.trim()}` };
  const files = [];
  for (const dir of new Set(r.stdout.split(/\r?\n/).filter(Boolean))) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (f.endsWith('.go') && fs.statSync(path.join(dir, f)).isFile()) files.push(posix(path.relative(root, path.join(dir, f))));
    }
  }
  return { files };
}

// A tool cache private to this checkout: <git dir>/standards-cache/<id>. golangci-lint keys its package cache by
// module path + file content but stores absolute file paths in the cached findings, so a cache shared between two
// checkouts of the same code (self-hosted runner workspaces, worktrees, `path:` checkouts, a fresh clone) hands
// back the other checkout's paths and `--new-from-merge-base` silently drops the finding. Always overrides the env.
function checkoutCache(root, id) {
  const g = sh('git', ['rev-parse', '--absolute-git-dir'], { cwd: root });
  const base = g.code === 0 && g.stdout.trim()
    ? path.resolve(g.stdout.trim(), 'standards-cache')
    : path.join(cacheDir(), 'checkouts', sha256(path.resolve(root)).slice(0, 16));
  const dir = path.join(base, id.replace(/[^A-Za-z0-9.-]+/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runCommand(root, profile, cmd) {
  const tag = `${profile}/${cmd.tool || cmd.id}`;
  const failures = [];
  const fail = (what) => failures.push(`standards: FAIL [${tag}] ${what}`);
  console.log(`standards: [${tag}] ${cmd.run.join(' ')}`);
  let bin = null;
  if (cmd.install && cmd.install.go) {
    const t = installGoTool(root, cmd.install);
    if (t.error) { fail(t.error); return failures; }
    bin = t.bin;
  }
  if (cmd.needsRef) {
    const err = ensureRef(root, cmd.needsRef);
    if (err) { fail(err); return failures; }
  }
  const env = { ...process.env };
  if (cmd.checkoutCacheEnv) env[cmd.checkoutCacheEnv] = checkoutCache(root, cmd.id);
  const argv = [];
  for (const a of cmd.run) {
    if (a === '{bin}') argv.push(bin);
    else if (a === '{goFiles}') {
      const g = goFiles(root);
      if (g.error) { fail(g.error); return failures; }
      if (g.files.length === 0) { console.log(`standards: [${tag}] no .go files -- skipped`); return failures; }
      argv.push(...g.files);
    } else argv.push(a);
  }
  // Long file lists: chunk to stay under Windows' command-line limit.
  const fixed = argv.slice(0, cmd.run.indexOf('{goFiles}') >= 0 ? cmd.run.indexOf('{goFiles}') : argv.length);
  const varying = argv.slice(fixed.length);
  const chunks = [];
  if (varying.length === 0) chunks.push(fixed);
  for (let i = 0; i < varying.length; i += 200) chunks.push([...fixed, ...varying.slice(i, i + 200)]);
  for (const a of chunks) {
    const r = sh(a[0], a.slice(1), { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.out) process.stdout.write(r.out.endsWith('\n') ? r.out : `${r.out}\n`);
    if (r.error) { fail(`could not start ${a[0]}: ${r.error.code || r.error.message}`); continue; }
    if (r.code !== 0) fail(`exit ${r.code} (findings above name file:line)`);
    else if (cmd.failOnOutput) {
      for (const line of r.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        const rel = path.isAbsolute(line) ? posix(path.relative(root, line)) : posix(line);
        fail((cmd.outputLine || '{line}: reported').replaceAll('{line}', rel));
      }
    }
  }
  return failures;
}

export function main(argv = process.argv.slice(2)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const locksOnly = argv.includes('--locks-only');
  const { failures, profiles } = verifyLocks(root);
  if (failures.length) {
    for (const f of failures) console.log(f);
    console.log(`standards: ${failures.length} failure(s) in the locks -- tools not run`);
    return 1;
  }
  console.log(`standards: locks OK (${profiles.map((p) => `${p.name}@${p.version}`).join(', ')})`);
  if (locksOnly) { console.log('standards: OK (locks only)'); return 0; }
  const all = [];
  for (const p of profiles) {
    for (const cmd of p.fragment.commands || []) all.push(...runCommand(root, p.name, cmd));
  }
  if (all.length) {
    for (const f of all) console.log(f);
    console.log(`standards: ${all.length} failure(s)`);
    return 1;
  }
  console.log('standards: OK');
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main();
