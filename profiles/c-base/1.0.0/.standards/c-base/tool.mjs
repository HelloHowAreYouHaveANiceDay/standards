#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile c-base); do not edit -- re-run sync.
// Zero dependencies, no shell, no npx/pip/uv. Installs the exact-pinned clang-format from its official PyPI wheel
// (sha256-verified, extracted by the built-in zip reader below) into the standards cache, then checks formatting.
//
//   node .standards/c-base/tool.mjs format    # clang-format --dry-run --Werror over the repo's own C/C++ files
//   node .standards/c-base/tool.mjs files     # print the files the gate checks (debugging)
//   node .standards/c-base/tool.mjs bin       # print the verified clang-format path
//
// Own files = git-tracked (or untracked, not ignored) files with a C/C++ extension, minus whatever the
// follower-owned `.clang-format-ignore` excludes (clang-format's native ignore file; put vendored code there).
// Pins (version + wheel sha256 per platform) live in .standards/c-base/check.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TAG = 'c-base';
export const EXT = /\.(c|h|cc|cpp|cxx|c\+\+|hh|hpp|hxx|h\+\+|ipp|inl|tpp)$/i;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const posix = (p) => p.split(path.sep).join('/');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const fail = (what) => console.log(`standards: FAIL [${TAG}] ${what}`);

function cacheDir() {
  if (process.env.STANDARDS_CACHE) return process.env.STANDARDS_CACHE;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'standards', 'cache');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'standards');
}

// Key into check.json "wheels" for this host.
export function platformKey(p = process.platform, arch = process.arch, glibc = hasGlibc()) {
  if (p === 'win32') return arch === 'arm64' ? 'win-arm64' : arch === 'ia32' ? 'win-x86' : 'win-x64';
  if (p === 'darwin') return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  if (p === 'linux') return `${glibc ? 'linux' : 'linux-musl'}-${arch === 'x64' ? 'x64' : arch}`;
  return `${p}-${arch}`;
}
function hasGlibc() {
  try { return Boolean(process.report.getReport().header.glibcVersionRuntime); } catch { return true; }
}

// ---- minimal zip reader (central directory; stored + deflate) ----
export function unzip(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (!wanted(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    if (method === 0) return { name, data: Buffer.from(raw) };
    if (method === 8) return { name, data: zlib.inflateRawSync(raw) };
    throw new Error(`unsupported zip method ${method} for ${name}`);
  }
  return null;
}

// Verified clang-format binary path, or { error }. Downloads the pinned wheel on first use.
export async function ensureClangFormat(fragment = readJson(path.join(HERE, 'check.json'))) {
  const version = fragment.tools['clang-format'];
  const key = platformKey();
  const wheel = fragment.wheels && fragment.wheels[key];
  if (!wheel) return { error: `no pinned clang-format ${version} wheel for ${key} (supported: ${Object.keys(fragment.wheels || {}).join(', ')})` };
  const exe = process.platform === 'win32' ? 'clang-format.exe' : 'clang-format';
  const dir = path.join(cacheDir(), 'clang-format', version, key);
  const bin = path.join(dir, exe);
  const stamp = path.join(dir, `${exe}.sha256`);
  const cached = () => fs.existsSync(bin) && fs.existsSync(stamp) && sha256(fs.readFileSync(bin)) === fs.readFileSync(stamp, 'utf8').trim();
  if (!cached()) {
    console.log(`standards: [${TAG}] installing clang-format ${version} (${wheel.file}) into ${dir}`);
    let buf;
    try {
      const res = await fetch(wheel.url);
      if (!res.ok) return { error: `download ${wheel.url}: HTTP ${res.status}` };
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) { return { error: `download ${wheel.url}: ${e.message}` }; }
    const got = sha256(buf);
    if (got !== wheel.sha256) return { error: `${wheel.file}: sha256 ${got} != pinned ${wheel.sha256} (refusing to install)` };
    const hit = unzip(buf, (n) => /(^|\/)data\/bin\/clang-format(\.exe)?$/.test(n));
    if (!hit) return { error: `${wheel.file}: no data/bin/clang-format inside` };
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${bin}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, hit.data, { mode: 0o755 });
    fs.renameSync(tmp, bin);
    fs.writeFileSync(stamp, `${sha256(hit.data)}\n`);
  }
  if (!cached()) return { error: `${bin}: does not match its recorded sha256 (delete ${dir} and re-run)` };
  const v = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (v.error || v.status !== 0) return { error: `${bin} --version failed: ${v.error ? v.error.message : v.stderr}` };
  if (!new RegExp(`clang-format version ${version.replace(/\./g, '\\.')}(\\D|$)`).test(v.stdout)) return { error: `${bin} reports "${v.stdout.trim()}", expected ${version}` };
  return { bin };
}

