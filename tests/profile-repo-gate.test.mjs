// repo-gate 1.0.0: the baseline-rule evaluator item by item (recorded facts, no network), the CODEOWNERS block
// matcher, the offline CLI, and the released files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir, node } from './helpers.mjs';

const DIR = process.env.REPO_GATE_SRC ? path.join(KIT_ROOT, 'src/profiles/repo-gate') : path.join(KIT_ROOT, 'profiles/repo-gate/1.1.0');
const STD = path.join(DIR, '.standards/repo-gate');
const GATE = path.join(STD, 'gate.mjs');
const g = await import(pathToFileURL(GATE).href);

const PR = (over = {}) => ({ type: 'pull_request', ruleset_id: 1, parameters: { require_code_owner_review: true, dismiss_stale_reviews_on_push: true, required_approving_review_count: 0, ...over } });
const good = () => ({
  repo: 'o/r', default_branch: 'main', archived: false,
  rules: [{ type: 'deletion', ruleset_id: 1 }, { type: 'non_fast_forward', ruleset_id: 1 }, PR(),
    { type: 'required_status_checks', ruleset_id: 1, parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'ci-ok' }] } }],
  rulesets: { 1: { bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }] } },
  classic: null,
  settings: { allow_auto_merge: true, delete_branch_on_merge: true },
  codeowners: g.BLOCK + '/functions/  @someone\n',
  factory: { login: 'bot', role_name: 'write' },
});
const items = (f, opts = { required: ['ci-ok'] }) => g.evaluate(f, opts).map((x) => x.item);

test('a repo with the baseline rule passes', () => assert.deepEqual(g.evaluate(good(), { required: ['ci-ok'] }), []));

test('the released ruleset itself satisfies items 1-4 and the block satisfies 2 and 5', () => {
  const f = good();
  f.rules = g.RULESET.rules.map((r) => ({ ...r, ruleset_id: 9 }));
  f.rulesets = { 9: { bypass_actors: g.RULESET.bypass_actors } };
  f.codeowners = g.BLOCK;
  assert.deepEqual(g.evaluate(f, {}), []);
  assert.equal(g.RULESET.name, 'sensitive-paths-gate');
});

test('item 1: no pull_request rule, no non_fast_forward, a non-admin bypass actor, classic force pushes', () => {
  let f = good(); f.rules = f.rules.filter((r) => r.type !== 'pull_request'); assert.ok(items(f).includes(1));
  f = good(); f.rules = f.rules.filter((r) => r.type !== 'non_fast_forward'); assert.deepEqual(items(f), [1]);
  f = good(); f.rulesets[1].bypass_actors.push({ actor_id: 42, actor_type: 'User', bypass_mode: 'always' }); assert.deepEqual(items(f), [1]);
  f = good(); f.rulesets = {}; assert.deepEqual(items(f), [1]);
  f = good(); f.classic = { allow_force_pushes: { enabled: true } }; assert.deepEqual(items(f), [1]);
});

test('item 2: missing CODEOWNERS, a missing block line, a re-assigned block line, no code-owner review', () => {
  let f = good(); f.codeowners = null; assert.ok(items(f).includes(2));
  f = good(); f.codeowners = g.BLOCK.replace(/^migrations\/.*\n/m, ''); assert.deepEqual(items(f), [2]);
  f = good(); f.codeowners = g.BLOCK + 'migrations/ @someone-else\n'; assert.deepEqual(items(f), [2]);
  f = good(); f.rules[2] = PR({ require_code_owner_review: false }); assert.deepEqual(items(f), [2]);
});

test('item 3: stale approvals kept by a ruleset or by classic reviews', () => {
  let f = good(); f.rules[2] = PR({ dismiss_stale_reviews_on_push: false }); assert.deepEqual(items(f), [3]);
  f = good(); f.classic = { required_pull_request_reviews: { dismiss_stale_reviews: false } }; assert.deepEqual(items(f), [3]);
});

test('item 4: up-to-date required by a ruleset or classic protection', () => {
  let f = good(); f.rules[3].parameters.strict_required_status_checks_policy = true; assert.deepEqual(items(f), [4]);
  f = good(); f.classic = { required_status_checks: { strict: true, contexts: [] } }; assert.deepEqual(items(f), [4]);
});

