#!/usr/bin/env node
// Standards sync (kit side; never vendored, never run in CI). Kit-bump shape, looped over profiles:
// fetch raw bytes, verify every sha256 in memory, write nothing unless everything checks out.
//
//   node <kit>/sync.mjs init base@1.0.0 go-strict@1.0.0   # new follower: manifest, copies, locks, AGENTS line
//   node <kit>/sync.mjs sync                               # idempotent re-sync from .standards.json
//   node <kit>/sync.mjs bump <profile> [--major]           # newest within the major (or across with --major)
//
// Options: --kit <https-url | file:///path | path>  fetch from here instead of .standards.json's "kit"
//          --root <dir>                              follower root (default: cwd)
//
// Writes, per profile: the kit files byte for byte (LF as released), the kit's SHA256SUMS verbatim as the lock
// `.standards/<name>.SHA256SUMS`. Go: `.golangci.local.yml` (follower-owned) is merged into the profile's config
// and written to `.golangci.yml` with a generated header; its sha goes to `.standards/generated.SHA256SUMS`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_KIT = 'https://raw.githubusercontent.com/HelloHowAreYouHaveANiceDay/standards/main';
export const AGENTS_LINE = 'Standards gate: `node .standards/check.mjs`; rules in `.standards/RULES.md`.';
export const CI_SNIPPET = `  # runs-on and setup steps (e.g. actions/setup-go for Go profiles): copy them from this repo's build job
  standards:
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }      # full history for golangci --new-from-merge-base=origin/main
      - run: node .standards/check.mjs
        # working-directory: <subdir>  # only where the repo checks out to a subpath
`;

const SUMS_RE = /^([0-9a-f]{64}) {2}(\S(?:.*\S)?)$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const VER_RE = /^\d+\.\d+\.\d+$/;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function cmpSemver(a, b) {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function parseSums(text, label) {
  const sums = new Map();
  text.split('\n').forEach((line, i) => {
    if (line === '') return;
    const m = SUMS_RE.exec(line);
    if (!m) throw new Error(`${label}:${i + 1}: not a "<sha256>  <path>" line`);
    sums.set(m[2], m[1]);
  });
  return sums;
}

function safeRel(p) {
  return typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.includes('\\') && !/^[A-Za-z]:/.test(p)
    && !p.split('/').some((s) => s === '' || s === '.' || s === '..');
}

// Paths a profile may not write: the manifest, any lock, and other profiles' .standards/<dir>/.
function reservedReason(name, p) {
  if (p === '.standards.json') return 'the follower manifest';
  if (/^\.standards\/[^/]+\.SHA256SUMS$/.test(p)) return 'a lock file';
  const m = /^\.standards\/([^/]+)\//.exec(p);
  if (m && m[1] !== name) return `another profile's directory .standards/${m[1]}/`;
  return null;
}

// -------------------------------------------------------------------- kit source
export function kitSource(spec) {
  if (/^https?:\/\//.test(spec)) {
    const base = spec.replace(/\/+$/, '');
    return {
      label: base,
      async get(rel) {
        const url = `${base}/${rel}`;
        const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
        if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      },
    };
  }
  const dir = spec.startsWith('file:') ? fileURLToPath(spec) : path.resolve(spec);
  return {
    label: dir,
    async get(rel) {
      const f = path.join(dir, ...rel.split('/'));
      if (!fs.existsSync(f)) throw new Error(`${rel}: not found in kit ${dir}`);
      return fs.readFileSync(f);
    },
  };
}

// -------------------------------------------------------------------- golangci merge
let YAML;
async function yamlLib() {
  if (!YAML) {
    try { YAML = await import('yaml'); } catch { throw new Error('the golangci merge needs the kit\'s npm deps: run `npm ci` in the kit clone'); }
  }
  return YAML;
}

const keyOf = (k) => (k && typeof k === 'object' && 'value' in k ? String(k.value) : String(k));

// Lists append, maps merge key by key, scalars (and type changes) replace. No remove operator.
function mergeNode(Y, a, b) {
  if (Y.isMap(a) && Y.isMap(b)) {
    for (const pair of b.items) {
      const hit = a.items.find((p) => keyOf(p.key) === keyOf(pair.key));
      if (hit) hit.value = mergeNode(Y, hit.value, pair.value);
      else a.items.push(pair);
    }
    return a;
  }
  if (Y.isSeq(a) && Y.isSeq(b)) { a.items.push(...b.items); return a; }
  return b;
}

export async function mergeGolangci({ profile, version, fromRel, fromBuf, overlayRel, overlayBuf }) {
  const Y = await yamlLib();
  const parse = (buf, label) => {
    const doc = Y.parseDocument(buf.toString('utf8'));
    if (doc.errors.length) throw new Error(`${label}: invalid YAML: ${doc.errors[0].message}`);
    return doc;
  };
  const doc = parse(fromBuf, fromRel);
  if (overlayBuf) {
    const over = parse(overlayBuf, overlayRel);
    if (over.contents !== null && over.contents !== undefined) {
      if (!Y.isMap(over.contents)) throw new Error(`${overlayRel}: top level must be a mapping`);
      doc.contents = mergeNode(Y, doc.contents, over.contents);
    }
  }
  const header = [
    '# GENERATED by HelloHowAreYouHaveANiceDay/standards sync.mjs -- do not edit (check.mjs fails on any hand edit).',
    `# profile: ${profile}@${version} (${fromRel})`,
    `# overlay: ${overlayRel} ${overlayBuf ? `sha256:${sha256(overlayBuf)}` : 'none'}`,
    `# Overrides: edit ${overlayRel} (lists append, scalars replace; a reason comment on each), then re-run sync.`,
    '',
    '',
  ].join('\n');
  const body = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\r\n/g, '\n');
  return Buffer.from(header + body, 'utf8');
}

