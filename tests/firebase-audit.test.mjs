// scripts/firebase-audit.mjs: A1-A7 PASS / FAIL / SKIP against mocked HTTP (no live calls), DEFERRED config, read-only guarantee.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir } from './helpers.mjs';

const a = await import(pathToFileURL(path.join(KIT_ROOT, 'scripts/firebase-audit.mjs')).href);
const P = 'demo-proj';
const RULES = 'rules_version = "2";\nservice cloud.firestore { match /{d=**} { allow read, write: if false; } }\n';

// Mock fetch: routes by URL substring; records every call.
function mock(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url: String(url), method, headers: init.headers || {} });
    for (const [needle, r] of routes) {
      if (!String(url).includes(needle)) continue;
      const v = typeof r === 'function' ? r({ url: String(url), method, headers: init.headers || {} }) : r;
      const [status, body] = Array.isArray(v) ? v : [200, v];
      return { status, ok: status < 400, json: async () => body };
    }
    return { status: 404, ok: false, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}
const byRule = (res) => Object.fromEntries(res.map((r) => [r.rule, r]));

function repo(rules = RULES) {
  const r = tmpdir('fb-audit-');
  fs.writeFileSync(path.join(r, 'firebase.json'), JSON.stringify({ firestore: { rules: 'firestore.rules' } }));
  fs.writeFileSync(path.join(r, 'firestore.rules'), rules);
  return r;
}

