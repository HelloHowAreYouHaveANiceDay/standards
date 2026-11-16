#!/usr/bin/env node
// release-local: release and deploy runner for the harness host (spec _design-ci/spec-builder-side-ci.v5.md 13.6, slice R1).
// Zero dependencies, node >= 20, Windows + POSIX. No forge compute: everything runs on this host.
//
//   node .standards/release-local/release.mjs release <tag> [--dry-run] [--repo OWNER/REPO]
//   node .standards/release-local/release.mjs deploy <sha>  [--dry-run] [--repo NAME]
//   node .standards/release-local/release.mjs check          lint ci/release.json and ci/deploy.json (those that exist)
//
// release <tag>: checkout must be clean and HEAD == the tag's commit. version (from the repo's ci/release.json version
//   source) must equal the tag minus tag_prefix (default "v"). `ci verify --sha <commit>` (the sibling ci-local vendored
//   copy) must be green. Then the build steps run, assets are hashed (SHA256SUMS is added as an asset), `gh release create`
//   publishes with GH_TOKEN from the environment, and the optional `post` hooks (argv lists) run last.
// deploy <sha>: checkout must be clean and HEAD == sha; `ci verify --sha` must be green; ci/deploy.json steps run with the
//   repo's secret env file loaded (never printed or logged; step output has the values redacted). No file -> `secrets-missing`
//   (unless ci/deploy.json says "secrets": false).
//
// ci/release.json: { schema: "release/1", version_source: {file, json:"a.b" | toml:"table.key" | regex:"(..)" | (none = first line)},
//                    tag_prefix?: "v", build?: [step], assets?: ["dist/*.zip"], post?: [argv] }
// ci/deploy.json:  { schema: "deploy/1", repo?: "name", secrets?: false, steps: [step] }
// A step is an argv list (no shell) or a string (shell). In `post` argv and steps, {tag} {version} {sha} are substituted.
//
// Envelope with --json: {ok:true,result} | {ok:false,error:{code,message}}.
// Exit: 0 ok, 1 gate failed (version-mismatch, ci-not-green, secrets-missing, ...), 2 ci pending, 3 error (tooling), 64 usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VERSION = '1.0.0';
const RELEASE_PATH = 'ci/release.json';
const DEPLOY_PATH = 'ci/deploy.json';

