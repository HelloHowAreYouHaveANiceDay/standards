#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile gha-base); do not edit -- re-run sync.
// Zero dependencies, no shell, no Go/Python/npm needed. Installs the exact-pinned release binaries of actionlint,
// shellcheck and zizmor for this host (download -> sha256 check against the pin in check.json -> extract in-process
// -> cache) and runs one of them.
//
//   node .standards/gha-base/tool.mjs install                       # fetch + verify every pinned tool for this host
//   node .standards/gha-base/tool.mjs run <tool> [args...]          # install <tool> (and any tool named by a
//                                                                   # {tool} token in args), run it from the repo root
//   node .standards/gha-base/tool.mjs reasons                       # every zizmor-ignore / shellcheck-disable comment has a reason
//
// Pins live in .standards/gha-base/check.json "tools": { <name>: { version, assets: { <platform>: { url, sha256, member } } } }.
// Cache: $STANDARDS_CACHE, else %LOCALAPPDATA%\standards\cache (Windows) / $XDG_CACHE_HOME|~/.cache/standards, under gha-tools/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TAG = 'gha-base';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readPins = () => JSON.parse(fs.readFileSync(path.join(HERE, 'check.json'), 'utf8')).tools;
const platformKey = () => `${process.platform}-${process.arch}`;

function cacheDir() {
  if (process.env.STANDARDS_CACHE) return process.env.STANDARDS_CACHE;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'standards', 'cache');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'standards');
}

// ---- in-process archive readers (tar.gz and zip), returning one member's bytes ----

// The member whose path is `member` or ends in `/member` (archives wrap files in a versioned directory or not).
const matches = (name, member) => name === member || name.endsWith(`/${member}`);