// -------------------------------------------------------------------- plan (fetch + verify, no writes)
function lockedVersion(root, name, lockBuf) {
  // The lock lists .standards/<name>/check.json, whose "version" says which release the lock is for.
  try {
    const sums = parseSums(lockBuf.toString('utf8'), 'lock');
    const rel = `.standards/${name}/check.json`;
    const buf = fs.readFileSync(path.join(root, ...rel.split('/')));
    if (sha256(buf) !== sums.get(rel)) return null;
    return JSON.parse(buf.toString('utf8')).version;
  } catch { return null; }
}

export async function plan(root, manifest, src) {
  const profiles = manifest.profiles || {};
  if (!Object.hasOwn(profiles, 'base')) throw new Error('every follower needs the base profile (it vendors .standards/check.mjs): add base@<x.y.z>');
  const files = new Map(); // rel -> Buffer
  const owner = new Map(); // rel -> profile
  const locks = new Map(); // name -> Buffer (kit SHA256SUMS, verbatim)
  const gens = []; // {profile, version, spec}
  const claim = (p, name) => {
    if (owner.has(p) && owner.get(p) !== name) throw new Error(`${owner.get(p)} and ${name} both write ${p}; pick one profile per language`);
    owner.set(p, name);
  };
  for (const [name, version] of Object.entries(profiles)) {
    if (!NAME_RE.test(name)) throw new Error(`bad profile name ${JSON.stringify(name)}`);
    if (!VER_RE.test(String(version))) throw new Error(`${name}: version is not x.y.z: ${JSON.stringify(version)}`);
    const sumsRel = `profiles/${name}/${version}/SHA256SUMS`;
    const sumsBuf = await src.get(sumsRel);
    const sums = parseSums(sumsBuf.toString('utf8'), `${name}@${version} SHA256SUMS`);
    for (const p of sums.keys()) {
      if (!safeRel(p)) throw new Error(`${name}@${version}: unsafe path in SHA256SUMS: ${JSON.stringify(p)}`);
      const why = reservedReason(name, p);
      if (why) throw new Error(`${name}@${version}: ${p} would overwrite ${why}`);
      claim(p, name);
    }
    const fragRel = `.standards/${name}/check.json`;
    if (!sums.has(fragRel)) throw new Error(`${name}@${version}: SHA256SUMS does not list ${fragRel}`);
    const lockAbs = path.join(root, '.standards', `${name}.SHA256SUMS`);
    if (fs.existsSync(lockAbs)) {
      const lockBuf = fs.readFileSync(lockAbs);
      if (lockedVersion(root, name, lockBuf) === version && !lockBuf.equals(sumsBuf)) {
        throw new Error(`${name}@${version}: the kit's SHA256SUMS now differ from the lock .standards/${name}.SHA256SUMS -- released versions are immutable, so this means tampering; refusing`);
      }
    }
    const bad = [];
    for (const [p, want] of sums) {
      const buf = await src.get(`profiles/${name}/${version}/${p}`);
      const got = sha256(buf);
      if (got !== want) bad.push(`${name}@${version} ${p}: sha256 ${got} != SHA256SUMS ${want}`);
      else files.set(p, buf);
    }
    if (bad.length) throw new Error(bad.join('\n'));
    const fragment = JSON.parse(files.get(fragRel).toString('utf8'));
    if (fragment.profile !== name || fragment.version !== version) throw new Error(`${name}@${version}: ${fragRel} says ${fragment.profile}@${fragment.version}`);
    locks.set(name, sumsBuf);
    for (const g of fragment.generate || []) {
      if (g.kind !== 'golangci-merge') throw new Error(`${name}@${version}: unknown generate kind ${g.kind}`);
      for (const p of [g.to, g.overlay]) if (!safeRel(p) || p.startsWith('.standards/')) throw new Error(`${name}@${version}: bad generate path ${p}`);
      if (!files.has(g.from)) throw new Error(`${name}@${version}: generate source ${g.from} is not in the profile`);
      claim(g.to, name);
      gens.push({ profile: name, version, spec: g });
    }
  }
  for (const { spec } of gens) if (owner.has(spec.overlay)) throw new Error(`${owner.get(spec.overlay)} writes ${spec.overlay}, which is a follower-owned overlay`);
  const generated = new Map();
  for (const { profile, version, spec } of gens) {
    const oAbs = path.join(root, ...spec.overlay.split('/'));
    const overlayBuf = fs.existsSync(oAbs) ? fs.readFileSync(oAbs) : null;
    generated.set(spec.to, await mergeGolangci({ profile, version, fromRel: spec.from, fromBuf: files.get(spec.from), overlayRel: spec.overlay, overlayBuf }));
  }
  return { files, locks, generated };
}