// `.clang-format-ignore` (clang-format's own file, repo root): one glob per line, `#` comments, matched against the
// repo-relative path. `*` and `?` do not cross `/`, `**` does (`**/` also matches no directory), a leading `./` is
// optional, a trailing-slash directory name matches nothing. Mirrors clang-format 23.1.5 (checked against the binary);
// this runner needs it to skip the same files for the `clang-format off` marker check.
export function ignoreMatchers(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((g) => {
    let re = '';
    const s = g.replace(/^\.\//, '');
    for (let i = 0; i < s.length; i++) {
      if (s.startsWith('**/', i)) { re += '(?:.*/)?'; i += 2; } else if (s.startsWith('**', i)) { re += '.*'; i += 1; } else if (s[i] === '*') re += '[^/]*';
      else if (s[i] === '?') re += '[^/]';
      else re += s[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`);
  });
}

// Own C/C++ files, repo-relative posix paths (git-listed so build dirs / .gitignore'd files never count).
export function sourceFiles(root = ROOT) {
  let ignored = [];
  try { ignored = ignoreMatchers(fs.readFileSync(path.join(root, '.clang-format-ignore'), 'utf8')); } catch { /* none */ }
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.error || r.status !== 0) return { error: `git ls-files failed: ${r.error ? r.error.message : r.stderr.trim()}` };
  const files = [...new Set(r.stdout.split('\0').filter(Boolean))]
    .filter((f) => EXT.test(f) && !f.startsWith('.standards/') && !ignored.some((re) => re.test(f)) && fs.existsSync(path.join(root, f)))
    .sort();
  return { files };
}

// `// clang-format off` needs a reason (`// clang-format off: <why>`) and a matching `on`; either gap silently
// disables formatting for the rest of the file.
export function markerProblems(text) {
  const out = [];
  let open = 0;
  text.split(/\r?\n/).forEach((line, i) => {
    const off = /(?:\/\/|\/\*)\s*clang-format\s+off\b(.*)$/.exec(line);
    if (off) {
      if (!/^\s*:\s*\S/.test(off[1].replace(/\*\/\s*$/, ''))) out.push(`${i + 1}: \`clang-format off\` needs a reason: \`// clang-format off: <why>\``);
      if (!open) open = i + 1;
    } else if (/(?:\/\/|\/\*)\s*clang-format\s+on\b/.test(line)) open = 0;
  });
  if (open) out.push(`${open}: \`clang-format off\` is never switched back on`);
  return out;
}

async function format() {
  const { files, error } = sourceFiles();
  if (error) { fail(error); return 1; }
  if (!files.length) { console.log(`standards: [${TAG}] no C/C++ files -- nothing to check`); return 0; }
  const t = await ensureClangFormat();
  if (t.error) { fail(t.error); return 1; }
  let bad = 0;
  for (let i = 0; i < files.length; i += 100) {
    const chunk = files.slice(i, i + 100);
    const r = spawnSync(t.bin, ['--dry-run', '--Werror', '--style=file', ...chunk], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
    if (r.error) { fail(`could not start clang-format: ${r.error.message}`); return 1; }
    const out = (r.stdout || '') + (r.stderr || '');
    if (out) process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
    if (r.status !== 0) bad++;
  }
  for (const f of files) {
    for (const p of markerProblems(fs.readFileSync(path.join(ROOT, f), 'utf8'))) { console.log(`${f}:${p}`); bad++; }
  }
  if (bad) { fail('formatting findings above name file:line (fix: run the pinned clang-format with -i, or `node .standards/c-base/tool.mjs bin` for its path)'); return 1; }
  console.log(`standards: [${TAG}] ${files.length} file(s) formatted`);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd] = argv;
  if (cmd === 'format') return format();
  if (cmd === 'files') {
    const { files, error } = sourceFiles();
    if (error) { fail(error); return 1; }
    for (const f of files) console.log(f);
    return 0;
  }
  if (cmd === 'bin') {
    const t = await ensureClangFormat();
    if (t.error) { fail(t.error); return 1; }
    console.log(posix(t.bin));
    return 0;
  }
  console.log('usage: tool.mjs format | files | bin');
  return 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await main();
