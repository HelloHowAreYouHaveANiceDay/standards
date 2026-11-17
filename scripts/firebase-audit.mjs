#!/usr/bin/env node
// Live Firebase audit (docs/firebase.md "Live audit", rules A1-A7). Read-only: it never creates, updates or deletes
// anything. Run by an operator at adoption and after console changes, never in CI (its findings describe a project,
// not a commit).
//
//   node scripts/firebase-audit.mjs <project> [--repo <dir>] [--site-url <url>] [--json]
//
// Credentials, first hit wins: env GOOGLE_OAUTH_ACCESS_TOKEN; Application Default Credentials (the file named by
// GOOGLE_APPLICATION_CREDENTIALS or the gcloud well-known file; authorized_user or service_account);
// `gcloud auth application-default print-access-token`. With none, the rules that need a token print SKIP.
// Rule states: PASS, FAIL, WARN, DEFERRED, SKIP. A rule it cannot reach is SKIP with the reason, never PASS (D4).
//
// Requests: GET everywhere, plus two POSTs that only READ (identitytoolkit accounts:createAuthUri for A4/A5 and
// cloudresourcemanager projects:getIamPolicy for A7). No request body ever changes project state.
//
// Follower config (`.standards.json` in --repo, top-level key, kept by sync/bump/upgrade):
//   { "kit": "...", "profiles": {...}, "firebase-web": { "backups": "deferred" } }
// backups "deferred" turns A1/A2 FAIL into DEFERRED (spec D6: PITR + backups wait for paying customers).
//
// Exit 0 no FAIL, 1 a FAIL, 2 usage error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_RETENTION_S = 7 * 24 * 3600;
const RULES = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];

export function readConfig(repo) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(repo, '.standards.json'), 'utf8'));
    const c = m && typeof m['firebase-web'] === 'object' && m['firebase-web'] ? m['firebase-web'] : {};
    return { backups: c.backups === 'deferred' ? 'deferred' : 'required' };
  } catch { return { backups: 'required' }; }
}

const norm = (s) => String(s).replace(/\r\n/g, '\n').trim();
const sha = (s) => crypto.createHash('sha256').update(norm(s)).digest('hex').slice(0, 12);
const secs = (d) => { const m = /^(\d+)(?:\.\d+)?s$/.exec(String(d ?? '')); return m ? Number(m[1]) : NaN; };

// Token sources. Pure helper injected for tests via opts.token.
async function adcToken(fetchFn, env = process.env) {
  if (env.GOOGLE_OAUTH_ACCESS_TOKEN) return { token: env.GOOGLE_OAUTH_ACCESS_TOKEN };
  const file = env.GOOGLE_APPLICATION_CREDENTIALS || path.join(env.APPDATA ? path.join(env.APPDATA, 'gcloud') : path.join(os.homedir(), '.config', 'gcloud'), 'application_default_credentials.json');
  if (fs.existsSync(file)) {
    let c;
    try { c = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { reason: `ADC file ${path.basename(file)} is not JSON` }; }
    try {
      if (c.type === 'authorized_user') {
        const r = await fetchFn('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' }) });
        const b = await r.json();
        return b.access_token ? { token: b.access_token } : { reason: `ADC refresh failed: HTTP ${r.status}` };
      }
      if (c.type === 'service_account') {
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        const head = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: c.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform.read-only', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 })}`;
        const sig = crypto.sign('RSA-SHA256', Buffer.from(head), c.private_key).toString('base64url');
        const r = await fetchFn('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${sig}` }) });
        const b = await r.json();
        return b.access_token ? { token: b.access_token } : { reason: `service account token failed: HTTP ${r.status}` };
      }
      return { reason: `ADC file type ${c.type} unsupported` };
    } catch (e) { return { reason: `ADC token request failed: ${e.message}` }; }
  }
  const g = spawnSync('gcloud auth application-default print-access-token', { encoding: 'utf8', shell: true });
  if (!g.error && g.status === 0 && g.stdout.trim()) return { token: g.stdout.trim() };
  return { reason: 'no Google credentials (set GOOGLE_OAUTH_ACCESS_TOKEN, run gcloud auth application-default login, or set GOOGLE_APPLICATION_CREDENTIALS)' };
}