// -------------------------------------------------------------------- apply (writes)
function writeIfChanged(abs, buf) {
  if (fs.existsSync(abs) && fs.readFileSync(abs).equals(buf)) return false;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return true;
}

function removeEmptyDirs(dir, stop) {
  while (dir.startsWith(stop) && dir !== stop && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
}

export function apply(root, p, manifest) {
  const abs = (rel) => path.join(root, ...rel.split('/'));
  const std = path.join(root, '.standards');
  const keep = new Set([...p.files.keys(), ...p.generated.keys()]);
  const removed = [];
  // stale: files of old locks (bumped or dropped profiles) and old generated outputs
  const oldLocks = fs.existsSync(std) ? fs.readdirSync(std).filter((f) => f.endsWith('.SHA256SUMS')) : [];
  for (const f of oldLocks) {
    let sums;
    try { sums = parseSums(fs.readFileSync(path.join(std, f), 'utf8'), f); } catch { sums = new Map(); }
    for (const rel of sums.keys()) {
      if (!safeRel(rel) || keep.has(rel) || !fs.existsSync(abs(rel))) continue;
      fs.rmSync(abs(rel));
      removeEmptyDirs(path.dirname(abs(rel)), root);
      removed.push(rel);
    }
    const name = f.slice(0, -'.SHA256SUMS'.length);
    if (name !== 'generated' && !p.locks.has(name)) { fs.rmSync(path.join(std, f)); removed.push(`.standards/${f}`); }
  }
  const written = [];
  for (const [rel, buf] of p.files) if (writeIfChanged(abs(rel), buf)) written.push(rel);
  for (const [name, buf] of p.locks) if (writeIfChanged(path.join(std, `${name}.SHA256SUMS`), buf)) written.push(`.standards/${name}.SHA256SUMS`);
  for (const [rel, buf] of p.generated) if (writeIfChanged(abs(rel), buf)) written.push(rel);
  const genSums = [...p.generated.keys()].sort().map((rel) => `${sha256(p.generated.get(rel))}  ${rel}\n`).join('');
  const genAbs = path.join(std, 'generated.SHA256SUMS');
  if (genSums) { if (writeIfChanged(genAbs, Buffer.from(genSums))) written.push('.standards/generated.SHA256SUMS'); } else if (fs.existsSync(genAbs)) fs.rmSync(genAbs);
  if (manifest) {
    const buf = Buffer.from(`${JSON.stringify({ kit: manifest.kit, profiles: manifest.profiles }, null, 2)}\n`);
    if (writeIfChanged(path.join(root, '.standards.json'), buf)) written.push('.standards.json');
  }
  return { written, removed };
}

async function postVerify(root) {
  const mod = await import(`${pathToFileURL(path.join(root, '.standards', 'check.mjs')).href}?t=${Date.now()}`);
  const { failures } = mod.verifyLocks(root);
  if (failures.length) throw new Error(`post-write verify failed:\n${failures.join('\n')}`);
}

function appendAgentsLine(root) {
  const f = path.join(root, 'AGENTS.md');
  if (!fs.existsSync(f)) { fs.writeFileSync(f, `${AGENTS_LINE}\n`); return 'created'; }
  const text = fs.readFileSync(f, 'utf8');
  if (text.includes(AGENTS_LINE)) return 'present';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(f, `${text}${text === '' || text.endsWith('\n') ? '' : eol}${AGENTS_LINE}${eol}`);
  return 'appended';
}

// -------------------------------------------------------------------- commands
function readManifest(root) {
  const f = path.join(root, '.standards.json');
  if (!fs.existsSync(f)) throw new Error('no .standards.json here (use init)');
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!m || typeof m.profiles !== 'object') throw new Error('.standards.json has no "profiles" object');
  return { kit: m.kit || DEFAULT_KIT, profiles: m.profiles };
}

