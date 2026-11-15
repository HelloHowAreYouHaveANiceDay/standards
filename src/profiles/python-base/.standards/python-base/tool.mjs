#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile python-base); do not edit -- re-run sync.
// Zero dependencies, no shell, no Python, no uv/pip needed by the GATE: downloads the exact-pinned Ruff release archive from
// GitHub releases, verifies its sha256 against the pin in check.json, unpacks it with node (zip / tar.gz
// readers below) into the standards cache, and runs it. The PROJECT it checks must use uv (rules U1-U4, `uv` below).
//
//   node .standards/python-base/tool.mjs config            # the follower's Ruff config extends the vendored one
//   node .standards/python-base/tool.mjs uv                # U1-U4: uv.lock, no other lock/requirements, .python-version, pinned uv
//   node .standards/python-base/tool.mjs ruff <args...>    # run the pinned Ruff in the follower root
//
// Pins and per-platform archive sha256 live in .standards/python-base/check.json ("tools", "archives").
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TAG = 'python-base';
const EXTEND = '.standards/python-base/ruff.toml';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function cacheDir() {
  if (process.env.STANDARDS_CACHE) return process.env.STANDARDS_CACHE;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'standards', 'cache');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'standards');
}

// node's platform/arch -> Ruff's target triple (a key of check.json "archives").
export function hostTriple(platform = process.platform, arch = process.arch) {
  const cpu = { x64: 'x86_64', arm64: 'aarch64' }[arch];
  const os_ = { win32: 'pc-windows-msvc', linux: 'unknown-linux-gnu', darwin: 'apple-darwin' }[platform];
  return cpu && os_ ? `${cpu}-${os_}` : null;
}

// ---- archive readers (just enough for the one binary inside a Ruff release archive) ----

export function extractFromZip(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.split('/').pop() !== wanted) continue;
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + csize);
    if (method === 0) return Buffer.from(raw);
    if (method === 8) return zlib.inflateRawSync(raw);
    throw new Error(`unsupported zip compression method ${method}`);
  }
  throw new Error(`${wanted} not found in the zip archive`);
}

