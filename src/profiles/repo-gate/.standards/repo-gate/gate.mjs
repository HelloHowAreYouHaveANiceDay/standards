#!/usr/bin/env node
// repo-gate: verify that a GitHub repo carries the baseline rule (factory spec section 9).
//
//   node .standards/repo-gate/gate.mjs --repo <owner/name> [--required a,b] [--factory-account <login>] [--json]
//   node .standards/repo-gate/gate.mjs --offline [<dir>]      # CODEOWNERS block only (what check.mjs runs in CI)
//
// Live mode reads the repo with `gh api` (GET only; any token that can read the repo's rules) and prints one line
// per failed item: `repo-gate: FAIL <repo> [<item>] <what>`. Exit 0 = the repo passes, 1 = it fails, 2 = usage or
// an unreadable fact (unreadable is never a pass). The items are RULES.md 1-6.
//
// Zero dependencies; `evaluate()` is pure so the kit tests drive it with recorded facts.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BLOCK = fs.readFileSync(path.join(HERE, 'CODEOWNERS.block'), 'utf8');
export const RULESET = JSON.parse(fs.readFileSync(path.join(HERE, 'ruleset.json'), 'utf8'));
export const CODEOWNERS_LOCATIONS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']; // GitHub's lookup order
export const ADMIN_ROLE_ID = 5;

const lines = (text) => text.split(/\r?\n/).map((l) => l.split('#', 1)[0].trim()).filter(Boolean);
export const blockEntries = () => lines(BLOCK).map((l) => { const [pat, ...owners] = l.split(/\s+/); return { pat, owners }; });

// Patterns of the block that the CODEOWNERS text does not assign to the block's owner. The LAST matching line wins in
// CODEOWNERS, so a later line with the same pattern and other owners also counts as missing.
export function missingBlock(text) {
  if (text == null) return blockEntries().map((e) => e.pat);
  const last = new Map();
  for (const l of lines(text)) { const [pat, ...owners] = l.split(/\s+/); last.set(pat, owners); }
  return blockEntries().filter((e) => !e.owners.every((o) => (last.get(e.pat) || []).includes(o))).map((e) => e.pat);
}

// facts: { repo, default_branch, archived, rules: [branch rules as from GET rules/branches/<b>],
//   rulesets: { <id>: { bypass_actors } }, classic: <branch protection or null>, codeowners: <text|null>,
//   factory: { login, role_name|null } }
// opts: { required: [contexts] }. Returns [{ item, what }].
export function evaluate(f, opts = {}) {
  const out = [];
  const fail = (item, what) => out.push({ item, what });
  if (f.archived) { fail(0, 'archived (read-only; remove it from the factory config)'); return out; }
  const rules = f.rules || [];
  const of = (t) => rules.filter((r) => r.type === t);
  const prs = of('pull_request');
  const c = f.classic;
  // 1. base refuses the factory account's direct and forced pushes
  if (!prs.length) fail(1, 'no active ruleset rule `pull_request` on the default branch (direct pushes allowed)');
  if (!of('non_fast_forward').length) fail(1, 'no active ruleset rule `non_fast_forward` on the default branch (force pushes allowed)');
  if (c && c.allow_force_pushes && c.allow_force_pushes.enabled) fail(1, 'classic branch protection allows force pushes');
  const gating = new Set([...prs, ...of('non_fast_forward')].map((r) => r.ruleset_id));
  for (const id of gating) {
    const rs = (f.rulesets || {})[id];
    if (!rs || !Array.isArray(rs.bypass_actors)) { fail(1, `ruleset ${id}: bypass actors unreadable`); continue; }
    for (const b of rs.bypass_actors) {
      if (!(b.actor_type === 'RepositoryRole' && b.actor_id === ADMIN_ROLE_ID) && b.actor_type !== 'OrganizationAdmin') {
        fail(1, `ruleset ${id}: bypass actor ${b.actor_type}:${b.actor_id} is not the admin role`);
      }
    }
  }
  // 2. the kit's CODEOWNERS block + a ruleset requiring code-owner review
  const miss = missingBlock(f.codeowners);
  if (f.codeowners == null) fail(2, 'no CODEOWNERS file');
  else if (miss.length) fail(2, `CODEOWNERS lacks block line(s): ${miss.join(' ')}`);
  if (!prs.some((r) => r.parameters && r.parameters.require_code_owner_review === true)) fail(2, 'no ruleset requires code-owner review');
  // 3. stale approvals dismissed on a new push
  for (const r of prs) {
    if (!(r.parameters && r.parameters.dismiss_stale_reviews_on_push === true)) fail(3, `ruleset ${r.ruleset_id}: dismiss_stale_reviews_on_push is not true`);
  }
  const cr = c && c.required_pull_request_reviews;
  if (cr && !cr.dismiss_stale_reviews) fail(3, 'classic branch protection keeps stale approvals');
  // 4. up-to-date branches not required
  for (const r of of('required_status_checks')) {
    if (r.parameters && r.parameters.strict_required_status_checks_policy) fail(4, `ruleset ${r.ruleset_id}: requires up-to-date branches`);
  }
  if (c && c.required_status_checks && c.required_status_checks.strict) fail(4, 'classic branch protection requires up-to-date branches');
  // 5. required checks are required; workflows sit under the CODEOWNERS-gated .github/
  const have = new Set();
  for (const r of of('required_status_checks')) for (const x of (r.parameters && r.parameters.required_status_checks) || []) have.add(x.context);
  if (c && c.required_status_checks) for (const x of c.required_status_checks.contexts || []) have.add(x);
  for (const ctx of opts.required || []) if (!have.has(ctx)) fail(5, `check \`${ctx}\` is not required`);
  if (f.codeowners != null && miss.includes('/.github/')) fail(5, '.github/ is not CODEOWNERS-gated');
  // 6. the factory account is not an admin
  if (f.factory && f.factory.role_name === undefined) fail(6, `permission of ${f.factory.login} unreadable`);
  else if (f.factory && f.factory.role_name === 'admin') fail(6, `${f.factory.login} is an admin`);
  return out;
}