test('item 5: a configured check not required; classic contexts count; .github/ not gated', () => {
  let f = good(); assert.deepEqual(items(f, { required: ['ci-ok', 'dep-vet'] }), [5]);
  f = good(); f.rules.pop(); f.classic = { required_status_checks: { strict: false, contexts: ['ci-ok'] } }; assert.deepEqual(items(f), []);
  f = good(); f.codeowners = g.BLOCK.replace(/^\/\.github\/ .*\n/m, ''); assert.deepEqual(items(f).sort(), [2, 5]);
});

test('item 6: the factory account is admin, or its permission is unreadable; not a collaborator passes', () => {
  let f = good(); f.factory.role_name = 'admin'; assert.deepEqual(items(f), [6]);
  f = good(); f.factory.role_name = undefined; assert.deepEqual(items(f), [6]);
  f = good(); f.factory.role_name = null; assert.deepEqual(items(f), []);
});

test('item 7: auto-merge or delete-branch-on-merge off, or unreadable', () => {
  let f = good(); f.settings.allow_auto_merge = false; assert.deepEqual(items(f), [7]);
  f = good(); f.settings.delete_branch_on_merge = false; assert.deepEqual(items(f), [7]);
  f = good(); f.settings = {}; assert.deepEqual(items(f), [7, 7]);
  assert.deepEqual(g.SETTINGS, { allow_auto_merge: true, delete_branch_on_merge: true });
});

test('an archived repo fails as item 0', () => assert.deepEqual(items({ archived: true }), [0]));

test('readFacts: reads through the api function, GET only, and an unreadable repo throws', () => {
  const calls = [];
  const enc = (s) => Buffer.from(s).toString('base64');
  const api = (args) => {
    calls.push(args);
    const p = args[args.length - 1];
    if (p === 'repos/o/r') return { ok: true, json: { default_branch: 'main', archived: false, allow_auto_merge: true, delete_branch_on_merge: true } };
    if (p.startsWith('repos/o/r/rules/branches/main')) return { ok: true, json: good().rules };
    if (p === 'repos/o/r/rulesets/1') return { ok: true, json: { bypass_actors: good().rulesets[1].bypass_actors } };
    if (p.endsWith('/protection')) return { ok: false, err: 'gh: Branch not protected (HTTP 404)' };
    if (p.startsWith('repos/o/r/contents/.github/CODEOWNERS')) return { ok: true, json: { content: enc(g.BLOCK) } };
    if (p === 'repos/o/r/collaborators/bot/permission') return { ok: true, json: { role_name: 'write' } };
    return { ok: false, err: 'HTTP 404' };
  };
  const f = g.readFacts('o/r', 'bot', api);
  assert.deepEqual(g.evaluate(f, { required: ['ci-ok'] }), []);
  for (const a of calls) assert.ok(!a.some((x) => ['-X', '--method', '-f', '-F', '--input'].includes(x)), `write flag in ${a}`);
  assert.throws(() => g.readFacts('o/x', 'bot', () => ({ ok: false, err: 'HTTP 404' })), /repo/);
});

test('offline CLI: block present passes; missing file or line fails with the standards: FAIL format', () => {
  const dir = tmpdir();
  let r = node([GATE, '--offline', dir]);
  assert.equal(r.code, 1); assert.match(r.out, /standards: FAIL \[repo-gate\/codeowners\] \.github\/CODEOWNERS: missing/);
  fs.mkdirSync(path.join(dir, '.github'));
  fs.writeFileSync(path.join(dir, '.github/CODEOWNERS'), g.BLOCK.replace(/^auth\/.*\n/m, ''));
  r = node([GATE, '--offline', dir]);
  assert.equal(r.code, 1); assert.match(r.out, /`auth\/` not owned/);
  fs.writeFileSync(path.join(dir, '.github/CODEOWNERS'), `# repo lines\nfirebase.json @x\n${g.BLOCK}`);
  r = node([GATE, '--offline', dir]);
  assert.equal(r.code, 0, r.out);
});

test('released files: check.json runs the offline gate; RULES.md has a row per item', () => {
  const cj = JSON.parse(fs.readFileSync(path.join(STD, 'check.json'), 'utf8'));
  assert.equal(cj.profile, 'repo-gate');
  assert.deepEqual(cj.commands, [{ id: 'codeowners', tool: 'codeowners', run: ['node', '.standards/repo-gate/gate.mjs', '--offline'] }]);
  const rules = fs.readFileSync(path.join(STD, 'RULES.md'), 'utf8');
  for (const i of [1, 2, 3, 4, 5, 6, 7]) assert.match(rules, new RegExp(`^\\| ${i} \\|`, 'm'));
});
