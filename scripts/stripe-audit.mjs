#!/usr/bin/env node
// Live Stripe audit (docs/stripe.md section 9). Read-only: every request is a GET. Run from the harness, never in CI.
// It needs live credentials, and its findings describe the account, not a commit.
//
//   node scripts/stripe-audit.mjs --env H:/working/wiki/.env [--json] [--no-workers] [--no-webhooks]
//
// Reads values by NAME from the env file (or process.env when --env is absent). It prints names, ids, URLs and
// statuses, NEVER a key or secret value.
//
//   1. keys      every *_KEY / *_SECRET_KEY name in the file whose value is sk_/rk_ (provisioning keys excepted, see
//                PROVISIONING) is probed: GET /v1/balance must be 401/403 (a restricted key) and
//                GET /v1/checkout/sessions?limit=1 must be 200 (the scope the checkout code needs). sk_ = FAIL.
//   2. workers   Cloudflare (CF_PROVISIONING_TOKEN, else CF_TOKEN): every Worker script and its secret NAMES. Worker secrets cannot be read back,
//                by design, so the audit cannot prove which key a Worker holds. Instead it lists who holds
//                STRIPE_SECRET_KEY, and the standard closes the gap two ways: the S5 rk_ guard in code (the Worker
//                fails closed on an sk_ key) and the probe-before-PUT step in the key runbook.
//   3. webhooks  GET /v1/webhook_endpoints in live (STRIPE_PROD_SECRET_KEY) and sandbox (STRIPE_SANDBOX_SECRET_KEY):
//                FAIL on two enabled endpoints with one URL, on a live endpoint on *.workers.dev, and on a
//                <SITE>_PROD_STRIPE_WEBHOOK_ID that is missing or disabled. WARN on an enabled endpoint no .env id
//                names (an orphan or an undocumented one), and at 12 of the 16 endpoints a mode allows.
//
// Exit 0 clean, 1 findings, 2 usage or credential error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STRIPE = 'https://api.stripe.com';
const CF = 'https://api.cloudflare.com/client/v4';
const PROVISIONING = new Set(['STRIPE_PROD_SECRET_KEY', 'STRIPE_SANDBOX_SECRET_KEY']);
const ENDPOINT_CAP = 16;

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export const keyClass = (v) => (/^rk_(live|test)_/.test(v) ? 'restricted' : /^sk_(live|test)_/.test(v) ? 'full' : /^pk_/.test(v) ? 'publishable' : 'unknown');
export const keyMode = (v) => (/_live_/.test(v) ? 'live' : /_test_/.test(v) ? 'test' : '?');

// Pure: findings for one account's endpoint list. `known` maps endpoint id -> env name.
export function webhookFindings(mode, endpoints, known) {
  const out = [];
  const enabled = endpoints.filter((e) => e.status === 'enabled');
  const byUrl = new Map();
  for (const e of enabled) byUrl.set(e.url, [...(byUrl.get(e.url) || []), e.id]);
  for (const [url, ids] of byUrl) if (ids.length > 1) out.push({ level: 'FAIL', what: `${mode}: ${ids.length} enabled endpoints for ${url} (${ids.join(', ')}) -- every event is delivered twice; disable the one the Worker's whsec does not match` });
  for (const e of enabled) {
    let host = '';
    try { host = new URL(e.url).host; } catch { /* bad url */ }
    if (mode === 'live' && host.endsWith('.workers.dev')) out.push({ level: 'FAIL', what: `live: ${e.id} posts to ${host}, a workers.dev URL -- live webhooks go to the custom domain` });
    if (!known.has(e.id)) out.push({ level: 'WARN', what: `${mode}: enabled endpoint ${e.id} (${e.url}) is not named by any *_STRIPE_WEBHOOK_ID in the .env -- document it or disable it` });
  }
  if (endpoints.length >= ENDPOINT_CAP - 4) out.push({ level: 'WARN', what: `${mode}: ${endpoints.length} of ${ENDPOINT_CAP} webhook endpoints used` });
  for (const [id, name] of known) {
    if (!(mode === 'live' ? /_PROD_/.test(name) : !/_PROD_/.test(name))) continue;
    const e = endpoints.find((x) => x.id === id);
    if (!e) out.push({ level: 'FAIL', what: `${mode}: ${name} names ${id}, which does not exist` });
    else if (e.status !== 'enabled') out.push({ level: 'FAIL', what: `${mode}: ${name} names ${id}, which is ${e.status}` });
  }
  return out;
}

