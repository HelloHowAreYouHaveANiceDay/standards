#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile stripe); do not edit -- re-run sync.
// Zero dependencies, offline, no credentials. Checks a repo that takes Stripe payments for the mistakes that
// ship silently: key material in git or built assets, secrets in plain config vars, secret names exposed to the
// browser, webhooks without signature checks, a server that would run on a full-access key, unreviewable key
// scope, buyer identity in metadata, hardcoded price ids. Standard: kit docs/stripe.md; rules: RULES.md here.
//
//   node .standards/stripe/lint.mjs [repo-root]
//
// Findings print `standards: FAIL|WARN [stripe/S<n>] <file>[:<line>]: <what> (fix: ...)`. A secret value is
// NEVER printed -- only where it is. WARN does not fail the gate.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CODE = /\.(m?[jt]sx?|c[jt]s|vue|svelte|astro|go|py|rb)$/;
const TEST = /(^|\/)(tests?|__tests__|__mocks__|spec|e2e|fixtures?|testdata)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$/;
const SKIP = /(^|\/)(node_modules|\.standards|vendor|\.git)\//;
const BUILT = ['dist', 'build', 'out', '.output', '.vercel/output', '.svelte-kit/output', '.wrangler/deploy'];
const MAX = 5_000_000;

// S1: key material. Real keys are long (sk_live_ + 99, whsec_ + 32); 20+ chars skips obvious fakes like whsec_test.
const KEY_RE = [
  ['secret or restricted API key', /\b[sr]k_(live|test)_[0-9A-Za-z]{20,}/],
  ['webhook signing secret', /\bwhsec_[0-9A-Za-z+/=]{20,}/],
];
const FAKE_OK = /standards:\s*fake-stripe-key\s+--\s*\S/;