function report(verb, r) {
  console.log(`sync: ${verb}: ${r.written.length} file(s) written, ${r.removed.length} removed`);
  for (const f of r.written) console.log(`  + ${f}`);
  for (const f of r.removed) console.log(`  - ${f}`);
}

async function syncTo(root, manifest, src, writeManifest) {
  const p = await plan(root, manifest, src);
  const r = apply(root, p, writeManifest ? manifest : null);
  await postVerify(root);
  return r;
}

export async function main(argv) {
  const args = [...argv];
  const opt = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const flag = (f) => { const i = args.indexOf(f); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const kitArg = opt('--kit');
  const root = path.resolve(opt('--root') || process.cwd());
  const major = flag('--major');
  const [cmd, ...rest] = args;

  if (cmd === 'init') {
    if (fs.existsSync(path.join(root, '.standards.json'))) throw new Error('.standards.json already exists -- use sync or bump');
    if (rest.length === 0) throw new Error('usage: sync.mjs init <profile@x.y.z>...');
    const profiles = {};
    for (const s of rest) {
      const m = /^([a-z0-9][a-z0-9-]*)@(\d+\.\d+\.\d+)$/.exec(s);
      if (!m) throw new Error(`not <profile>@<x.y.z>: ${s}`);
      profiles[m[1]] = m[2];
    }
    const manifest = { kit: DEFAULT_KIT, profiles };
    const r = await syncTo(root, manifest, kitSource(kitArg || DEFAULT_KIT), true);
    report('init', r);
    console.log(`sync: AGENTS.md line ${appendAgentsLine(root)}`);
    console.log('\nSuggested CI job (add under `jobs:`; copy runs-on and setup steps from the build job):\n');
    console.log(CI_SNIPPET);
    return 0;
  }
  if (cmd === 'sync') {
    const manifest = readManifest(root);
    report('sync', await syncTo(root, manifest, kitSource(kitArg || manifest.kit), false));
    return 0;
  }
  if (cmd === 'bump') {
    const [name] = rest;
    const manifest = readManifest(root);
    if (!name || !Object.hasOwn(manifest.profiles, name)) throw new Error(`usage: sync.mjs bump <profile> [--major]; ${name ?? '(none)'} is not in .standards.json`);
    const src = kitSource(kitArg || manifest.kit);
    const versions = (await src.get(`profiles/${name}/VERSIONS`)).toString('utf8').split('\n').map((v) => v.trim()).filter((v) => VER_RE.test(v)).sort(cmpSemver);
    const from = manifest.profiles[name];
    const candidates = major ? versions : versions.filter((v) => v.split('.')[0] === from.split('.')[0]);
    const to = candidates[candidates.length - 1];
    if (!to || cmpSemver(to, from) <= 0) {
      const newer = versions.filter((v) => cmpSemver(v, from) > 0);
      console.log(`sync: ${name} ${from} is up-to-date${newer.length && !major ? ` within major ${from.split('.')[0]} (newer major available: ${newer[newer.length - 1]}; use --major)` : ''}`);
      return 0;
    }
    const next = { ...manifest, profiles: { ...manifest.profiles, [name]: to } };
    const r = await syncTo(root, next, src, true);
    console.log(`sync: bump ${name} ${from} -> ${to}`);
    report('bump', r);
    return 0;
  }
  throw new Error('usage: sync.mjs init <profile@x.y.z>... | sync | bump <profile> [--major]  [--kit <url|path>] [--root <dir>]');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // exitCode, not process.exit(): exiting with fetch sockets open crashed node on Windows (see bim-cli kit-bump.mjs).
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`sync: ${e.message}`); process.exitCode = 1; });
}