async function stripeGet(key, p) {
  const res = await fetch(`${STRIPE}${p}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  let body = {};
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

async function cfGet(token, p) {
  const res = await fetch(`${CF}${p}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(`Cloudflare GET ${p.replace(/\/accounts\/[^/]+/, '/accounts/<id>')}: HTTP ${res.status}`);
  return body.result;
}

export async function audit(env, opts = {}) {
  const findings = [];
  const report = { keys: [], workers: [], webhooks: {} };
  const add = (level, section, what) => findings.push({ level, section, what });

  // 1. keys
  for (const [name, v] of Object.entries(env)) {
    if (PROVISIONING.has(name) || !/(^|_)(SECRET_)?KEY$/.test(name) || !/^[sr]k_/.test(v)) continue;
    const cls = keyClass(v);
    const row = { name, class: cls, mode: keyMode(v) };
    if (cls === 'full') add('FAIL', 'keys', `${name} is a full-access ${row.mode} key; deployed keys must be restricted (rk_)`);
    const bal = await stripeGet(v, '/v1/balance');
    const cs = await stripeGet(v, '/v1/checkout/sessions?limit=1');
    Object.assign(row, { balance: bal.status, checkoutSessions: cs.status });
    if (bal.status === 200) add('FAIL', 'keys', `${name}: GET /v1/balance returned 200 -- the key can read the balance, so it is not a narrow checkout key`);
    if (bal.status === 401 || cs.status === 401) add('FAIL', 'keys', `${name}: Stripe says 401 (expired or revoked key)`);
    if (cs.status !== 200 && cs.status !== 401) add('WARN', 'keys', `${name}: GET /v1/checkout/sessions returned ${cs.status}; a checkout key needs Checkout Sessions read`);
    report.keys.push(row);
  }

  // 2. workers
  if (opts.workers !== false) {
    const cf = env.CF_PROVISIONING_TOKEN || env.CF_TOKEN; // the read-only CF_TOKEN cannot list Workers
    if (!cf) add('WARN', 'workers', 'CF_PROVISIONING_TOKEN / CF_TOKEN not set; Worker inventory skipped');
    else {
      try {
        const accounts = await cfGet(cf, '/accounts');
        for (const a of accounts) {
          const scripts = await cfGet(cf, `/accounts/${a.id}/workers/scripts`);
          if (!scripts.length) add('WARN', 'workers', `account ${a.name || a.id}: the token lists no Worker scripts (missing Workers Scripts: Read?)`);
          for (const s of scripts) {
            let names = [];
            try { names = (await cfGet(cf, `/accounts/${a.id}/workers/scripts/${s.id}/secrets`)).map((x) => x.name); } catch (e) { add('WARN', 'workers', `${s.id}: secrets not listable (${e.message})`); }
            const stripe = names.filter((n) => /STRIPE/.test(n));
            if (!stripe.length) continue;
            report.workers.push({ worker: s.id, secrets: stripe });
            if (stripe.includes('STRIPE_SECRET_KEY') && !stripe.includes('STRIPE_WEBHOOK_SECRET')) add('WARN', 'workers', `${s.id}: has STRIPE_SECRET_KEY but no STRIPE_WEBHOOK_SECRET (paid orders would rely on the thank-you lookup alone)`);
          }
        }
      } catch (e) { add('WARN', 'workers', e.message); }
    }
  }

  // 3. webhooks
  if (opts.webhooks !== false) {
    const known = new Map(Object.entries(env).filter(([n, v]) => /_STRIPE_WEBHOOK_ID$/.test(n) && /^we_/.test(v)).map(([n, v]) => [v, n]));
    for (const [mode, name] of [['live', 'STRIPE_PROD_SECRET_KEY'], ['test', 'STRIPE_SANDBOX_SECRET_KEY']]) {
      const key = env[name];
      if (!key) { add('WARN', 'webhooks', `${name} not set; ${mode} webhook audit skipped`); continue; }
      const r = await stripeGet(key, '/v1/webhook_endpoints?limit=100');
      if (r.status !== 200) { add('WARN', 'webhooks', `${mode}: GET /v1/webhook_endpoints returned ${r.status}`); continue; }
      const eps = (r.body.data || []).map((e) => ({ id: e.id, url: e.url, status: e.status, events: (e.enabled_events || []).length, description: e.description || '' }));
      report.webhooks[mode] = eps;
      for (const f of webhookFindings(mode, eps, known)) add(f.level, 'webhooks', f.what);
    }
  }
  return { findings, report };
}

async function main(argv) {
  const at = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const envPath = at('--env');
  let env = process.env;
  if (envPath) {
    try { env = parseEnv(fs.readFileSync(envPath, 'utf8')); } catch (e) { console.error(`stripe-audit: cannot read ${envPath}: ${e.code || e.message}`); return 2; }
  }
  const { findings, report } = await audit(env, { workers: !argv.includes('--no-workers'), webhooks: !argv.includes('--no-webhooks') });
  if (argv.includes('--json')) console.log(JSON.stringify({ findings, report }, null, 2));
  else {
    for (const k of report.keys) console.log(`key      ${k.name}: ${k.class} ${k.mode}; balance ${k.balance}, checkout/sessions ${k.checkoutSessions}`);
    for (const w of report.workers) console.log(`worker   ${w.worker}: ${w.secrets.join(', ')}`);
    for (const [mode, eps] of Object.entries(report.webhooks)) for (const e of eps) console.log(`webhook  ${mode} ${e.id} ${e.status} ${e.url} (${e.events} events)`);
    for (const f of findings) console.log(`${f.level.padEnd(4)}     [${f.section}] ${f.what}`);
    const n = findings.filter((f) => f.level === 'FAIL').length;
    console.log(n ? `stripe-audit: ${n} failure(s)` : 'stripe-audit: OK');
  }
  return findings.some((f) => f.level === 'FAIL') ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`stripe-audit: ${e.message}`); process.exitCode = 2; });
