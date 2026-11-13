#!/usr/bin/env node
// standards: agent-facing CLI over this kit. Generic: it knows profiles, locks and RULES.md files, never a repo,
// an org or a path. Every verb takes --json (envelope {ok, result} | {ok:false, error}) and --root <repo dir>.
//
//   node <kit>/standards.mjs describe --json          verb table (bim driver shape)
//   node <kit>/standards.mjs list                     profiles in the kit (+ which the repo adopted)
//   node <kit>/standards.mjs init base@1.0.0 ...      adopt profiles (refuses to overwrite files it does not manage)
//   node <kit>/standards.mjs check [--strict]         read-only drift report; exit 1 on drift
//   node <kit>/standards.mjs apply [--dry-run]        re-vendor managed files; never clobbers hand edits w/o --force
//   node <kit>/standards.mjs upgrade [<profile>...]   bump pins (within major unless --major) with a file diff
//   node <kit>/standards.mjs explain <rule>           the rule text from the adopted profiles' RULES.md
//
// Kit: --kit <path|url>, else $STANDARDS_KIT, else the clone this file lives in.
// Exit codes: 0 ok/clean, 1 drift/conflict/not-found, 2 usage error, 3 kit or internal error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { kitSource, plan as syncPlan, apply as syncApply, diffPlan, cmpSemver, DEFAULT_KIT, AGENTS_LINE } from './sync.mjs';

export const VERSION = '0.1.0';
const SELF_KIT = path.dirname(fileURLToPath(import.meta.url));
const VER_RE = /^\d+\.\d+\.\d+$/;
const SUMS_RE = /^([0-9a-f]{64}) {2}(\S(?:.*\S)?)$/;
export const AGENTS_CLI_LINE = 'Standards drift: `node <standards-kit>/standards.mjs check --json` (fix: `apply`, bump: `upgrade`, rule text: `explain <id>`).';
export const EXIT = { ok: 0, drift: 1, 'usage-error': 2, error: 3 };

class CliError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, { extra }); }
}
const usage = (m) => new CliError('usage', m);

// -------------------------------------------------------------------- describe
const A = (name, type, help, more = {}) => ({ name, type, help, ...more });
const COMMON = [A('root', 'path', 'repo root (default: cwd)'), A('kit', 'string', 'kit path or https URL (default: $STANDARDS_KIT, else this clone)'), A('json', 'bool', 'machine-readable envelope on stdout')];
const DRY = A('dry-run', 'bool', 'print the plan (write/remove/conflicts) and change nothing');
const FORCE = A('force', 'bool', 'overwrite hand-edited or unmanaged files at managed paths');
export const DESCRIBE = {
  name: 'standards',
  version: VERSION,
  description: 'Manage versioned repo standards (profiles of vendored config files, locks and gate commands) in a follower repo.',
  exit_codes: EXIT,
  verbs: [
    { name: 'describe', effect: 'read', output: 'json', description: 'Print this verb table so an agent can discover the CLI.', args: [A('json', 'bool', 'JSON output')] },
    { name: 'list', effect: 'read', output: 'json', description: 'List every profile in the kit with its released versions, the latest, and the version this repo adopted.', args: COMMON },
    { name: 'init', effect: 'mutate', output: 'json', description: 'Adopt profiles: write .standards.json, vendor their files and locks, add the AGENTS.md lines. Refuses on any existing file it does not manage.', args: [A('profile', 'array', 'profile@x.y.z (base is required)', { positional: true, required: true }), DRY, FORCE, ...COMMON] },
    { name: 'check', effect: 'verify', output: 'json', description: 'Read-only drift report: hand-edited or missing vendored files, stale locks, kit drift, newer versions, missing AGENTS.md lines. Exit 1 on any error finding.', args: [A('strict', 'bool', 'treat warnings (newer version, AGENTS line) as drift'), ...COMMON] },
    { name: 'apply', effect: 'mutate', output: 'json', description: 'Re-vendor managed files from .standards.json. Idempotent; never clobbers a hand edit or an unmanaged file unless --force.', args: [DRY, FORCE, ...COMMON] },
    { name: 'upgrade', effect: 'mutate', output: 'json', description: 'Bump pinned profile versions (newest within the major, or across with --major), showing the file diff and changelog first.', args: [A('profile', 'array', 'profiles to bump (default: all adopted)', { positional: true }), A('major', 'bool', 'allow a new major version'), DRY, FORCE, ...COMMON] },
    { name: 'explain', effect: 'read', output: 'json', description: 'Show the text of a rule id (e.g. C1) or keyword from the RULES.md of the adopted profiles (all kit profiles outside a follower).', args: [A('rule', 'string', 'rule id or keyword', { positional: true, required: true }), ...COMMON] },
  ],
};

