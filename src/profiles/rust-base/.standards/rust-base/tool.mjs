#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile rust-base); do not edit -- re-run sync.
// Zero dependencies, no shell. Runs cargo under the exact pinned Rust toolchain (check.json "tools".rust).
//
//   node .standards/rust-base/tool.mjs cargo <cargo args...>   # e.g. fmt --all --check -- --config-path ...
//
// With rustup (preinstalled on GitHub-hosted runners): installs `<pin>` once (minimal profile + clippy +
// rustfmt) and runs `cargo +<pin> ...`, whatever the repo's rust-toolchain.toml or the runner default says.
// The installed toolchain keeps the host triple of the toolchain already in use (a windows-gnu dev box stays gnu).
// Without rustup (some self-hosted runners): the active `rustc` must already be exactly the pin, else it fails
// and names the install step.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TAG = 'rust-base';

const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
  return { code: r.error ? -1 : r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
};

export const readPin = (dir = HERE) => JSON.parse(fs.readFileSync(path.join(dir, 'check.json'), 'utf8')).tools.rust;

// `host: x86_64-pc-windows-gnu` from `rustc -vV`, or null when no rustc is on PATH.
export function hostTriple(cwd = ROOT) {
  const r = sh('rustc', ['-vV'], { cwd });
  const m = r.code === 0 ? /^host: (\S+)$/m.exec(r.out) : null;
  return m ? m[1] : null;
}

// Returns { prefix: [] | ['+<toolchain>'] } or { error }.
export function ensureToolchain(pin, cwd = ROOT) {
  const hasRustup = sh('rustup', ['--version'], { cwd }).code === 0;
  if (!hasRustup) {
    const v = sh('rustc', ['-V'], { cwd });
    if (v.code !== 0) return { error: `no rustup and no rustc on PATH (fix: install Rust ${pin}, e.g. dtolnay/rust-toolchain@${pin} with components clippy, rustfmt)` };
    if (!new RegExp(`^rustc ${pin.replaceAll('.', '\\.')} `).test(v.out)) return { error: `rustc is "${v.out.trim()}", the profile pins ${pin} (fix: install exactly Rust ${pin} with components clippy, rustfmt)` };
    return { prefix: [] };
  }
  const host = hostTriple(cwd);
  const name = host ? `${pin}-${host}` : pin;
  const have = (c) => sh('cargo', [`+${name}`, c, '--version'], { cwd }).code === 0;
  if (!(have('clippy') && have('fmt'))) {
    console.log(`standards: [${TAG}] installing Rust ${name} (minimal, clippy, rustfmt)`);
    const r = sh('rustup', ['toolchain', 'install', name, '--profile', 'minimal', '-c', 'clippy', '-c', 'rustfmt', '--no-self-update'], { cwd });
    if (r.code !== 0) return { error: `rustup toolchain install ${name} failed:\n${r.out}` };
  }
  return { prefix: [`+${name}`] };
}

export function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  if (cmd !== 'cargo' || rest.length === 0) {
    console.log('usage: tool.mjs cargo <cargo args...>');
    return 2;
  }
  const t = ensureToolchain(readPin());
  if (t.error) { console.log(`standards: FAIL [${TAG}] ${t.error}`); return 1; }
  const r = spawnSync('cargo', [...t.prefix, ...rest], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  if (r.error) { console.log(`standards: FAIL [${TAG}] could not start cargo: ${r.error.message}`); return 1; }
  return r.status ?? 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main();