// S2: names that must only ever be Worker / Firebase secrets.
const SECRET_NAME = /^STRIPE_[A-Z0-9_]*(SECRET|RESTRICTED|WEBHOOK)[A-Z0-9_]*$|^[A-Z0-9_]*STRIPE[A-Z0-9_]*(SECRET_KEY|WEBHOOK_SECRET)$/;
const SECRET_VALUE = /^\s*(sk_|rk_|whsec_)/;
// S3: env prefixes that bundlers inline into browser code.
const PUBLIC_SECRET = /\b(VITE|PUBLIC|NEXT_PUBLIC|REACT_APP|EXPO_PUBLIC|GATSBY|NUXT_PUBLIC|VUE_APP)_[A-Z0-9_]*STRIPE[A-Z0-9_]*(SECRET|RESTRICTED|WEBHOOK)[A-Z0-9_]*/;
// S4: webhook handling and verification.
const SIG_HEADER = /['"`]stripe-signature['"`]/i;
const VERIFY = /\bconstructEvent(Async)?\s*\(|\bverify\w*Signature\s*\(|\bwebhooks?\.(verify|construct)\w*\s*\(|\bWebhook\.construct_event\s*\(|\bwebhook\.ConstructEvent\w*\s*\(/;
const EVENT_LIT = /['"`](checkout\.session\.(completed|expired|async_payment_[a-z]+)|payment_intent\.(succeeded|payment_failed|canceled)|charge\.(refunded|succeeded|failed|dispute\.[a-z_]+)|invoice\.(paid|payment_[a-z]+|finalized)|customer\.subscription\.[a-z_]+)['"`]/;
// S5: the server refuses a full-access key.
const KEY_USE = /\bSTRIPE_SECRET_KEY\b/;
const RK_GUARD = /(['"`(^]|\^)rk_|startsWith\(\s*['"`]sk_/;
// S6: Stripe API endpoints the code calls.
const STRIPE_HOST = /api\.stripe\.com|\bSTRIPE_API\b|from\s+['"]stripe['"]|require\(\s*['"]stripe['"]\s*\)|^\s*import\s+stripe\b|github\.com\/stripe\/stripe-go/m;
const V1_PATH = /['"`](?:https:\/\/api\.stripe\.com|\$\{[A-Za-z_.]+\})?(\/v1\/[A-Za-z0-9_/{}$.-]+)/g;
const SDK_CALL = /\bstripe\.((?:[a-zA-Z]+\.)*[a-zA-Z]+)\.(create|retrieve|update|list|del|cancel|expire|search|confirm|capture|listLineItems)\s*\(/g;
// S7: buyer identity in metadata.
const PII_META = /metadata\[(email|customer_email|e_mail|name|full_name|first_name|last_name|phone)\]|metadata\s*:\s*\{[^}]*\b(email|customer_email|phone|full_name)\s*:/i;
// S8: price ids belong in config.
const PRICE_ID = /\bprice_[A-Za-z0-9]{14,}\b/;
const CONFIG_FILE = /(^|\/)(wrangler\.(toml|jsonc?)|[^/]*\.config\.[a-z]+|config\/[^/]+|\.env\.(template|example|sample)|stripe\.scope\.json)$|\.md$/;

const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function tracked(root) {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${(r.stderr || '').trim()}`);
  return r.stdout.split('\0').filter(Boolean);
}

function readText(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX) return null;
    const buf = fs.readFileSync(abs);
    return buf.includes(0) ? null : buf.toString('utf8');
  } catch { return null; }
}

function walkDir(root, rel) {
  const out = [];
  let ents;
  try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...walkDir(root, r)); else if (e.isFile()) out.push(r);
  }
  return out;
}

// Stripe API paths a source file calls: /v1/... literals (fetch clients) and stripe.<resource>.<verb>( (SDKs).
export function endpointsIn(text) {
  const out = new Set();
  for (const m of text.matchAll(V1_PATH)) {
    let p = m[1].replace(/\$\{[^}]*\}?/g, '{id}').replace(/\{[^}/]*\}/g, '{id}').replace(/\/+$/, '');
    if (p.includes('$')) p = p.slice(0, p.indexOf('$')).replace(/\/+$/, '');
    if (p.length > 4) out.add(p);
  }
  for (const m of text.matchAll(SDK_CALL)) {
    const res = m[1].split('.').map(snake).join('/');
    out.add(['retrieve', 'update', 'del', 'cancel', 'expire', 'confirm', 'capture', 'listLineItems'].includes(m[2]) ? `/v1/${res}/{id}` : `/v1/${res}`);
  }
  return [...out];
}

// "GET /v1/checkout/sessions/{id}" or "/v1/checkout/sessions/*" -> matcher on the path part; {id} and * match one segment.
export function allowMatcher(entries) {
  const res = entries.map((e) => {
    const p = String(e).trim().split(/\s+/).pop();
    return new RegExp(`^${p.replace(/[.+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]*\}|\*/g, '[^/]+')}$`);
  });
  return (p) => res.some((re) => re.test(p.replace(/\{id\}/g, 'x')) || re.test(p));
}

// wrangler.toml: [vars] / [env.<name>.vars] keys, with line numbers. Enough TOML for `KEY = "value"` lines.
export function tomlVars(text) {
  const out = [];
  let table = '';
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '').trim();
    const t = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (t) { table = t[1].replace(/["']/g, ''); return; }
    if (!/^(vars|env\.[^.]+\.vars)$/.test(table)) {
      const inline = /^vars\s*=\s*\{(.*)\}/.exec(line);
      if (!inline) return;
      for (const kv of inline[1].split(',')) {
        const m = /^\s*"?([A-Za-z0-9_]+)"?\s*=\s*(.*)$/.exec(kv);
        if (m) out.push({ key: m[1], value: m[2].replace(/^["']|["']$/g, ''), line: i + 1 });
      }
      return;
    }
    const m = /^"?([A-Za-z0-9_]+)"?\s*=\s*(.*)$/.exec(line);
    if (m) out.push({ key: m[1], value: m[2].replace(/^["']|["']$/g, ''), line: i + 1 });
  });
  return out;
}

function jsonVars(text) {
  const src = text.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, s) => s || '').replace(/,(\s*[}\]])/g, '$1');
  const cfg = JSON.parse(src);
  const out = [];
  const add = (vars, where) => { for (const [k, v] of Object.entries(vars || {})) out.push({ key: k, value: typeof v === 'string' ? v : '', line: 0, where }); };
  add(cfg.vars, 'vars');
  for (const [n, e] of Object.entries(cfg.env || {})) add(e && e.vars, `env.${n}.vars`);
  return out;
}

export function lint(root) {
  const fails = [];
  const warns = [];
  const fail = (rule, where, what) => fails.push(`standards: FAIL [stripe/${rule}] ${where}: ${what}`);
  const warn = (rule, where, what) => warns.push(`standards: WARN [stripe/${rule}] ${where}: ${what}`);
  const files = tracked(root).filter((f) => !SKIP.test(`${f}`) && !f.startsWith('.standards/'));
  const text = new Map();
  const get = (f) => { if (!text.has(f)) text.set(f, readText(path.join(root, ...f.split('/')))); return text.get(f); };

  // S1 key material in tracked files and in built output on disk (tracked or not: it is what deploys).
  const scanKeys = (f, t, built) => {
    t.split('\n').forEach((line, i) => {
      if (!built && FAKE_OK.test(line)) return;
      for (const [what, re] of KEY_RE) {
        if (re.test(line)) fail('S1', `${f}:${i + 1}`, `${built ? 'built asset contains' : 'tracked file contains'} a Stripe ${what} (fix: remove it, rotate the key now, keep values in the wiki .env and Worker/Firebase secrets only)`);
      }
    });
  };
  for (const f of files) { const t = get(f); if (t) scanKeys(f, t, false); }
  const trackedSet = new Set(files);
  for (const d of BUILT) {
    for (const f of walkDir(root, d)) {
      if (trackedSet.has(f)) continue;
      const t = readText(path.join(root, ...f.split('/')));
      if (t) scanKeys(f, t, true);
    }
  }

  // S2 secrets only as secrets: not in wrangler vars, not in tracked env files.
  for (const f of files) {
    const base = path.posix.basename(f);
    let vars = null;
    try {
      if (base === 'wrangler.toml') vars = tomlVars(get(f) || '');
      else if (/^wrangler\.jsonc?$/.test(base)) vars = jsonVars(get(f) || '{}');
    } catch (e) { fail('S2', f, `does not parse (${e.message})`); }
    for (const v of vars || []) {
      if (SECRET_NAME.test(v.key) || SECRET_VALUE.test(v.value)) {
        fail('S2', v.line ? `${f}:${v.line}` : f, `${v.key} is a plain var; plain vars are readable by anyone with dashboard or repo access and print in deploy output (fix: delete it, then \`wrangler secret put ${v.key}\` / CF API PUT secret)`);
      }
    }
    if (/(^|\/)(\.dev\.vars|\.env(\.[^/]*)?|\.runtimeconfig\.json|\.secret\.local)$/.test(f) && !/\.(template|example|sample)$/.test(f)) {
      const t = get(f) || '';
      if (/STRIPE|sk_|rk_|whsec_/i.test(t)) fail('S2', f, 'a tracked env/secrets file mentions Stripe (fix: git rm --cached it, add it to .gitignore, rotate any key it held; keep only .env.template with names)');
    }
  }

  // S3 nothing but pk_ reaches the browser: no secret-looking Stripe name behind a client-inlined prefix.
  for (const f of files) {
    const t = get(f);
    if (!t) continue;
    t.split('\n').forEach((line, i) => {
      const m = PUBLIC_SECRET.exec(line);
      if (m) fail('S3', `${f}:${i + 1}`, `${m[0]} is inlined into browser bundles by its prefix (fix: drop the public prefix; only the publishable pk_ key may be public)`);
    });
  }

  const code = files.filter((f) => CODE.test(f) && !TEST.test(f));
  const usesStripe = code.filter((f) => { const t = get(f); return t && (STRIPE_HOST.test(t) || KEY_USE.test(t) || SIG_HEADER.test(t)); });

  // S4 every webhook handler verifies the signature.
  let handlers = 0;
  for (const f of code) {
    const t = get(f);
    if (!t || !SIG_HEADER.test(t)) continue;
    handlers++;
    if (!VERIFY.test(t)) fail('S4', f, 'reads the Stripe-Signature header but calls no verification (fix: constructEvent / constructEventAsync on the raw body, or the cmfz verifyStripeSignature, before parsing the event)');
  }
  if (!handlers) {
    // Only files that talk to Stripe or are named like a webhook: `"invoice.id"` in a UI file is not an event.
    const ev = code.find((f) => (usesStripe.includes(f) || /webhook/i.test(f)) && EVENT_LIT.test(get(f) || ''));
    if (ev) fail('S4', ev, 'handles Stripe event types but no source file reads the Stripe-Signature header (fix: verify the signature on the raw body before trusting the event)');
  }

  // S5 the server fails closed on a full-access key.
  const keyFiles = code.filter((f) => KEY_USE.test(get(f) || ''));
  if (keyFiles.length && !code.some((f) => RK_GUARD.test(get(f) || ''))) {
    fail('S5', keyFiles[0], 'uses STRIPE_SECRET_KEY but no code checks it is a restricted rk_ key (fix: refuse to call Stripe unless the key starts with rk_live_/rk_test_; log only the prefix)');
  }

  // S6 the endpoints the code calls are declared, so the restricted key's scope is reviewable.
  const called = new Map();
  for (const f of usesStripe) for (const p of endpointsIn(get(f))) if (!called.has(p)) called.set(p, f);
  if (called.size) {
    let scope = null;
    try { scope = JSON.parse(get('stripe.scope.json') || 'null'); } catch (e) { fail('S6', 'stripe.scope.json', `does not parse (${e.message})`); scope = undefined; }
    if (scope === null) fail('S6', 'stripe.scope.json', `missing; the code calls ${[...called.keys()].join(', ')} (fix: add stripe.scope.json: { "key": "<wiki .env name>", "permissions": [...], "endpoints": [...] })`);
    else if (scope && (!Array.isArray(scope.endpoints) || typeof scope.key !== 'string' || !Array.isArray(scope.permissions))) fail('S6', 'stripe.scope.json', 'needs "key" (string), "permissions" (list) and "endpoints" (list)');
    else if (scope) {
      const ok = allowMatcher(scope.endpoints);
      for (const [p, f] of called) if (!ok(p)) warn('S6', f, `calls ${p}, which stripe.scope.json does not declare (fix: declare it, and widen the restricted key only if Stripe 403s)`);
    }
  }

  // S7 no buyer identity in metadata (metadata is readable by every key with read on the object, and copies to exports).
  for (const f of code) {
    (get(f) || '').split('\n').forEach((line, i) => {
      if (PII_META.test(line)) fail('S7', `${f}:${i + 1}`, 'puts buyer identity (email/name/phone) in Stripe metadata (fix: Stripe already holds customer_details; keep metadata to the property tag and the purchased subject)');
    });
  }

  // S8 price ids come from config, so live and test ids cannot cross.
  for (const f of code) {
    if (CONFIG_FILE.test(f)) continue;
    (get(f) || '').split('\n').forEach((line, i) => {
      if (PRICE_ID.test(line)) warn('S8', `${f}:${i + 1}`, 'hardcoded Stripe price id (fix: read it from a Worker secret/var or site config per environment)');
    });
  }

  return { fails, warns, stripe: usesStripe.length > 0 };
}

export function main(root = process.cwd()) {
  const { fails, warns, stripe } = lint(root);
  for (const l of [...fails, ...warns]) console.log(l);
  if (fails.length) console.log(`standards: stripe: ${fails.length} finding(s)${warns.length ? `, ${warns.length} warning(s)` : ''}`);
  else console.log(`standards: [stripe/lint] OK${stripe ? '' : ' (no Stripe calls found)'}${warns.length ? ` with ${warns.length} warning(s)` : ''}`);
  return fails.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
