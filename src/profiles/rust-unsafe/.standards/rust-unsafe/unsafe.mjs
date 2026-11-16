#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile rust-unsafe); do not edit -- re-run sync.
// Zero dependencies, no shell. Fail-closed unsafe-Rust gate on top of rust-base (its pinned toolchain and runner).
//
//   node .standards/rust-unsafe/unsafe.mjs check [--json]   # RU1-RU4 (the gate; check.mjs runs this)
//   node .standards/rust-unsafe/unsafe.mjs miri  [--json]   # RU5: `cargo +<nightly> miri test` per allowlisted package
//
// Every failure line: `standards: FAIL [rust-unsafe/RUn] <file:line or package> <message>`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BASE_DIR = path.join(ROOT, '.standards', 'rust-base');
const ALLOW_FILE = 'rust-unsafe.allow.json';
const TAG = 'rust-unsafe';

// D1: blocking lints (command-line levels, like rust-base).
export const D1_LINTS = [
  'clippy::undocumented_unsafe_blocks',
  'clippy::missing_safety_doc',
  'unsafe_op_in_unsafe_fn',
  'clippy::multiple_unsafe_ops_per_block',
  'clippy::unnecessary_safety_comment',
  'clippy::unnecessary_safety_doc',
];
const D1_SHORT = new Set(D1_LINTS.map((l) => l.replace(/^clippy::/, '')));
const RU2_CODES = new Set(['unsafe_code', 'E0453']);

const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024, ...opts });
  return { code: r.error ? -1 : r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', stderr: r.stderr || '' };
};
const posix = (p) => p.split(path.sep).join('/');
const fail = (rule, where, msg) => `standards: FAIL [${TAG}/${rule}] ${where}: ${msg}`;

export const readNightly = (dir = HERE) => JSON.parse(fs.readFileSync(path.join(dir, 'check.json'), 'utf8')).tools.nightly;

// The rust-base runner module (its exports are import-safe: main only runs when it is the entry point).
async function loadBase() {
  return import(pathToFileURL(path.join(BASE_DIR, 'tool.mjs')).href);
}

// Parse and validate the follower-owned allowlist. Returns { allow: {pkg: {reason, miri?}}, problems: [..] }.
export function readAllow(root = ROOT) {
  const file = path.join(root, ALLOW_FILE);
  if (!fs.existsSync(file)) return { allow: {}, problems: [] };
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { allow: {}, problems: [`${ALLOW_FILE}: not valid JSON (${e.message})`] }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { allow: {}, problems: [`${ALLOW_FILE}: must be an object keyed by cargo package name`] };
  const problems = [];
  for (const [k, v] of Object.entries(j)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { problems.push(`${ALLOW_FILE}: "${k}" must be an object {"reason": "..."}`); continue; }
    if (typeof v.reason !== 'string' || v.reason.trim() === '') problems.push(`${ALLOW_FILE}: "${k}" has an empty or missing reason`);
    if ('miri' in v && v.miri !== 'ffi-only') problems.push(`${ALLOW_FILE}: "${k}" miri must be "ffi-only" or absent`);
    const extra = Object.keys(v).filter((x) => x !== 'reason' && x !== 'miri');
    if (extra.length) problems.push(`${ALLOW_FILE}: "${k}" has unknown field(s) ${extra.join(', ')}`);
  }
  return { allow: j, problems };
}

function members(prefix, root = ROOT) {
  const r = sh('cargo', [...prefix, 'metadata', '--no-deps', '--format-version', '1'], { cwd: root });
  if (r.code !== 0) return { error: `cargo metadata failed:\n${r.stderr || r.out}` };
  try { return { names: JSON.parse(r.stdout).packages.map((p) => p.name) }; } catch (e) { return { error: `cargo metadata output unreadable: ${e.message}` }; }
}