function gh(args) {
  const r = spawnSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.error) throw new Error(`gh: ${r.error.message}`);
  return { ok: r.status === 0, json: r.status === 0 && r.stdout.trim() ? JSON.parse(r.stdout) : null, err: (r.stderr || '').trim() };
}

class Unreadable extends Error {}
const need = (res, what) => { if (!res.ok) throw new Unreadable(`${what}: ${res.err.split('\n')[0]}`); return res.json; };

export function readFacts(repo, factoryLogin, api = gh) {
  const info = need(api([`repos/${repo}`]), 'repo');
  const f = { repo, default_branch: info.default_branch, archived: !!info.archived };
  if (f.archived) return f;
  const b = encodeURIComponent(f.default_branch);
  f.rules = need(api([`repos/${repo}/rules/branches/${b}?per_page=100`]), 'branch rules');
  f.rulesets = {};
  for (const id of new Set(f.rules.map((r) => r.ruleset_id))) {
    const rs = api([`repos/${repo}/rulesets/${id}`]);
    f.rulesets[id] = rs.ok ? { bypass_actors: rs.json.bypass_actors } : {};
  }
  const p = api([`repos/${repo}/branches/${b}/protection`]);
  if (!p.ok && !/Branch not protected|404/.test(p.err)) throw new Unreadable(`branch protection: ${p.err.split('\n')[0]}`);
  f.classic = p.ok ? p.json : null;
  f.codeowners = null;
  for (const loc of CODEOWNERS_LOCATIONS) {
    const r = api([`repos/${repo}/contents/${loc}?ref=${b}`]);
    if (r.ok) { f.codeowners = Buffer.from(r.json.content || '', 'base64').toString('utf8'); break; }
  }
  if (factoryLogin) {
    const r = api([`repos/${repo}/collaborators/${factoryLogin}/permission`]);
    f.factory = { login: factoryLogin, role_name: r.ok ? r.json.role_name : (/404/.test(r.err) ? null : undefined) };
  }
  return f;
}

function main(argv) {
  const a = { required: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--repo') a.repo = argv[++i];
    else if (k === '--required') a.required = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--factory-account') a.factory = argv[++i];
    else if (k === '--json') a.json = true;
    else if (k === '--offline') { a.offline = true; if (argv[i + 1] && !argv[i + 1].startsWith('--')) a.dir = argv[++i]; }
    else { console.error(`repo-gate: unknown argument ${k}`); return 2; }
  }
  if (a.offline) {
    const dir = a.dir || '.';
    const loc = CODEOWNERS_LOCATIONS.find((l) => fs.existsSync(path.join(dir, l)));
    const miss = missingBlock(loc ? fs.readFileSync(path.join(dir, loc), 'utf8') : null);
    if (!loc) console.log('standards: FAIL [repo-gate/codeowners] .github/CODEOWNERS: missing (copy .standards/repo-gate/CODEOWNERS.block)');
    else for (const m of miss) console.log(`standards: FAIL [repo-gate/codeowners] ${loc}: \`${m}\` not owned as in CODEOWNERS.block`);
    return loc && !miss.length ? 0 : 1;
  }
  if (!a.repo) { console.error('repo-gate: --repo <owner/name> or --offline'); return 2; }
  let facts;
  try {
    facts = readFacts(a.repo, a.factory);
  } catch (e) {
    if (a.json) console.log(JSON.stringify({ repo: a.repo, ok: false, unreadable: e.message }));
    else console.log(`repo-gate: FAIL ${a.repo} [unreadable] ${e.message}`);
    return 2;
  }
  const fails = evaluate(facts, { required: a.required });
  if (a.json) console.log(JSON.stringify({ repo: a.repo, ok: !fails.length, failures: fails }));
  else if (!fails.length) console.log(`repo-gate: OK ${a.repo}`);
  else for (const x of fails) console.log(`repo-gate: FAIL ${a.repo} [${x.item}] ${x.what}`);
  return fails.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv.slice(2));