class RelError extends Error {
  constructor(code, message, exit = 1) { super(message); this.code = code; this.exit = exit; }
}
const usage = (m) => new RelError('usage', m, 64);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ---------- process helpers ----------
// Windows: argv[0] may be a .cmd/.bat shim (npm, gh shims); resolve it through PATH/PATHEXT and run those via the shell.
function resolveWin(cmd, env) {
  if (/[\\/]/.test(cmd) || path.extname(cmd)) return cmd;
  const exts = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) { const p = path.join(dir, cmd + ext.toLowerCase()); if (fs.existsSync(p)) return p; }
  }
  return cmd;
}
const winQuote = (a) => (/^[\w./:=@%+,-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);

export function runArgv(argv, { cwd, env = process.env, input } = {}) {
  let [cmd, ...args] = argv;
  let shell = false;
  if (process.platform === 'win32') {
    cmd = resolveWin(cmd, env);
    if (/\.(cmd|bat)$/i.test(cmd)) { shell = true; cmd = winQuote(cmd); args = args.map(winQuote); }
  }
  const r = spawnSync(cmd, args, { cwd, env, input, encoding: 'utf8', shell, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return { code: r.status ?? (r.error ? 127 : 1), out: r.stdout ?? '', err: (r.stderr ?? '') + (r.error ? String(r.error.message) : '') };
}
const git = (cwd, args) => runArgv(['git', ...args], { cwd });
function gitOk(cwd, args, what) {
  const r = git(cwd, args);
  if (r.code !== 0) throw new RelError('git', `${what ?? `git ${args.join(' ')}`}: ${r.err.trim() || r.out.trim()}`, 3);
  return r.out.trim();
}

const subst = (s, vars) => s.replace(/\{(tag|version|sha)\}/g, (_, k) => vars[k] ?? '');
// A step: argv list (no shell) or a string (shell). Returns {code, out, err}; output has `secrets` values redacted.
export function runStep(step, { cwd, env, vars = {}, secrets = [] }) {
  let r;
  if (Array.isArray(step)) r = runArgv(step.map((a) => subst(a, vars)), { cwd, env });
  else {
    const s = spawnSync(subst(step, vars), { cwd, env, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
    r = { code: s.status ?? (s.error ? 127 : 1), out: s.stdout ?? '', err: (s.stderr ?? '') + (s.error ? String(s.error.message) : '') };
  }
  const redact = (t) => secrets.reduce((acc, v) => acc.split(v).join('***'), t);
  return { code: r.code, out: redact(r.out), err: redact(r.err) };
}

// ---------- config ----------
const isStep = (s) => (typeof s === 'string' && s.length > 0) || (Array.isArray(s) && s.length > 0 && s.every((x) => typeof x === 'string' && x));
const isArgv = (s) => Array.isArray(s) && s.length > 0 && s.every((x) => typeof x === 'string' && x);

export function validateRelease(m) {
  const e = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return [`${RELEASE_PATH}: not a JSON object`];
  if (m.schema !== 'release/1') e.push('schema must be "release/1"');
  const vs = m.version_source;
  if (!vs || typeof vs !== 'object' || typeof vs.file !== 'string' || !vs.file) e.push('version_source.file is required');
  else if ([vs.json, vs.toml, vs.regex].filter((x) => x !== undefined).length > 1) e.push('version_source: one of json | toml | regex');
  else {
    for (const k of ['json', 'toml', 'regex']) if (vs[k] !== undefined && typeof vs[k] !== 'string') e.push(`version_source.${k} must be a string`);
    if (typeof vs.regex === 'string') { try { new RegExp(vs.regex); } catch (x) { e.push(`version_source.regex: ${x.message}`); } }
  }
  if (m.tag_prefix !== undefined && typeof m.tag_prefix !== 'string') e.push('tag_prefix must be a string');
  if (m.build !== undefined && !(Array.isArray(m.build) && m.build.every(isStep))) e.push('build must be a list of steps (argv list or command string)');
  if (m.assets !== undefined && !(Array.isArray(m.assets) && m.assets.every((x) => typeof x === 'string' && x))) e.push('assets must be a list of paths or simple globs');
  if (m.post !== undefined && !(Array.isArray(m.post) && m.post.every(isArgv))) e.push('post must be a list of argv lists');
  return e;
}
export function validateDeploy(m) {
  const e = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return [`${DEPLOY_PATH}: not a JSON object`];
  if (m.schema !== 'deploy/1') e.push('schema must be "deploy/1"');
  if (!Array.isArray(m.steps) || !m.steps.length || !m.steps.every(isStep)) e.push('steps must be a non-empty list of steps (argv list or command string)');
  if (m.repo !== undefined && !(typeof m.repo === 'string' && /^[\w.-]+$/.test(m.repo))) e.push('repo must be a simple name');
  if (m.secrets !== undefined && m.secrets !== false) e.push('secrets may only be false (opt out of the secrets file)');
  return e;
}
function readJson(cwd, rel, validate, missingCode) {
  const p = path.join(cwd, rel);
  if (!fs.existsSync(p)) throw new RelError(missingCode, `${rel} not found`);
  let j;
  try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (x) { throw new RelError('config-invalid', `${rel}: not valid JSON (${x.message})`); }
  const bad = validate(j);
  if (bad.length) throw new RelError('config-invalid', `${rel}: ${bad.join('; ')}`);
  return j;
}

export function readVersion(cwd, vs) {
  const p = path.join(cwd, vs.file);
  if (!fs.existsSync(p)) throw new RelError('version-source', `version source ${vs.file} not found`);
  const text = fs.readFileSync(p, 'utf8');
  let v;
  if (vs.json) {
    let j; try { j = JSON.parse(text); } catch (x) { throw new RelError('version-source', `${vs.file}: not valid JSON`); }
    v = vs.json.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), j);
  } else if (vs.toml) {
    const parts = vs.toml.split('.'); const key = parts.pop(); const table = parts.join('.');
    let cur = ''; // '' = top level
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      const t = /^\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
      if (t) { cur = t[1].trim(); continue; }
      const kv = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(line);
      if (kv && cur === table) { v = kv[1] ?? kv[2]; break; }
    }
  } else if (vs.regex) {
    v = new RegExp(vs.regex, 'm').exec(text)?.[1];
  } else v = text.split(/\r?\n/)[0].trim();
  if (typeof v !== 'string' || !v) throw new RelError('version-source', `no version found in ${vs.file}`);
  return v.trim();
}

// ---------- gates ----------
function ciVerify(cwd, sha) {
  const ci = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ci-local', 'ci.mjs');
  if (!fs.existsSync(ci)) throw new RelError('ci-missing', `ci-local is not vendored (${ci} not found); sync ci-local first`, 3);
  const r = runArgv([process.execPath, ci, 'verify', '--sha', sha, '--json'], { cwd });
  let j = null; try { j = JSON.parse(r.out); } catch { /* fall through */ }
  const detail = j?.ok === false ? `${j.error?.code}: ${j.error?.message}` : j?.result ? `${j.result.verdict}${(j.result.reasons ?? []).map((x) => ` ${x.code}`).join('')}` : (r.err.trim() || `exit ${r.code}`);
  if (r.code === 0) return;
  if (r.code === 2) throw new RelError('ci-pending', `ci verify --sha ${sha.slice(0, 12)}: pending (${detail})`, 2);
  throw new RelError('ci-not-green', `ci verify --sha ${sha.slice(0, 12)}: ${detail}`, 1);
}
function cleanCheckoutAt(cwd, sha) {
  const head = gitOk(cwd, ['rev-parse', 'HEAD']);
  if (head !== sha) throw new RelError('wrong-checkout', `HEAD is ${head.slice(0, 12)}, expected ${sha.slice(0, 12)}; run from a checkout of that commit`);
  if (gitOk(cwd, ['status', '--porcelain'])) throw new RelError('dirty-checkout', 'working tree is not clean');
}
function runSteps(steps, ctx, failCode) {
  const ran = [];
  for (const [i, s] of steps.entries()) {
    const r = runStep(s, ctx);
    if (r.code !== 0) throw new RelError(failCode, `step ${i + 1} (${Array.isArray(s) ? s[0] : s.split(/\s+/)[0]}) exited ${r.code}: ${(r.err.trim() || r.out.trim()).slice(-400)}`);
    ran.push(Array.isArray(s) ? s[0] : s.split(/\s+/)[0]);
  }
  return ran;
}

// ---------- assets ----------
// A path, or a glob whose `*` / `?` are in the LAST segment only (dist/*.zip). Sorted; every match must be a file.
export function expandAssets(cwd, patterns) {
  const out = [];
  for (const pat of patterns) {
    const dir = path.posix.dirname(pat); const base = path.posix.basename(pat);
    if (/[*?]/.test(dir)) throw new RelError('config-invalid', `assets: glob in a directory segment is not supported: ${pat}`);
    if (!/[*?]/.test(base)) {
      if (!fs.statSync(path.join(cwd, pat), { throwIfNoEntry: false })?.isFile()) throw new RelError('asset-missing', `asset ${pat} not found after build`);
      out.push(pat); continue;
    }
    const re = new RegExp(`^${base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);
    const hits = (fs.existsSync(path.join(cwd, dir)) ? fs.readdirSync(path.join(cwd, dir)) : []).filter((f) => re.test(f) && fs.statSync(path.join(cwd, dir, f)).isFile()).sort();
    if (!hits.length) throw new RelError('asset-missing', `asset glob ${pat} matched nothing after build`);
    out.push(...hits.map((f) => (dir === '.' ? f : `${dir}/${f}`)));
  }
  return [...new Set(out)];
}

// ---------- release ----------
export function cmdRelease(o) {
  const cwd = path.resolve(o.root ?? process.cwd());
  const tag = o._[1];
  if (!tag) throw usage('release needs a tag');
  const cfg = readJson(cwd, RELEASE_PATH, validateRelease, 'config-missing');
  const prefix = cfg.tag_prefix ?? 'v';
  if (!tag.startsWith(prefix) || tag.length === prefix.length) throw new RelError('version-mismatch', `tag ${tag} does not start with tag_prefix "${prefix}"`);
  const version = readVersion(cwd, cfg.version_source);
  if (tag.slice(prefix.length) !== version) throw new RelError('version-mismatch', `tag ${tag} != ${prefix}${version} (${cfg.version_source.file})`);
  const sha = gitOk(cwd, ['rev-parse', '--verify', '-q', `refs/tags/${tag}^{commit}`], `tag ${tag} not found`);
  cleanCheckoutAt(cwd, sha);
  ciVerify(cwd, sha);
  const vars = { tag, version, sha };
  const token = process.env.GH_TOKEN;
  if (!o['dry-run'] && !token) throw new RelError('no-token', 'release needs GH_TOKEN in the environment');
  const built = runSteps(cfg.build ?? [], { cwd, env: process.env, vars }, 'build-failed');
  const assets = expandAssets(cwd, cfg.assets ?? []);
  const sums = assets.map((f) => `${sha256(fs.readFileSync(path.join(cwd, f)))}  ${path.posix.basename(f)}\n`).join('');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-local-'));
  const sumsFile = path.join(outDir, 'SHA256SUMS');
  fs.writeFileSync(sumsFile, sums);
  const repoArgs = o.repo ? ['--repo', o.repo] : [];
  const ghArgs = ['release', 'create', tag, ...assets.map((f) => path.join(cwd, f)), sumsFile, '--title', tag, '--verify-tag', '--generate-notes', ...repoArgs];
  const result = { tag, version, sha, built: built.length, assets, sha256: Object.fromEntries(sums.split('\n').filter(Boolean).map((l) => [l.slice(66), l.slice(0, 64)])), published: false, post: [] };
  if (o['dry-run']) { result.dry_run = true; result.gh = ['gh', ...ghArgs.map((a) => (a.startsWith(outDir) || a.startsWith(cwd) ? path.relative(cwd, a) || a : a))]; fs.rmSync(outDir, { recursive: true, force: true }); return { exit: 0, result }; }
  const gh = runArgv(['gh', ...ghArgs], { cwd, env: process.env });
  fs.rmSync(outDir, { recursive: true, force: true });
  if (gh.code !== 0) throw new RelError('gh-failed', `gh release create exited ${gh.code}: ${(gh.err.trim() || gh.out.trim()).replace(token, '***').slice(-400)}`, 3);
  result.published = true;
  result.url = gh.out.trim().split('\n').pop();
  const penv = { ...process.env, RELEASE_TAG: tag, RELEASE_VERSION: version, RELEASE_SHA: sha };
  for (const [i, h] of (cfg.post ?? []).entries()) {
    const r = runStep(h, { cwd, env: penv, vars });
    result.post.push({ argv0: h[0], code: r.code });
    if (r.code !== 0) throw new RelError('post-failed', `release ${tag} IS published; post hook ${i + 1} (${h[0]}) exited ${r.code}: ${(r.err.trim() || r.out.trim()).slice(-400)}`);
  }
  return { exit: 0, result };
}

// ---------- deploy ----------
export function secretsCandidates(repo, env = process.env) {
  const dirs = [];
  if (env.HERMES_DEPLOY_SECRETS_DIR) dirs.push(env.HERMES_DEPLOY_SECRETS_DIR);
  if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'hermes', 'deploy-secrets'));
  dirs.push(path.join(os.homedir(), '.hermes', 'deploy-secrets'));
  return dirs.map((d) => path.join(d, `${repo}.env`));
}
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
function repoName(cwd, cfg, o) {
  if (o.repo) return o.repo;
  if (cfg.repo) return cfg.repo;
  const url = git(cwd, ['remote', 'get-url', 'origin']);
  const m = url.code === 0 ? /([^/:\\]+?)(?:\.git)?\s*$/.exec(url.out.trim()) : null;
  return m?.[1] ?? path.basename(cwd);
}
export function cmdDeploy(o) {
  const cwd = path.resolve(o.root ?? process.cwd());
  if (!o._[1]) throw usage('deploy needs a sha');
  const cfg = readJson(cwd, DEPLOY_PATH, validateDeploy, 'config-missing');
  const sha = gitOk(cwd, ['rev-parse', '--verify', '-q', `${o._[1]}^{commit}`], `commit ${o._[1]} not found`);
  cleanCheckoutAt(cwd, sha);
  ciVerify(cwd, sha);
  let env = { ...process.env }; let secretsFrom = null; let secrets = [];
  if (cfg.secrets !== false) {
    const repo = repoName(cwd, cfg, o);
    const file = secretsCandidates(repo).find((f) => fs.existsSync(f));
    if (!file) throw new RelError('secrets-missing', `no secrets file for ${repo}: looked for ${repo}.env in the deploy-secrets dirs (%LOCALAPPDATA%\\hermes\\deploy-secrets, ~/.hermes/deploy-secrets)`);
    const vars = parseEnvFile(fs.readFileSync(file, 'utf8'));
    env = { ...env, ...vars };
    secrets = Object.values(vars).filter((v) => v.length >= 4);
    secretsFrom = path.basename(file);
  }
  const vars = { sha, tag: '', version: '' };
  const result = { sha, repo_secrets: secretsFrom, steps: cfg.steps.length, ran: [] };
  if (o['dry-run']) { result.dry_run = true; return { exit: 0, result }; }
  result.ran = runSteps(cfg.steps, { cwd, env, vars, secrets }, 'deploy-failed');
  return { exit: 0, result };
}

// ---------- check ----------
function cmdCheck(o) {
  const cwd = path.resolve(o.root ?? process.cwd());
  const findings = [];
  for (const [rel, validate] of [[RELEASE_PATH, validateRelease], [DEPLOY_PATH, validateDeploy]]) {
    if (!fs.existsSync(path.join(cwd, rel))) continue;
    try { for (const e of validate(JSON.parse(fs.readFileSync(path.join(cwd, rel), 'utf8')))) findings.push(`${rel}: ${e}`); } catch (e) { findings.push(`${rel}: not valid JSON (${e.message})`); }
  }
  return { exit: findings.length ? 1 : 0, result: { findings } };
}

// ---------- main ----------
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('='); const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (['json', 'dry-run', 'help'].includes(k)) o[k] = true;
      else if (eq > 0) o[k] = a.slice(eq + 1);
      else if (i + 1 < argv.length) o[k] = argv[++i];
      else throw usage(`--${k} needs a value`);
    } else o._.push(a);
  }
  return o;
}
const VERBS = { release: cmdRelease, deploy: cmdDeploy, check: cmdCheck };

export function main(argv) {
  let json = argv.includes('--json');
  try {
    const o = parseArgs(argv); json = !!o.json;
    const verb = o._[0];
    if (!verb || o.help) { process.stdout.write(`release-local ${VERSION}: verbs ${Object.keys(VERBS).join(' | ')} (--json for the envelope)\n`); return verb ? 0 : 64; }
    if (!VERBS[verb]) throw usage(`unknown verb "${verb}"`);
    const { exit, result } = VERBS[verb](o);
    process.stdout.write(json ? `${JSON.stringify({ ok: true, result })}\n` : `${verb}: ${verb === 'check' ? (result.findings.length ? result.findings.join('\n') : 'release-local config ok') : JSON.stringify(result)}\n`);
    return exit;
  } catch (e) {
    if (!(e instanceof RelError)) e = new RelError('internal', e?.stack ?? String(e), 3);
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: { code: e.code, message: e.message } })}\n`);
    else process.stderr.write(`release ${e.code}: ${e.message}\n`);
    return e.exit;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