export function extractFromTarGz(gz, wanted) {
  const buf = zlib.gunzipSync(gz);
  let p = 0;
  while (p + 512 <= buf.length) {
    const head = buf.subarray(p, p + 512);
    if (head.every((b) => b === 0)) break;
    const cstr = (a, b) => { const s = head.toString('utf8', a, b); const z = s.indexOf('\0'); return z < 0 ? s : s.slice(0, z); };
    const name = cstr(0, 100);
    const size = parseInt(cstr(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(head[156] || 48);
    p += 512;
    if ((type === '0' || type === '\0') && name.split('/').pop() === wanted) return Buffer.from(buf.subarray(p, p + size));
    p += Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wanted} not found in the tar.gz archive`);
}

// ---- install ----

async function download(url) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1000 * i)); }
  }
  throw new Error(`download of ${url} failed: ${last.message}`);
}

// Returns { bin } or { error }. Cached per version+triple; the cached binary is re-hashed on every use.
export async function ensureRuff(cfg = readJson(path.join(HERE, 'check.json')), triple = hostTriple()) {
  const version = cfg.tools.ruff;
  const a = triple && cfg.archives[triple];
  if (!a) return { error: `no pinned Ruff archive for ${process.platform}/${process.arch} (check.json \"archives\" has ${Object.keys(cfg.archives).join(', ')})` };
  const exe = triple.includes('windows') ? 'ruff.exe' : 'ruff';
  const dir = path.join(cacheDir(), 'ruff', `${version}-${triple}`);
  const bin = path.join(dir, exe);
  const mark = path.join(dir, 'binary.sha256');
  try {
    if (fs.readFileSync(mark, 'utf8').trim() === sha256(fs.readFileSync(bin))) return { bin };
  } catch { /* not cached yet */ }
  const url = `https://github.com/astral-sh/ruff/releases/download/${version}/${a.file}`;
  console.log(`standards: [${TAG}] downloading ${url}`);
  let archive;
  try { archive = await download(url); } catch (e) { return { error: e.message }; }
  const got = sha256(archive);
  if (got !== a.sha256) return { error: `${a.file}: sha256 ${got} != pinned ${a.sha256} (refusing to run an unverified binary)` };
  let bytes;
  try { bytes = a.file.endsWith('.zip') ? extractFromZip(archive, exe) : extractFromTarGz(archive, exe); } catch (e) { return { error: `${a.file}: ${e.message}` }; }
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${bin}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes, { mode: 0o755 });
  fs.renameSync(tmp, bin);
  fs.writeFileSync(mark, `${sha256(bytes)}\n`);
  return { bin };
}

// ---- config check: the follower's Ruff config must extend the vendored one ----

// Ruff's own precedence in one directory: .ruff.toml, ruff.toml, then pyproject.toml (only with [tool.ruff]).
export function configProblems(root = ROOT) {
  const exists = (f) => fs.existsSync(path.join(root, f));
  const fixToml = `create ruff.toml containing: extend = \"${EXTEND}\"`;
  for (const f of ['.ruff.toml', 'ruff.toml']) {
    if (!exists(f)) continue;
    return extendsVendored(fs.readFileSync(path.join(root, f), 'utf8'), null) ? [] : [`${f}: does not set extend = \"${EXTEND}\" at the top level (fix: add that line before any [table])`];
  }
  if (exists('pyproject.toml')) {
    const text = fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8');
    if (/^\s*\[tool\.ruff(\.[^\]]*)?\]/m.test(text)) {
      return extendsVendored(text, 'tool.ruff') ? [] : [`pyproject.toml: [tool.ruff] does not set extend = \"${EXTEND}\" (fix: add that line under [tool.ruff])`];
    }
  }
  return [`no Ruff config at the repo root (fix: ${fixToml})`];
}

// Is `extend = "<vendored>"` set in the given table ('tool.ruff'), or at the top level when table is null?
function extendsVendored(text, table) {
  const v = extendValue(text, table);
  return v !== null && v.replace(/^\.\//, '') === EXTEND;
}

function extendValue(text, table) {
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    const h = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (h) { current = h[1]; continue; }
    if (current !== table) continue;
    const m = /^extend\s*=\s*["']([^"']+)["']$/.exec(line);
    if (m) return m[1];
  }
  return null;
}

// Ruff uses the CLOSEST config for each file and does not merge with the root one, so a tracked nested config
// (subdir ruff.toml / .ruff.toml / pyproject.toml with [tool.ruff]) silently drops the profile unless it extends.
export function nestedProblems(root = ROOT) {
  const g = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true });
  if (g.status !== 0) return [];
  const out = [];
  for (const f of g.stdout.split('\0').filter(Boolean)) {
    const base = f.split('/').pop();
    if (!f.includes('/') || f.startsWith('.standards/') || !['ruff.toml', '.ruff.toml', 'pyproject.toml'].includes(base)) continue;
    let text;
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    const table = base === 'pyproject.toml' ? 'tool.ruff' : null;
    if (table && !/^\s*\[tool\.ruff(\.[^\]]*)?\]/m.test(text)) continue;
    if (extendValue(text, table) === null) out.push(`${f}: nested Ruff config without \`extend\` -- Ruff uses it instead of the root config, dropping the profile's rules (fix: add extend = "<relative path to the root ruff.toml>" or delete it)`);
  }
  return out;
}

// ---- uv project rules U1-U4 (spec--python-uv D-uv3): a minimal TOML scan, no parser ----

const SKIP_DIRS = new Set(['.git', '.venv', 'node_modules', '.standards']);
const UV_FORBIDDEN = (n) => ['poetry.lock', 'Pipfile', 'Pipfile.lock', 'setup.py', 'setup.cfg', 'environment.yml'].includes(n) || /^requirements.*\.txt$/.test(n);

function walkFiles(root, rel = '') {
  const out = [];
  let ents;
  try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...walkFiles(root, rel ? `${rel}/${e.name}` : e.name)); }
    else out.push(rel ? `${rel}/${e.name}` : e.name);
  }
  return out;
}

// Table headers present in a TOML text, e.g. Set{'project', 'tool.uv'} ([[x]] counts as x).
function tomlTables(text) {
  const t = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(raw);
    if (m) t.add(m[1].replace(/\s*\.\s*/g, '.'));
  }
  return t;
}

// `required-version = "==X.Y.Z"` in the given table (null = top level, for uv.toml).
function requiredVersion(text, table) {
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    const h = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (h) { current = h[1].replace(/\s*\.\s*/g, '.'); continue; }
    if (current !== table) continue;
    const m = /^required-version\s*=\s*["']([^"']*)["']$/.exec(line);
    if (m) return m[1];
  }
  return null;
}