// Turn cargo's JSON diagnostics into FAIL lines + rendered diagnostics. `classify(code) -> rule|null`.
function reportDiagnostics(out, classify, seen) {
  const lines = [];
  const other = [];
  for (const raw of out.split(/\r?\n/)) {
    if (!raw.startsWith('{')) { if (raw.trim()) other.push(raw); continue; }
    let m;
    try { m = JSON.parse(raw); } catch { other.push(raw); continue; }
    if (m.reason !== 'compiler-message' || !m.message) continue;
    const d = m.message;
    if (d.level !== 'error' && d.level !== 'error: internal compiler error') continue;
    if (/^aborting due to|^could not compile/.test(d.message)) continue;
    const code = d.code && d.code.code ? d.code.code : '';
    const sp = (d.spans || []).find((s) => s.is_primary) || (d.spans || [])[0];
    const where = sp ? `${posix(sp.file_name)}:${sp.line_start}` : (m.package_id || 'workspace').split(/[#@ ]/)[0];
    const rule = classify(code, d) || 'build';
    const key = `${rule}|${where}|${code}|${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (d.rendered) process.stdout.write(d.rendered.endsWith('\n') ? d.rendered : `${d.rendered}\n`);
    lines.push(fail(rule === 'build' ? 'build' : rule, where, `${code ? `${code}: ` : ''}${d.message}`));
  }
  return { lines, other };
}

function clippyArgs(pkgArgs, unsafeCodeForbidden) {
  return [
    'clippy', '--locked', '--all-targets', '--all-features', '--message-format=json', ...pkgArgs,
    '--', '-A', 'warnings',
    ...(unsafeCodeForbidden ? ['-F', 'unsafe_code'] : []),
    ...D1_LINTS.flatMap((l) => ['-D', l]),
  ];
}

export async function check({ root = ROOT, log = console.log } = {}) {
  const failures = [];
  const ru1 = (what) => failures.push(fail('RU1', '.standards/rust-base/check.json', what));
  if (!fs.existsSync(path.join(BASE_DIR, 'check.json'))) {
    ru1('rust-base is not vendored; rust-unsafe needs its pinned toolchain and runner (sync rust-base next to rust-unsafe)');
    return failures;
  }
  const { allow, problems } = readAllow(root);
  for (const p of problems) failures.push(fail('RU1', ALLOW_FILE, p.replace(`${ALLOW_FILE}: `, '')));
  const base = await loadBase();
  const t = base.ensureToolchain(base.readPin(BASE_DIR), root);
  if (t.error) { failures.push(fail('RU1', 'toolchain', t.error)); return failures; }
  const m = members(t.prefix, root);
  if (m.error) { failures.push(fail('RU1', 'Cargo.toml', m.error)); return failures; }
  const allowed = Object.keys(allow);
  for (const k of allowed) if (!m.names.includes(k)) failures.push(fail('RU1', ALLOW_FILE, `"${k}" is not a package in this workspace (cargo metadata --no-deps lists: ${m.names.join(', ')})`));
  if (failures.length) return failures;
  const guarded = m.names.filter((n) => !allowed.includes(n));
  const seen = new Set();
  const run = (label, pkgArgs, forbid, classify) => {
    log(`standards: [${TAG}] ${label}: cargo ${clippyArgs(pkgArgs, forbid).filter((a) => a !== '--message-format=json').join(' ')}`);
    const r = sh('cargo', [...t.prefix, ...clippyArgs(pkgArgs, forbid)], { cwd: root });
    const rep = reportDiagnostics(r.stdout, classify, seen);
    failures.push(...rep.lines);
    if (r.code !== 0 && rep.lines.length === 0) failures.push(fail('build', label, `cargo exited ${r.code}\n${r.stderr || rep.other.join('\n')}`));
  };
  if (guarded.length) {
    run('run A (not allowlisted, unsafe_code forbidden)', ['--workspace', ...allowed.flatMap((a) => ['--exclude', a])], true,
      (code) => (RU2_CODES.has(code) ? 'RU2' : D1_SHORT.has(code.replace(/^clippy::/, '')) ? 'RU3' : null));
  } else log(`standards: [${TAG}] run A skipped: every package is allowlisted`);
  if (allowed.length) {
    run('run B (allowlisted, unsafe documented)', allowed.flatMap((a) => ['-p', a]), false,
      (code) => (D1_SHORT.has(code.replace(/^clippy::/, '')) ? 'RU3' : null));
  } else log(`standards: [${TAG}] run B skipped: empty allowlist`);
  // RU4: an allowlist needs a CI file that runs the miri verb.
  if (allowed.length) {
    const ls = sh('git', ['ls-files', '-z', '--', '.github/workflows', 'ci', '.ci'], { cwd: root });
    const files = ls.stdout.split('\0').filter((f) => f && fs.existsSync(path.join(root, f)));
    const re = /\.standards\/rust-unsafe\/unsafe\.mjs["',\s\]\[]+miri\b/;
    if (!files.some((f) => re.test(fs.readFileSync(path.join(root, f), 'utf8')))) {
      failures.push(fail('RU4', '.github/workflows|ci|.ci', `${ALLOW_FILE} is non-empty but no tracked CI file runs \`node .standards/rust-unsafe/unsafe.mjs miri\``));
    }
  }
  return failures;
}

