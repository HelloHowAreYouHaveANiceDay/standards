#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile ts-base); do not edit -- re-run sync.
// Zero dependencies. Runs the follower's locally installed, exact-pinned Node tools without npx/shell
// (cross-platform: the bin's JS entry is run with this node).
//
//   node .standards/ts-base/tool.mjs pins                      # every pin: package.json spec == installed == pin
//   node .standards/ts-base/tool.mjs run <pkg>[:<bin>] [args]  # pins for <pkg>, then run its bin from node_modules
//
// Pins live in .standards/ts-base/check.json "tools". Fix lines name the exact npm command.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TAG = 'ts-base';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const pkgDir = (name) => path.join(ROOT, 'node_modules', ...name.split('/'));

export function pinProblems(root = ROOT, tools = readJson(path.join(HERE, 'check.json')).tools) {
  const out = [];
  let manifest = {};
  try { manifest = readJson(path.join(root, 'package.json')); } catch { out.push('package.json: unreadable'); return out; }
  const declared = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) };
  const fix = Object.entries(tools).map(([n, v]) => `${n}@${v}`).join(' ');
  for (const [name, pin] of Object.entries(tools)) {
    const spec = declared[name];
    if (spec === undefined) out.push(`package.json: ${name} is not a devDependency (fix: npm i -D -E ${fix})`);
    else if (spec !== pin) out.push(`package.json: ${name} is "${spec}", the profile pins exactly "${pin}" (fix: npm i -D -E ${name}@${pin})`);
    let installed = null;
    try { installed = readJson(path.join(root, 'node_modules', ...name.split('/'), 'package.json')).version; } catch { /* not installed */ }
    if (installed === null) out.push(`node_modules/${name}: not installed (fix: npm ci)`);
    else if (installed !== pin) out.push(`node_modules/${name}: installed ${installed} != pin ${pin} (fix: npm ci; if package-lock.json disagrees, npm i -D -E ${name}@${pin})`);
  }
  return out;
}

function binPath(name, bin) {
  const dir = pkgDir(name);
  const pj = readJson(path.join(dir, 'package.json'));
  const b = typeof pj.bin === 'string' ? pj.bin : (pj.bin || {})[bin || name.split('/').pop()];
  if (!b) throw new Error(`${name} has no bin ${bin || name}`);
  return path.join(dir, b);
}

export function main(argv = process.argv.slice(2)) {
  const [cmd, target, ...rest] = argv;
  const tools = readJson(path.join(HERE, 'check.json')).tools;
  if (cmd === 'pins') {
    const p = pinProblems(ROOT, tools);
    for (const l of p) console.log(`standards: FAIL [${TAG}/pins] ${l}`);
    if (!p.length) console.log(`standards: [${TAG}/pins] ${Object.keys(tools).length} tools at their pins`);
    return p.length ? 1 : 0;
  }
  if (cmd === 'run' && target) {
    const [name, bin] = target.split(/:(?=[^/]*$)/);
    if (!Object.hasOwn(tools, name)) { console.log(`standards: FAIL [${TAG}] ${name} is not a pinned tool`); return 1; }
    const p = pinProblems(ROOT, { [name]: tools[name] });
    if (p.length) { for (const l of p) console.log(`standards: FAIL [${TAG}/pins] ${l}`); return 1; }
    const r = spawnSync(process.execPath, [binPath(name, bin), ...rest], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
    if (r.error) { console.log(`standards: FAIL [${TAG}] could not start ${name}: ${r.error.message}`); return 1; }
    return r.status ?? 1;
  }
  console.log('usage: tool.mjs pins | run <pkg>[:<bin>] [args...]');
  return 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main();