// -------------------------------------------------------------------- helpers
function parseSums(text) {
  const m = new Map();
  for (const line of text.split('\n')) { const x = SUMS_RE.exec(line); if (x) m.set(x[2], x[1]); }
  return m;
}

function readManifest(root) {
  const f = path.join(root, '.standards.json');
  if (!fs.existsSync(f)) return null;
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!m || typeof m.profiles !== 'object' || !m.profiles) throw new CliError('error', '.standards.json has no "profiles" object');
  return { kit: m.kit || DEFAULT_KIT, profiles: m.profiles };
}

async function kitText(src, rel) { try { return (await src.get(rel)).toString('utf8'); } catch { return null; } }
async function versionsOf(src, name) {
  const t = await kitText(src, `profiles/${name}/VERSIONS`);
  return t ? t.split('\n').map((v) => v.trim()).filter((v) => VER_RE.test(v)).sort(cmpSemver) : [];
}

async function verifyLocksFn() {
  // The kit's own newest base gate (trusted code), never the follower's vendored copy.
  const vs = fs.readFileSync(path.join(SELF_KIT, 'profiles', 'base', 'VERSIONS'), 'utf8').split('\n').filter((v) => VER_RE.test(v)).sort(cmpSemver);
  const f = path.join(SELF_KIT, 'profiles', 'base', vs[vs.length - 1], '.standards', 'check.mjs');
  return (await import(pathToFileURL(f).href)).verifyLocks;
}

function agentsLines(root) {
  const f = path.join(root, 'AGENTS.md');
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  return [AGENTS_LINE, AGENTS_CLI_LINE].filter((l) => !text.includes(l));
}
function addAgentsLines(root) {
  const missing = agentsLines(root);
  if (!missing.length) return [];
  const f = path.join(root, 'AGENTS.md');
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(f, `${text}${text === '' || text.endsWith('\n') ? '' : eol}${missing.map((l) => l + eol).join('')}`);
  return ['AGENTS.md'];
}

async function writeVerified(root, p, manifest) {
  syncApply(root, p, manifest);
  const { failures } = (await verifyLocksFn())(root);
  if (failures.length) throw new CliError('error', `post-write verify failed:\n${failures.join('\n')}`);
}

async function mutate(root, manifest, src, { dryRun, force, writeManifest }) {
  const p = await syncPlan(root, manifest, src);
  const d = diffPlan(root, p, writeManifest ? manifest : null);
  if (d.conflicts.length && !force && !dryRun) {
    throw new CliError('conflict', `${d.conflicts.length} file(s) would be overwritten or deleted that the locks do not vouch for: ${d.conflicts.map((c) => `${c.path} (${c.reason})`).join(', ')}. Move the change to an overlay file, or re-run with --force.`, { conflicts: d.conflicts });
  }
  if (!dryRun && (d.write.length || d.remove.length)) await writeVerified(root, p, writeManifest ? manifest : null);
  return { dry_run: !!dryRun, ...d };
}

function profileSpecs(list) {
  const out = {};
  for (const s of list) {
    const m = /^([a-z0-9][a-z0-9-]*)@(\d+\.\d+\.\d+)$/.exec(s);
    if (!m) throw usage(`not <profile>@<x.y.z>: ${s}`);
    out[m[1]] = m[2];
  }
  return out;
}