function ensureMiri(nightly, cwd, log) {
  const hostOut = sh('rustc', ['-vV'], { cwd }).out;
  const host = (/^host: (\S+)$/m.exec(hostOut) || [])[1];
  const name = host ? `${nightly}-${host}` : nightly;
  const have = sh('cargo', [`+${name}`, 'miri', '--version'], { cwd }).code === 0;
  if (!have) {
    log(`standards: [${TAG}] installing ${name} (minimal, miri, rust-src)`);
    const r = sh('rustup', ['toolchain', 'install', name, '--profile', 'minimal', '-c', 'miri', '-c', 'rust-src', '--no-self-update'], { cwd });
    if (r.code !== 0) return { error: `rustup toolchain install ${name} failed:\n${r.out}` };
  }
  const s = sh('cargo', [`+${name}`, 'miri', 'setup'], { cwd });
  if (s.code !== 0) return { error: `cargo +${name} miri setup failed:\n${s.out}` };
  return { prefix: `+${name}` };
}

export async function miri({ root = ROOT, log = console.log } = {}) {
  const failures = [];
  const { allow, problems } = readAllow(root);
  for (const p of problems) failures.push(fail('RU1', ALLOW_FILE, p.replace(`${ALLOW_FILE}: `, '')));
  if (failures.length) return failures;
  const pkgs = Object.keys(allow);
  if (pkgs.length === 0) { log(`standards: [${TAG}] miri: empty allowlist, nothing to run`); return failures; }
  const mi = ensureMiri(readNightly(), root, log);
  if (mi.error) return [fail('RU5', 'toolchain', mi.error)];
  for (const pkg of pkgs) {
    log(`standards: [${TAG}] cargo ${mi.prefix} miri test --locked -p ${pkg}`);
    const r = sh('cargo', [mi.prefix, 'miri', 'test', '--locked', '-p', pkg], { cwd: root });
    process.stdout.write(r.out.endsWith('\n') ? r.out : `${r.out}\n`);
    if (r.code !== 0) { failures.push(fail('RU5', pkg, `miri test exited ${r.code} (findings above)`)); continue; }
    let passed = 0;
    for (const m of r.out.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/g)) passed += Number(m[1]);
    log(`standards: [${TAG}] ${pkg}: ${passed} test(s) executed under miri${allow[pkg].miri === 'ffi-only' ? ' (ffi-only: zero allowed)' : ''}`);
    if (passed === 0 && allow[pkg].miri !== 'ffi-only') {
      failures.push(fail('RU5', pkg, 'miri executed 0 tests; add a Miri-runnable test or mark the entry "miri": "ffi-only" with a reason'));
    }
  }
  return failures;
}

export async function main(argv = process.argv.slice(2)) {
  const [verb, ...flags] = argv;
  const json = flags.includes('--json');
  if (verb !== 'check' && verb !== 'miri') {
    console.log('usage: unsafe.mjs check|miri [--json]');
    return 2;
  }
  const log = json ? (s) => process.stderr.write(`${s}\n`) : console.log;
  const failures = await (verb === 'check' ? check({ log }) : miri({ log }));
  if (json) console.log(JSON.stringify(failures.length ? { ok: false, error: { code: 'findings', message: `${failures.length} failure(s)`, failures } } : { ok: true, result: { verb, failures: [] } }));
  else {
    for (const f of failures) console.log(f);
    console.log(failures.length ? `standards: [${TAG}] ${failures.length} failure(s)` : `standards: [${TAG}] ${verb} OK`);
  }
  return failures.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await main();