const GOOD = [
  ['/databases/(default)/backupSchedules', { backupSchedules: [{ dailyRecurrence: {}, retention: '604800s' }] }],
  ['/databases/(default)', { pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_ENABLED' }],
  ['firebaserules.googleapis.com/v1/projects/demo-proj/releases', { releases: [{ name: `projects/${P}/releases/cloud.firestore`, rulesetName: `projects/${P}/rulesets/r1` }] }],
  ['/rulesets/r1', { source: { files: [{ content: RULES }] } }],
  ['/__/firebase/init.json', { apiKey: 'AIzaFAKE' }],
  ['accounts:createAuthUri', ({ headers }) => (headers.referer ? [200, { kind: 'x' }] : [403, { error: { message: 'Requests from referer <empty> are blocked.' } }])],
  ['firebaseappcheck.googleapis.com', { services: [{ name: 'projects/1/services/firestore.googleapis.com', enforcementMode: 'ENFORCED' }] }],
  [':getIamPolicy', { bindings: [{ role: 'roles/owner', members: ['user:o@example.com'] }, { role: 'roles/editor', members: ['user:e@example.com'] }] }],
];
const run = (routes, opts = {}) => a.audit(P, { token: 'T', repo: repo(), ...opts, fetch: mock(routes) });
const over = (...patch) => [...patch, ...GOOD]; // earlier routes win

test('all seven rules PASS on a clean project', async () => {
  const r = byRule(await run(GOOD));
  for (const k of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']) assert.equal(r[k].state, 'PASS', `${k}: ${r[k].what}`);
});

test('A1: PITR off FAILs; DEFERRED when backups deferred; no token SKIPs', async () => {
  const off = over(['/databases/(default)/backupSchedules', GOOD[0][1]], ['/databases/(default)', { pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_DISABLED' }]);
  assert.equal(byRule(await run(off)).A1.state, 'FAIL');
  const d = byRule(await run(off, { config: { backups: 'deferred' } }));
  assert.equal(d.A1.state, 'DEFERRED');
  assert.match(d.A1.what, /deferred/);
  const s = byRule(await a.audit(P, { token: '', repo: repo(), fetch: mock(GOOD) }));
  assert.equal(s.A1.state, 'SKIP');
  assert.match(s.A1.what, /no credentials/);
  const denied = byRule(await run(over(['/databases/(default)/backupSchedules', GOOD[0][1]], ['/databases/(default)', [403, { error: { message: 'denied' } }]])));
  assert.equal(denied.A1.state, 'SKIP');
});

test('A2: no schedule / short retention FAIL, weekly-only FAIL, DEFERRED, 403 SKIP', async () => {
  const none = over(['/backupSchedules', {}]);
  assert.equal(byRule(await run(none)).A2.state, 'FAIL');
  assert.equal(byRule(await run(over(['/backupSchedules', { backupSchedules: [{ dailyRecurrence: {}, retention: '86400s' }] }]))).A2.state, 'FAIL');
  assert.equal(byRule(await run(over(['/backupSchedules', { backupSchedules: [{ weeklyRecurrence: {}, retention: '604800s' }] }]))).A2.state, 'FAIL');
  assert.equal(byRule(await run(none, { config: { backups: 'deferred' } })).A2.state, 'DEFERRED');
  assert.equal(byRule(await run(over(['/backupSchedules', [403, {}]]))).A2.state, 'SKIP');
});

test('A3: drifted rules FAIL, missing release FAIL, unreadable ruleset SKIP, no rules path SKIP', async () => {
  const drift = over(['/rulesets/r1', { source: { files: [{ content: 'rules_version = "2"; // other' }] } }]);
  const f = byRule(await run(drift)).A3;
  assert.equal(f.state, 'FAIL');
  assert.match(f.what, /deployed [0-9a-f]{12} != repo [0-9a-f]{12}/);
  assert.equal(byRule(await run(over(['firebaserules.googleapis.com/v1/projects/demo-proj/releases', { releases: [] }]))).A3.state, 'FAIL');
  assert.equal(byRule(await run(over(['/rulesets/r1', [403, {}]]))).A3.state, 'SKIP');
  assert.equal(byRule(await run(over(['firebaserules.googleapis.com/v1/projects/demo-proj/releases', [403, {}]]))).A3.state, 'SKIP');
  const empty = tmpdir('fb-audit-empty-');
  assert.equal(byRule(await run(GOOD, { repo: empty })).A3.state, 'SKIP');
  // CRLF checkout of the same file still equals the deployed text
  assert.equal(byRule(await run(GOOD, { repo: repo(RULES.replace(/\n/g, '\r\n')) })).A3.state, 'PASS');
});

test('A4: `registered` present FAILs; unreadable key / odd answer SKIP', async () => {
  const on = over(['accounts:createAuthUri', ({ headers }) => (headers.referer ? [200, { registered: false }] : [403, {}])]);
  assert.equal(byRule(await run(on)).A4.state, 'FAIL');
  const nokey = over(['/__/firebase/init.json', [404, {}]]);
  const r = byRule(await run(nokey));
  assert.equal(r.A4.state, 'SKIP');
  assert.equal(r.A5.state, 'SKIP');
  const odd = over(['accounts:createAuthUri', ({ headers }) => (headers.referer ? [403, { error: { message: 'REFERER_BLOCKED' } }] : [403, {}])]);
  assert.equal(byRule(await run(odd)).A4.state, 'SKIP');
});

test('A5: unrestricted key FAILs; probe runs without credentials', async () => {
  const open = over(['accounts:createAuthUri', [200, { kind: 'x' }]]);
  assert.equal(byRule(await run(open)).A5.state, 'FAIL');
  const r = byRule(await a.audit(P, { token: '', repo: repo(), fetch: mock(GOOD) }));
  assert.equal(r.A4.state, 'PASS');
  assert.equal(r.A5.state, 'PASS');
});

test('A6: unenforced WARNs (not FAIL), no services WARNs, 403 SKIP', async () => {
  const off = over(['firebaseappcheck', { services: [{ name: 'projects/1/services/firestore.googleapis.com', enforcementMode: 'UNENFORCED' }] }]);
  assert.equal(byRule(await run(off)).A6.state, 'WARN');
  assert.equal(byRule(await run(over(['firebaseappcheck', {}]))).A6.state, 'WARN');
  assert.equal(byRule(await run(over(['firebaseappcheck', [403, {}]]))).A6.state, 'SKIP');
});

test('A7: service account owner/editor FAILs; user owners are fine; 403 SKIP', async () => {
  const sa = over([':getIamPolicy', { bindings: [{ role: 'roles/editor', members: ['serviceAccount:deploy@p.iam.gserviceaccount.com'] }] }]);
  const f = byRule(await run(sa)).A7;
  assert.equal(f.state, 'FAIL');
  assert.match(f.what, /deploy@p\.iam\.gserviceaccount\.com holds roles\/editor/);
  assert.equal(byRule(await run(over([':getIamPolicy', [403, {}]]))).A7.state, 'SKIP');
});

test('read-only: only GETs plus the two read POSTs, and no request carries a mutating path', async () => {
  const f = mock(GOOD);
  await a.audit(P, { token: 'T', repo: repo(), fetch: f });
  const posts = f.calls.filter((c) => c.method !== 'GET').map((c) => c.url.replace(/\?.*/, '')).sort();
  assert.deepEqual(posts, ['https://cloudresourcemanager.googleapis.com/v1/projects/demo-proj:getIamPolicy', 'https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri', 'https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri']);
  assert.ok(!f.calls.some((c) => ['PUT', 'PATCH', 'DELETE'].includes(c.method)));
});

test('readConfig: backups deferred is read from .standards.json top-level "firebase-web"', () => {
  const r = tmpdir('fb-cfg-');
  assert.equal(a.readConfig(r).backups, 'required');
  fs.writeFileSync(path.join(r, '.standards.json'), JSON.stringify({ kit: 'k', profiles: {}, 'firebase-web': { backups: 'deferred' } }));
  assert.equal(a.readConfig(r).backups, 'deferred');
  fs.writeFileSync(path.join(r, '.standards.json'), JSON.stringify({ kit: 'k', profiles: {}, 'firebase-web': { backups: 'maybe' } }));
  assert.equal(a.readConfig(r).backups, 'required');
});

test('manifestOut keeps follower-owned extra keys after kit and profiles', async () => {
  const s = await import(pathToFileURL(path.join(KIT_ROOT, 'sync.mjs')).href);
  const out = s.manifestOut({ 'firebase-web': { backups: 'deferred' }, profiles: { base: '1.0.0' }, kit: 'k' });
  assert.deepEqual(Object.keys(out), ['kit', 'profiles', 'firebase-web']);
});
