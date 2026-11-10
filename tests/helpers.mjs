// Shared test helpers: temp dirs, synthetic kits, process runners, byte snapshots.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SYNC = path.join(KIT_ROOT, 'sync.mjs');
export const WHO = path.join(KIT_ROOT, 'who.mjs');
export const RELEASE = path.join(KIT_ROOT, 'scripts', 'release.mjs');
export const APPEND_ONLY = path.join(KIT_ROOT, 'scripts', 'append-only.mjs');

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function tmpdir(prefix = 'standards-test-') {
  const base = process.env.RUNNER_TEMP || os.tmpdir();
  return fs.mkdtempSync(path.join(base, prefix));
}

// Every file under dir (posix rel path -> Buffer), skipping .git.
export function walk(dir, rel = '') {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.name === '.git') continue;
    if (e.isDirectory()) Object.assign(out, walk(dir, r));
    else out[r] = fs.readFileSync(path.join(dir, r));
  }
  return out;
}

export function snapshot(dir) {
  return Object.fromEntries(Object.entries(walk(dir)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, sha256(v)]));
}

export function formatSums(files) {
  return Object.keys(files).sort().map((f) => `${sha256(Buffer.from(files[f]))}  ${f}\n`).join('');
}

// Write one profile version into a kit dir: files are follower-relative.
// opts.sums overrides the SHA256SUMS text (to inject mismatches).
export function writeProfile(kitDir, name, ver, files, opts = {}) {
  const dir = path.join(kitDir, 'profiles', name, ver);
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), opts.sums ?? formatSums(files));
  const vfile = path.join(kitDir, 'profiles', name, 'VERSIONS');
  const have = fs.existsSync(vfile) ? fs.readFileSync(vfile, 'utf8').split('\n').filter(Boolean) : [];
  if (!have.includes(ver)) have.push(ver);
  have.sort(cmpSemver);
  fs.writeFileSync(vfile, have.map((v) => `${v}\n`).join(''));
}

export function cmpSemver(a, b) {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// Real released profile files (as bytes) from this repo.
export function realProfileFiles(name, ver) {
  const files = walk(path.join(KIT_ROOT, 'profiles', name, ver));
  delete files.SHA256SUMS;
  return files;
}

export function checkJson(profile, version, extra = {}) {
  return `${JSON.stringify({ profile, version, ...extra }, null, 2)}\n`;
}

// A synthetic kit with the real base@1.0.0 plus whatever the caller adds.
export function makeKit(extra = () => {}) {
  const kit = tmpdir('standards-kit-');
  writeProfile(kit, 'base', '1.0.0', realProfileFiles('base', '1.0.0'));
  extra(kit);
  return kit;
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts, env: { ...process.env, ...(opts.env || {}) } });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || '') };
}

export const node = (args, opts) => run(process.execPath, args, opts);

export function git(cwd, ...args) {
  const r = run('git', ['-c', 'core.autocrlf=false', '-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.out}`);
  return r.stdout.trim();
}

// An empty follower repo (git, one commit on main).
export function makeFollower(files = { 'README.md': '# fixture\n' }) {
  const dir = tmpdir('standards-follower-');
  git(dir, 'init', '-q', '-b', 'main');
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture');
  return dir;
}

// Async runner (needed when the same process serves HTTP).
export function runAsync(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { ...opts, env: { ...process.env, ...(opts.env || {}) } });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (code) => resolve({ code, stdout, stderr, out: stdout + stderr }));
  });
}

// Serve a kit dir over HTTP (raw bytes, like raw.githubusercontent.com). Returns {url, close, hits}.
export function serveKit(kitDir) {
  return new Promise((resolve) => {
    const hits = [];
    const server = http.createServer((req, res) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/kit\//, '');
      hits.push(u);
      const f = path.join(kitDir, ...u.split('/'));
      if (!u || u.includes('..') || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404: Not Found'); return; }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(fs.readFileSync(f));
    });
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/kit`, hits, close: () => new Promise((r) => server.close(r)) }));
  });
}