const isProject = (text) => { const t = tomlTables(text); return t.has('project') || t.has('dependency-groups'); };

export function uvProblems(root = ROOT) {
  const files = walkFiles(root);
  const set = new Set(files);
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const out = [];
  // U1: a project pyproject.toml has a uv.lock beside it or in a uv-workspace root above it
  let anyProject = false;
  for (const f of files.filter((x) => x.split('/').pop() === 'pyproject.toml').sort()) {
    let text;
    try { text = read(f); } catch { continue; }
    if (!isProject(text)) continue;
    anyProject = true;
    const parts = f.split('/'); parts.pop();
    let ok = false;
    for (let n = parts.length; n >= 0 && !ok; n--) {
      const dir = parts.slice(0, n).join('/');
      const at = (name) => (dir ? `${dir}/${name}` : name);
      if (!set.has(at('uv.lock'))) continue;
      if (n === parts.length) ok = true;
      else { try { ok = set.has(at('pyproject.toml')) && tomlTables(read(at('pyproject.toml'))).has('tool.uv.workspace'); } catch { ok = false; } }
    }
    if (!ok) out.push(`${f}: U1 no uv.lock beside this project or in a uv-workspace root above it (fix: \`uv lock\` and commit uv.lock)`);
  }
  // U2: no other lock or requirements format
  for (const f of files.sort()) {
    const name = f.split('/').pop();
    if (!UV_FORBIDDEN(name)) continue;
    let head = '';
    try { head = read(f).split(/\r?\n/).slice(0, 3).join('\n'); } catch { /* unreadable: report it */ }
    const first = head.split('\n')[0];
    if (/^#\s*standards-allow\s+U2:\s*\S/.test(first)) continue;
    if (/^requirements.*\.txt$/.test(name) && /^#\s*This file was autogenerated by uv\b/m.test(head)) continue;
    out.push(`${f}: U2 not a uv project file (fix: manage dependencies in pyproject.toml + uv.lock; \`uv export\` for a generated requirements file; or make the first line "# standards-allow U2: <reason>")`);
  }
  // U3: root .python-version
  if (!set.has('.python-version')) out.push('.python-version: U3 missing at the repo root (fix: `uv python pin 3.12`)');
  else if (!/^3\.\d+(\.\d+)?$/.test(read('.python-version').trim())) out.push('.python-version: U3 must hold `3.N` or `3.N.M`');
  // U4: pinned uv, when the repo has a uv project
  if (anyProject) {
    const re = /^==\d+\.\d+\.\d+$/;
    let v = null;
    if (set.has('pyproject.toml')) v = requiredVersion(read('pyproject.toml'), 'tool.uv');
    if (v === null && set.has('uv.toml')) v = requiredVersion(read('uv.toml'), null);
    if (v === null) out.push('pyproject.toml: U4 no `[tool.uv] required-version = "==X.Y.Z"` (or root uv.toml `required-version`) (fix: pin the uv version CI uses)');
    else if (!re.test(v)) out.push(`pyproject.toml: U4 required-version "${v}" is not an exact "==X.Y.Z" pin`);
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  if (cmd === 'uv') {
    const p = uvProblems(ROOT);
    for (const l of p) console.log(`standards: FAIL [${TAG}/uv] ${l}`);
    if (!p.length) console.log(`standards: [${TAG}/uv] uv project files ok (U1-U4)`);
    return p.length ? 1 : 0;
  }
  if (cmd === 'config') {
    const p = [...configProblems(ROOT), ...nestedProblems(ROOT)];
    for (const l of p) console.log(`standards: FAIL [${TAG}/config] ${l}`);
    if (!p.length) console.log(`standards: [${TAG}/config] Ruff config extends ${EXTEND}`);
    return p.length ? 1 : 0;
  }
  if (cmd === 'ruff') {
    const p = [...configProblems(ROOT), ...nestedProblems(ROOT)];
    if (p.length) { for (const l of p) console.log(`standards: FAIL [${TAG}/config] ${l}`); return 1; }
    const t = await ensureRuff();
    if (t.error) { console.log(`standards: FAIL [${TAG}/ruff] ${t.error}`); return 1; }
    const r = spawnSync(t.bin, rest, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
    if (r.error) { console.log(`standards: FAIL [${TAG}/ruff] could not start ${t.bin}: ${r.error.message}`); return 1; }
    return r.status ?? 1;
  }
  console.log('usage: tool.mjs config | uv | ruff <args...>');
  return 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await main();