export async function audit(project, opts = {}) {
  const f = opts.fetch || fetch;
  const repo = opts.repo || process.cwd();
  const config = opts.config || readConfig(repo);
  const res = [];
  const add = (rule, state, what) => res.push({ rule, state, what });
  const get = async (url, token, extra = {}) => {
    const r = await f(url, { method: 'GET', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, signal: AbortSignal.timeout(20_000) });
    let body = {};
    try { body = await r.json(); } catch { /* empty */ }
    return { status: r.status, body };
  };
  const post = async (url, token, json, extra = {}) => {
    const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(json), signal: AbortSignal.timeout(20_000) });
    let body = {};
    try { body = await r.json(); } catch { /* empty */ }
    return { status: r.status, body };
  };
  const denied = (r) => r.status === 401 || r.status === 403;
  const noAccess = (rule, r, what) => add(rule, 'SKIP', `${what}: HTTP ${r.status}${r.body?.error?.message ? ` (${String(r.body.error.message).slice(0, 80)})` : ''} -- credentials cannot read it`);

  const tk = opts.token !== undefined ? { token: opts.token || undefined, reason: opts.token ? undefined : 'no credentials' } : await adcToken(f);
  const token = tk.token;
  const nok = (rule, why) => add(rule, 'SKIP', why);
  const needTok = (rule) => nok(rule, tk.reason || 'no credentials');
  const deferred = config.backups === 'deferred';
  const bad = (rule, what) => add(rule, deferred ? 'DEFERRED' : 'FAIL', deferred ? `${what} (accepted: backups deferred in .standards.json, spec D6)` : what);

  const db = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)`;
  // A1 PITR
  if (!token) needTok('A1');
  else {
    try {
      const r = await get(db, token);
      if (r.status === 200) {
        if (r.body.pointInTimeRecoveryEnablement === 'POINT_IN_TIME_RECOVERY_ENABLED') add('A1', 'PASS', 'Firestore point-in-time recovery is enabled');
        else bad('A1', `Firestore PITR is ${r.body.pointInTimeRecoveryEnablement || 'not enabled'}`);
      } else noAccess('A1', r, 'GET databases/(default)');
    } catch (e) { nok('A1', `request failed: ${e.message}`); }
  }
  // A2 backup schedule
  if (!token) needTok('A2');
  else {
    try {
      const r = await get(`${db}/backupSchedules`, token);
      if (r.status === 200) {
        const sch = r.body.backupSchedules || [];
        const ok = sch.filter((s) => s.dailyRecurrence && secs(s.retention) >= MIN_RETENTION_S);
        if (ok.length) add('A2', 'PASS', `daily backup schedule with retention ${secs(ok[0].retention) / 86400} days`);
        else bad('A2', sch.length ? `${sch.length} backup schedule(s), none daily with retention >= 7 days` : 'no backup schedule');
      } else noAccess('A2', r, 'GET backupSchedules');
    } catch (e) { nok('A2', `request failed: ${e.message}`); }
  }
  // A3 deployed rules == repo rules
  if (!token) needTok('A3');
  else {
    try {
      const rel = await get(`https://firebaserules.googleapis.com/v1/projects/${project}/releases`, token);
      if (rel.status !== 200) noAccess('A3', rel, 'GET firebaserules releases');
      else {
        let fj = {};
        try { fj = JSON.parse(fs.readFileSync(path.join(repo, 'firebase.json'), 'utf8')); } catch { /* none */ }
        const local = [];
        const fsRules = fj.firestore && !Array.isArray(fj.firestore) ? fj.firestore.rules : undefined;
        if (fsRules) local.push({ kind: 'firestore', file: fsRules, match: (n) => n.endsWith('/releases/cloud.firestore') });
        const st = Array.isArray(fj.storage) ? fj.storage[0] : fj.storage;
        if (st?.rules) local.push({ kind: 'storage', file: st.rules, match: (n) => /\/releases\/firebase\.storage\//.test(n) });
        if (!local.length) nok('A3', `no firestore/storage rules path in ${path.join(repo, 'firebase.json')}`);
        else {
          const problems = []; const good = [];
          for (const l of local) {
            const release = (rel.body.releases || []).find((x) => l.match(x.name));
            if (!release) { problems.push(`${l.kind}: no deployed release`); continue; }
            const rs = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`, token);
            if (rs.status !== 200) { problems.push(`${l.kind}: cannot read ruleset (HTTP ${rs.status})`); continue; }
            let src;
            try { src = fs.readFileSync(path.join(repo, l.file), 'utf8'); } catch { problems.push(`${l.kind}: repo file ${l.file} unreadable`); continue; }
            const live = (rs.body.source?.files || []).map((x) => x.content).join('\n');
            if (norm(live) === norm(src)) good.push(`${l.kind} ${sha(src)}`); else problems.push(`${l.kind}: deployed ${sha(live)} != repo ${sha(src)}`);
          }
          if (problems.some((p) => /deployed .* != repo|no deployed release/.test(p))) add('A3', 'FAIL', problems.join('; '));
          else if (problems.length) nok('A3', problems.join('; '));
          else add('A3', 'PASS', `deployed rules equal the repo's: ${good.join(', ')}`);
        }
      }
    } catch (e) { nok('A3', `request failed: ${e.message}`); }
  }
  // A4/A5 key probes: the web API key comes from Hosting's init.json (public by design).
  let key; let keyWhy; let siteUrl = opts.siteUrl || `https://${project}.web.app`;
  try {
    const r = await get(`${siteUrl}/__/firebase/init.json`);
    key = r.body.apiKey;
    if (!key) throw new Error(`HTTP ${r.status}, no apiKey`);
  } catch (e) { key = undefined; keyWhy = `cannot read the web API key from ${siteUrl}/__/firebase/init.json (${e.message}); pass --site-url`; }
  const probe = (referer) => post(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${key}`, null, { identifier: 'standards-audit-probe@example.invalid', continueUri: 'http://localhost' }, referer ? { referer } : {});
  if (!key) { nok('A4', keyWhy); nok('A5', keyWhy); } else {
    try {
      const noRef = await probe(null);
      if (noRef.status === 403) add('A5', 'PASS', 'web API key is referrer-restricted (request without Referer got 403)');
      else if (noRef.status === 200) add('A5', 'FAIL', 'web API key accepts requests with no Referer (not referrer-restricted)');
      else nok('A5', `unexpected HTTP ${noRef.status} from the no-Referer probe`);
      const withRef = await probe(`${siteUrl}/`);
      if (withRef.status === 200) {
        if (Object.hasOwn(withRef.body, 'registered')) add('A4', 'FAIL', 'createAuthUri answers `registered`: email enumeration protection is off');
        else add('A4', 'PASS', 'createAuthUri answers without `registered`: email enumeration protection is on');
      } else if (withRef.body?.error?.message === 'EMAIL_EXISTS' || /ENUMERATION/.test(withRef.body?.error?.message || '')) add('A4', 'PASS', `createAuthUri refuses the lookup (${withRef.body.error.message})`);
      else nok('A4', `the allowed-referer probe got HTTP ${withRef.status}${withRef.body?.error?.message ? ` (${String(withRef.body.error.message).slice(0, 80)})` : ''}; cannot tell`);
    } catch (e) { nok('A4', `request failed: ${e.message}`); nok('A5', `request failed: ${e.message}`); }
  }
  // A6 App Check enforcement (reported; FAIL from firebase-web 2.1.0)
  if (!token) needTok('A6');
  else {
    try {
      const r = await get(`https://firebaseappcheck.googleapis.com/v1/projects/${project}/services`, token);
      if (r.status !== 200) noAccess('A6', r, 'GET appcheck services');
      else {
        const svc = (r.body.services || []).map((s) => `${String(s.name).split('/').pop()}=${s.enforcementMode || 'OFF'}`);
        const off = (r.body.services || []).filter((s) => !s.enforcementMode || s.enforcementMode === 'OFF' || s.enforcementMode === 'UNENFORCED');
        if (!svc.length || off.length) add('A6', 'WARN', `App Check not enforced: ${svc.join(', ') || 'no service configured'} (becomes FAIL in 2.1.0)`);
        else add('A6', 'PASS', `App Check enforced: ${svc.join(', ')}`);
      }
    } catch (e) { nok('A6', `request failed: ${e.message}`); }
  }
  // A7 no owner/editor on service accounts
  if (!token) needTok('A7');
  else {
    try {
      const r = await post(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`, token, {});
      if (r.status !== 200) noAccess('A7', r, 'getIamPolicy');
      else {
        const hits = [];
        for (const b of r.body.bindings || []) if (b.role === 'roles/owner' || b.role === 'roles/editor') for (const m of b.members || []) if (m.startsWith('serviceAccount:')) hits.push(`${m.slice(15)} holds ${b.role}`);
        if (hits.length) add('A7', 'FAIL', hits.join('; '));
        else add('A7', 'PASS', 'no service account holds roles/owner or roles/editor');
      }
    } catch (e) { nok('A7', `request failed: ${e.message}`); }
  }
  res.sort((a, b) => RULES.indexOf(a.rule) - RULES.indexOf(b.rule));
  return res;
}

async function main(argv) {
  const at = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const flagVals = new Set(['--repo', '--site-url']);
  const pos = argv.filter((a, i) => !a.startsWith('--') && !flagVals.has(argv[i - 1]));
  if (pos.length !== 1) { console.error('usage: firebase-audit.mjs <project> [--repo <dir>] [--site-url <url>] [--json]'); return 2; }
  const res = await audit(pos[0], { repo: at('--repo') || process.cwd(), siteUrl: at('--site-url') });
  if (argv.includes('--json')) console.log(JSON.stringify(res, null, 2));
  else {
    for (const r of res) console.log(`${r.state.padEnd(8)} ${r.rule}  ${r.what}`);
    const n = res.filter((r) => r.state === 'FAIL').length;
    console.log(n ? `firebase-audit: ${n} failure(s)` : 'firebase-audit: no failures (SKIP/DEFERRED rules were not verified)');
  }
  return res.some((r) => r.state === 'FAIL') ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`firebase-audit: ${e.message}`); process.exitCode = 2; });