export function tarGzMember(archive, member) {
  const tar = zlib.gunzipSync(archive);
  let longName = null;
  for (let off = 0; off + 512 <= tar.length;) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const cstr = (a, b) => { const s = h.subarray(a, b); const z = s.indexOf(0); return s.subarray(0, z < 0 ? s.length : z).toString('utf8'); };
    const size = parseInt(cstr(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    let name = cstr(0, 100);
    const prefix = cstr(345, 500);
    if (prefix) name = `${prefix}/${name}`;
    const body = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = body.toString('utf8').replace(/\0+$/, ''); continue; }
    if (type === 'x') { const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8')); if (m) longName = m[1]; continue; }
    if (longName) { name = longName; longName = null; }
    if ((type === '0' || type === '\0') && matches(name.replace(/^\.\//, ''), member)) return Buffer.from(body);
  }
  throw new Error(`${member} not found in the archive`);
}

export function zipMember(archive, member) {
  let eocd = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 22 - 65535); i--) {
    if (archive.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');
  const count = archive.readUInt16LE(eocd + 10);
  let p = archive.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (archive.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = archive.readUInt16LE(p + 10);
    const csize = archive.readUInt32LE(p + 20);
    const nlen = archive.readUInt16LE(p + 28);
    const xlen = archive.readUInt16LE(p + 30);
    const clen = archive.readUInt16LE(p + 32);
    const local = archive.readUInt32LE(p + 42);
    const name = archive.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (!matches(name, member)) continue;
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = archive.subarray(start, start + csize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return zlib.inflateRawSync(data);
    throw new Error(`unsupported zip compression method ${method}`);
  }
  throw new Error(`${member} not found in the archive`);
}

async function download(url) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  throw new Error(`download ${url} failed: ${last && last.message}`);
}

// Returns the absolute path of the pinned tool's binary for this host, installing it if needed.
export async function ensureTool(name, pins = readPins(), cache = cacheDir()) {
  const pin = pins[name];
  if (!pin) throw new Error(`${name} is not a pinned tool (known: ${Object.keys(pins).join(', ')})`);
  const key = platformKey();
  const asset = pin.assets[key];
  if (!asset) throw new Error(`${name} ${pin.version} has no pinned release for ${key} (pinned: ${Object.keys(pin.assets).join(', ')})`);
  const dir = path.join(cache, 'gha-tools', `${name}-${pin.version}-${key}`);
  const bin = path.join(dir, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  if (fs.existsSync(bin)) return bin;
  console.log(`${TAG}: installing ${name} ${pin.version} for ${key} into ${dir}`);
  const archive = await download(asset.url);
  const got = sha256(archive);
  if (got !== asset.sha256) throw new Error(`${name}: ${asset.url} sha256 ${got} != pinned ${asset.sha256} (refusing to install)`);
  const body = asset.url.endsWith('.zip') ? zipMember(archive, asset.member) : tarGzMember(archive, asset.member);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${bin}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o755 });
  fs.renameSync(tmp, bin);
  return bin;
}

// ---- suppression hygiene: neither tool can require a reason, so this does ----
// `# zizmor: ignore[rule] <reason>` and `# shellcheck disable=SCnnnn # <reason>` in .github/**/*.y(a)ml (and a root action.yml).
const REASON_MIN = 5;
function ymlFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ymlFiles(p, out);
    else if (/\.ya?ml$/.test(e.name)) out.push(p);
  }
  return out;
}

export function suppressionsWithoutReason(root) {
  const files = [...ymlFiles(path.join(root, '.github')), ...['action.yml', 'action.yaml'].map((f) => path.join(root, f)).filter((f) => fs.existsSync(f))];
  const bad = [];
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const z = /#\s*zizmor:\s*ignore\[[^\]]*\](.*)$/.exec(line);
      if (z && z[1].replace(/^[\s:#-]+/, '').trim().length < REASON_MIN) bad.push(`${rel}:${i + 1}: zizmor ignore without a reason (write "# zizmor: ignore[rule] why")`);
      const s = /#\s*shellcheck\s+disable=[\w,]+(.*)$/.exec(line);
      if (s && s[1].replace(/^[\s:#-]+/, '').trim().length < REASON_MIN) bad.push(`${rel}:${i + 1}: shellcheck disable without a reason (write "# shellcheck disable=SCnnnn # why")`);
    });
  }
  return bad;
}

// ---- zizmor config: the vendored pinning policy applies only when the follower brings no config of its own ----
// A follower-owned file (zizmor's native discovery locations) or an explicit --config / --no-config / ZIZMOR_CONFIG wins.
const FOLLOWER_ZIZMOR_CONFIGS = ['.github/zizmor.yml', '.github/zizmor.yaml', 'zizmor.yml', 'zizmor.yaml'];
export function zizmorConfigArgs(args = [], root = ROOT, env = process.env) {
  if (env.ZIZMOR_CONFIG || args.some((a) => a === '--no-config' || a === '-c' || a === '--config' || a.startsWith('--config='))) return [];
  if (FOLLOWER_ZIZMOR_CONFIGS.some((f) => fs.existsSync(path.join(root, f)))) return [];
  return [`--config=${path.join(HERE, 'zizmor.yml')}`];
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, target, ...rest] = argv;
  if (cmd === 'reasons') { // no tool needed: the pins are not read
    const bad = suppressionsWithoutReason(ROOT);
    for (const b of bad) console.log(`standards: FAIL [${TAG}/reasons] ${b}`);
    if (!bad.length) console.log(`${TAG}/reasons: every suppression carries a reason`);
    return bad.length ? 1 : 0;
  }
  let pins;
  try { pins = readPins(); } catch (e) { console.log(`standards: FAIL [${TAG}] check.json unreadable: ${e.message}`); return 1; }
  try {
    if (cmd === 'install') {
      for (const n of Object.keys(pins)) console.log(`${TAG}: ${n} ${pins[n].version} -> ${await ensureTool(n, pins)}`);
      return 0;
    }
    if (cmd === 'run' && target) {
      const bins = { [target]: await ensureTool(target, pins) };
      for (const a of rest) {
        for (const m of a.matchAll(/\{([a-z]+)\}/g)) if (!bins[m[1]]) bins[m[1]] = await ensureTool(m[1], pins);
      }
      const final = rest.map((a) => a.replace(/\{([a-z]+)\}/g, (_, n) => bins[n]));
      if (target === 'zizmor') final.unshift(...zizmorConfigArgs(final));
      const r = spawnSync(bins[target], final, { cwd: ROOT, stdio: 'inherit', windowsHide: true, timeout: 10 * 60 * 1000 });
      if (r.error) { console.log(`standards: FAIL [${TAG}/${target}] could not start ${bins[target]}: ${r.error.message}`); return 1; }
      return r.status ?? 1;
    }
  } catch (e) {
    console.log(`standards: FAIL [${TAG}/${target || cmd}] ${e.message}`);
    return 1;
  }
  console.log('usage: tool.mjs install | run <tool> [args...]');
  return 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await main();