function changelogBetween(text, from, to) {
  if (!text) return '';
  const parts = text.replace(/\r\n/g, '\n').split(/^(?=## )/m);
  return parts.filter((s) => {
    const m = /^## \[?(\d+\.\d+\.\d+)/.exec(s);
    return m && cmpSemver(m[1], from) > 0 && cmpSemver(m[1], to) <= 0;
  }).join('').trim();
}

// RULES.md -> blocks: table rows keyed by first cell, headed sections, bullet items.
export function findRule(text, q) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const lq = q.toLowerCase();
  const exact = []; const loose = [];
  const word = new RegExp(`(^|[^A-Za-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const cell = /^\|\s*([^|]+?)\s*\|/.exec(l);
    if (cell && cell[1].toLowerCase() === lq) { exact.push(l); continue; }
    if (/^#+ /.test(l) && new RegExp(`\\(${q}\\)`, 'i').test(l)) {
      const body = [l];
      for (let j = i + 1; j < lines.length && !/^#+ /.test(lines[j]); j++) body.push(lines[j]);
      exact.push(body.join('\n').trim());
      continue;
    }
    if (/^- /.test(l)) {
      const body = [l];
      for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) body.push(lines[j]);
      if (word.test(body.join(' '))) loose.push(body.join('\n'));
    } else if (cell && !/^\|[-\s|]+\|$/.test(l) && word.test(l)) loose.push(l);
  }
  return exact.length ? exact : loose;
}

function rulesRel(name) { return name === 'base' ? '.standards/RULES.md' : `.standards/${name}/RULES.md`; }

// -------------------------------------------------------------------- verbs
async function cmdList({ kit, root }) {
  if (/^https?:/.test(kit)) throw new CliError('error', 'list needs a local kit clone (--kit <path>); a URL kit has no directory listing');
  const dir = path.join(kit, 'profiles');
  const src = kitSource(kit);
  const manifest = readManifest(root);
  const profiles = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const versions = await versionsOf(src, name);
    if (!versions.length) continue;
    const latest = versions[versions.length - 1];
    const rules = await kitText(src, `profiles/${name}/${latest}/${rulesRel(name)}`);
    const title = rules ? (/^# (.+)$/m.exec(rules) || [])[1] || null : null;
    profiles.push({ name, versions, latest, adopted: manifest?.profiles?.[name] ?? null, title });
  }
  return { kit, profiles };
}

async function cmdCheck({ kit, root, strict }) {
  const findings = [];
  const add = (f) => findings.push(f);
  let manifest;
  try { manifest = readManifest(root); } catch (e) { add({ kind: 'manifest', severity: 'error', path: '.standards.json', message: e.message }); }
  if (manifest === null) {
    add({ kind: 'not-adopted', severity: 'error', path: '.standards.json', message: 'no .standards.json: this repo adopts no profiles (see `list`, then `init base@<x.y.z> ...`)' });
    return { root, kit, status: 'not-adopted', profiles: {}, findings, _exit: 1 };
  }
  if (manifest) {
    const { failures } = (await verifyLocksFn())(root);
    for (const line of failures) {
      const m = /^standards: FAIL \[([^\]]+)\] (.+?): (.*)$/.exec(line);
      const [tag, p, what] = m ? [m[1], m[2], m[3]] : ['lock', '', line];
      const kind = /^sha256 /.test(what) ? 'modified' : /^missing/.test(what) ? 'missing' : /^not listed/.test(what) ? 'unlisted'
        : /^changed since/.test(what) ? 'overlay-changed' : tag === 'generated' ? 'generated' : 'lock';
      add({ kind, severity: 'error', path: p, message: what });
    }
    const src = kitSource(kit);
    try {
      const p = await syncPlan(root, manifest, src);
      const d = diffPlan(root, p, null);
      const seen = new Set(findings.map((f) => f.path));
      for (const rel of d.write) if (!seen.has(rel)) add({ kind: 'out-of-sync', severity: 'error', path: rel, message: 'differs from the kit release; run apply' });
      for (const rel of d.remove) if (!seen.has(rel)) add({ kind: 'stale', severity: 'error', path: rel, message: 'left over from an older profile set; run apply' });
    } catch (e) {
      add({ kind: 'kit', severity: 'error', path: '.standards.json', message: e.message });
    }
    for (const [name, ver] of Object.entries(manifest.profiles)) {
      const vs = await versionsOf(src, name);
      if (!vs.length) continue;
      const sameMajor = vs.filter((v) => v.split('.')[0] === String(ver).split('.')[0]);
      const latest = vs[vs.length - 1]; const minor = sameMajor[sameMajor.length - 1];
      if (minor && cmpSemver(minor, ver) > 0) add({ kind: 'behind', severity: 'warn', profile: name, version: ver, latest: minor, message: `${name} ${ver} -> ${minor} available (upgrade ${name})` });
      else if (cmpSemver(latest, ver) > 0) add({ kind: 'behind-major', severity: 'warn', profile: name, version: ver, latest, message: `${name} ${ver}: new major ${latest} (upgrade ${name} --major)` });
    }
    for (const l of agentsLines(root)) add({ kind: 'agents-line', severity: 'warn', path: 'AGENTS.md', message: `missing line: ${l}` });
  }
  if (strict) for (const f of findings) f.severity = 'error';
  const errors = findings.filter((f) => f.severity === 'error').length;
  return { root, kit, status: errors ? 'drift' : 'clean', profiles: manifest?.profiles ?? {}, findings, _exit: errors ? 1 : 0 };
}

async function cmdInit({ kit, root, rest, dryRun, force }) {
  if (!rest.length) throw usage('usage: init <profile@x.y.z>... (base is required)');
  if (fs.existsSync(path.join(root, '.standards.json'))) throw new CliError('exists', '.standards.json already exists: use apply or upgrade');
  const manifest = { kit: /^https?:/.test(kit) ? kit : DEFAULT_KIT, profiles: profileSpecs(rest) };
  const r = await mutate(root, manifest, kitSource(kit), { dryRun, force, writeManifest: true });
  const agents = agentsLines(root).length ? ['AGENTS.md'] : [];
  if (!dryRun) addAgentsLines(root);
  return { ...r, write: [...new Set([...r.write, ...agents])].sort(), profiles: manifest.profiles };
}

async function cmdApply({ kit, root, dryRun, force }) {
  const manifest = readManifest(root);
  if (!manifest) throw new CliError('not-adopted', 'no .standards.json here (use init)');
  return mutate(root, manifest, kitSource(kit), { dryRun, force, writeManifest: false });
}

async function cmdUpgrade({ kit, root, rest, dryRun, force, major }) {
  const manifest = readManifest(root);
  if (!manifest) throw new CliError('not-adopted', 'no .standards.json here (use init)');
  const names = rest.length ? rest : Object.keys(manifest.profiles);
  const src = kitSource(kit);
  const next = { ...manifest, profiles: { ...manifest.profiles } };
  const upgrades = [];
  for (const name of names) {
    if (!Object.hasOwn(manifest.profiles, name)) throw usage(`${name} is not adopted in .standards.json`);
    const from = manifest.profiles[name];
    const vs = (await versionsOf(src, name)).filter((v) => major || v.split('.')[0] === from.split('.')[0]);
    const to = vs[vs.length - 1];
    if (!to || cmpSemver(to, from) <= 0) continue;
    const oldLock = fs.existsSync(path.join(root, '.standards', `${name}.SHA256SUMS`)) ? parseSums(fs.readFileSync(path.join(root, '.standards', `${name}.SHA256SUMS`), 'utf8')) : new Map();
    const newSums = parseSums((await src.get(`profiles/${name}/${to}/SHA256SUMS`)).toString('utf8'));
    const files = { added: [], changed: [], removed: [] };
    for (const [rel, sha] of newSums) { if (!oldLock.has(rel)) files.added.push(rel); else if (oldLock.get(rel) !== sha) files.changed.push(rel); }
    for (const rel of oldLock.keys()) if (!newSums.has(rel)) files.removed.push(rel);
    Object.values(files).forEach((a) => a.sort());
    upgrades.push({ profile: name, from, to, files, changelog: changelogBetween(await kitText(src, `profiles/${name}/CHANGELOG.md`), from, to) });
    next.profiles[name] = to;
  }
  if (!upgrades.length) return { dry_run: !!dryRun, upgrades, write: [], remove: [], conflicts: [] };
  const r = await mutate(root, next, src, { dryRun, force, writeManifest: true });
  return { upgrades, ...r };
}

async function cmdExplain({ kit, root, rest }) {
  const [q] = rest;
  if (!q) throw usage('usage: explain <rule-id|keyword>');
  const src = kitSource(kit);
  const manifest = readManifest(root);
  let pairs;
  if (manifest) pairs = Object.entries(manifest.profiles);
  else {
    if (/^https?:/.test(kit)) throw usage('explain outside a follower needs a local kit (--kit <path>)');
    pairs = [];
    for (const n of fs.readdirSync(path.join(kit, 'profiles')).sort()) { const vs = await versionsOf(src, n); if (vs.length) pairs.push([n, vs[vs.length - 1]]); }
  }
  const matches = [];
  for (const [name, ver] of pairs) {
    const rel = rulesRel(name);
    const text = await kitText(src, `profiles/${name}/${ver}/${rel}`);
    if (!text) continue;
    for (const t of findRule(text, q)) matches.push({ profile: name, version: ver, file: rel, text: t });
  }
  if (!matches.length) throw new CliError('not-found', `no rule or text matching ${JSON.stringify(q)} in ${pairs.map(([n, v]) => `${n}@${v}`).join(', ')}`);
  return { query: q, matches };
}

// -------------------------------------------------------------------- main
function human(verb, r) {
  if (verb === 'check') {
    const lines = [`standards check: ${r.status} (${r.findings.length} finding(s))`];
    for (const f of r.findings) lines.push(`  ${f.severity.toUpperCase().padEnd(5)} ${f.kind.padEnd(13)} ${f.path || f.profile || ''}: ${f.message}`);
    return lines.join('\n');
  }
  if (verb === 'explain') return r.matches.map((m) => `[${m.profile}@${m.version} ${m.file}]\n${m.text}`).join('\n\n');
  if (verb === 'list') return r.profiles.map((p) => `${p.name.padEnd(14)} ${p.latest.padEnd(7)} ${p.adopted ? `adopted ${p.adopted}` : ''}`.trimEnd()).join('\n');
  return JSON.stringify(r, null, 2);
}

export async function main(argv) {
  const args = [...argv];
  const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const flag = (f) => { const i = args.indexOf(f); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const asJson = flag('--json');
  const out = (o) => process.stdout.write(`${asJson ? JSON.stringify(o) : o.ok ? human(verb, o.result) : `standards: ${o.error.kind}: ${o.error.message}`}\n`);
  let verb;
  try {
    const kitArg = opt('--kit');
    const ctx = {
      kit: kitArg ? (/^https?:/.test(kitArg) ? kitArg : path.resolve(kitArg)) : process.env.STANDARDS_KIT || SELF_KIT,
      root: path.resolve(opt('--root') || process.cwd()),
      dryRun: flag('--dry-run'), force: flag('--force'), strict: flag('--strict'), major: flag('--major'),
    };
    flag('--help');
    [verb, ...ctx.rest] = args;
    const unknown = ctx.rest.find((a) => a.startsWith('--'));
    if (unknown) throw usage(`unknown flag ${unknown}`);
    const fns = { describe: async () => DESCRIBE, list: cmdList, check: cmdCheck, init: cmdInit, apply: cmdApply, upgrade: cmdUpgrade, explain: cmdExplain };
    if (!fns[verb]) throw usage(`usage: standards <${Object.keys(fns).join('|')}> [--json] (got ${verb ?? 'nothing'})`);
    const result = await fns[verb](ctx);
    const code = result._exit ?? 0;
    delete result._exit;
    out({ ok: true, result });
    return code;
  } catch (e) {
    const kind = e instanceof CliError ? e.kind : 'error';
    out({ ok: false, error: { kind, message: e.message, ...(e.extra || {}) } });
    return kind === 'usage' ? 2 : kind === 'error' ? 3 : 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
