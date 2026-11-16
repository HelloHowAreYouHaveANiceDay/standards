// stripe 1.0.0: lint.mjs passing and failing cases per rule S1-S8, and stripe-audit.mjs's pure webhook findings.
// Every fake key here is built at runtime so this file itself never contains a key-shaped literal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir, node, git } from './helpers.mjs';

const DIR = process.env.STRIPE_SRC ? path.join(KIT_ROOT, 'src/profiles/stripe') : path.join(KIT_ROOT, 'profiles/stripe/1.0.0');
const LINT = path.join(DIR, '.standards/stripe/lint.mjs');
const l = await import(pathToFileURL(LINT).href);
const a = await import(pathToFileURL(path.join(KIT_ROOT, 'scripts/stripe-audit.mjs')).href);

const FAKE = (p) => `${p}${'A1b2C3d4'.repeat(4)}`;
const SK = FAKE(['sk', 'live', ''].join('_'));
const RK = FAKE(['rk', 'live', ''].join('_'));
const WH = FAKE(['whsec', ''].join('_'));

const STRIPE_TS = `export const STRIPE_API = "https://api.stripe.com";
export function guard(env) { if (!/^rk_(live|test)_/.test(env.STRIPE_SECRET_KEY ?? "")) throw new Error("not a restricted key"); }
export const create = (env) => fetch(\`\${STRIPE_API}/v1/checkout/sessions\`, { method: "POST" });
export const get = (env, id) => fetch(\`\${STRIPE_API}/v1/checkout/sessions/\${id}\`);
`;
const HOOK_TS = `import { verifyStripeSignature } from "./stripe.ts";
export async function hook(req, env) {
  const raw = await req.text();
  const ok = await verifyStripeSignature(raw, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response("bad", { status: 400 });
  const ev = JSON.parse(raw);
  if (ev.type === "checkout.session.completed") return new Response("ok");
}
`;
const SCOPE = JSON.stringify({ key: 'STG_STRIPE_CHECKOUT_KEY', permissions: ['Checkout Sessions: Write'], endpoints: ['POST /v1/checkout/sessions', 'GET /v1/checkout/sessions/{id}'] });
const WRANGLER = 'name = "x"\n\n[vars]\nREPORT_SALES_ENABLED = "1"\n\n[env.preview.vars]\nREPORT_SALES_ENABLED = "1"\n';

function repo(over = {}) {
  const r = tmpdir('stripe-lint-');
  git(r, 'init', '-q', '-b', 'main');
  const files = { 'src/stripe.ts': STRIPE_TS, 'src/webhook.ts': HOOK_TS, 'stripe.scope.json': SCOPE, 'wrangler.toml': WRANGLER, ...over };
  for (const [f, t] of Object.entries(files)) {
    if (t === null) continue;
    fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true });
    fs.writeFileSync(path.join(r, f), t);
  }
  git(r, 'add', '-A');
  return r;
}
const run = (over) => l.lint(repo(over));
const has = (list, re) => list.some((x) => re.test(x));

test('a clean follower passes and the CLI exits 0', () => {
  const r = repo();
  const out = l.lint(r);
  assert.deepEqual(out.fails, []);
  assert.deepEqual(out.warns, []);
  const c = node([LINT, r]);
  assert.equal(c.code, 0, c.out);
  assert.match(c.out, /\[stripe\/lint\] OK/);
});

test('a repo with no Stripe code passes', () => {
  const out = run({ 'src/stripe.ts': null, 'src/webhook.ts': null, 'stripe.scope.json': null, 'src/ui.vue': '<td>{{ row["invoice.id"] }}</td>\n' });
  assert.deepEqual(out.fails, []);
  assert.equal(out.stripe, false);
});

test('S1: live/test/restricted keys and whsec in tracked files fail without printing the value; fake marker allows', () => {
  for (const k of [SK, RK, WH]) {
    const out = run({ 'src/config.ts': `export const k = "${k}";\n` });
    assert.ok(has(out.fails, /\[stripe\/S1\] src\/config\.ts:1: tracked file contains a Stripe/), out.fails.join('\n'));
    assert.ok(!out.fails.join('\n').includes(k), 'never prints the key');
  }
  assert.deepEqual(run({ 'src/x.test.ts': `const k = "${WH}"; // standards: fake-stripe-key -- signature test vector\n` }).fails, []);
  assert.deepEqual(run({ 'src/x.ts': 'const k = "whsec_test";\n' }).fails, [], 'short fakes are not keys');
});

test('S1: a key in untracked built output (dist/) fails', () => {
  const r = repo();
  fs.mkdirSync(path.join(r, 'dist/assets'), { recursive: true });
  fs.writeFileSync(path.join(r, 'dist/assets/app.js'), `var k="${RK}";`);
  assert.ok(has(l.lint(r).fails, /\[stripe\/S1\] dist\/assets\/app\.js:1: built asset contains/));
});

test('S2: secret names or key values in wrangler vars fail; tracked .dev.vars fails', () => {
  assert.ok(has(run({ 'wrangler.toml': `${WRANGLER}\n[vars]\nSTRIPE_SECRET_KEY = "x"\n` }).fails, /\[stripe\/S2\] wrangler\.toml:10: STRIPE_SECRET_KEY is a plain var/));
  assert.ok(has(run({ 'wrangler.toml': 'name = "x"\n[env.preview.vars]\nSTRIPE_WEBHOOK_SECRET = "y"\n' }).fails, /wrangler\.toml:3: STRIPE_WEBHOOK_SECRET/));
  assert.ok(has(run({ 'wrangler.toml': 'name = "x"\n[vars]\nPAY_KEY = "rk_live_x"\n' }).fails, /PAY_KEY is a plain var/));
  assert.ok(has(run({ 'wrangler.jsonc': '{ // c\n "vars": { "STRIPE_SECRET_KEY": "x" },\n}\n', 'wrangler.toml': null }).fails, /\[stripe\/S2\] wrangler\.jsonc: STRIPE_SECRET_KEY/));
  assert.deepEqual(run({ 'wrangler.toml': 'name = "x"\n[vars]\nSTRIPE_PUBLISHABLE_KEY = "pk_live_x"\n# STRIPE_SECRET_KEY is a secret\n' }).fails, []);
  assert.ok(has(run({ '.dev.vars': 'STRIPE_SECRET_KEY=x\n' }).fails, /\[stripe\/S2\] \.dev\.vars: a tracked env/));
  assert.deepEqual(run({ '.env.template': 'STRIPE_SECRET_KEY=\n' }).fails, []);
});

test('S3: a client-inlined prefix on a Stripe secret name fails', () => {
  assert.ok(has(run({ 'src/app.ts': 'const k = import.meta.env.VITE_STRIPE_SECRET_KEY;\n' }).fails, /\[stripe\/S3\] src\/app\.ts:1: VITE_STRIPE_SECRET_KEY/));
  assert.deepEqual(run({ 'src/app.ts': 'const k = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;\n' }).fails, []);
});

test('S4: a handler that reads Stripe-Signature without verifying fails; events with no handler fail', () => {
  assert.ok(has(run({ 'src/webhook.ts': HOOK_TS.replace(/verifyStripeSignature\(/g, 'check(') }).fails, /\[stripe\/S4\] src\/webhook\.ts: reads the Stripe-Signature header/));
  assert.ok(has(run({ 'src/webhook.ts': 'export async function h(req){ const ev = await req.json(); if (ev.type === "checkout.session.completed") return 1; }\n' }).fails, /\[stripe\/S4\] src\/webhook\.ts: handles Stripe event types/));
  assert.deepEqual(run({ 'src/webhook.ts': 'const e = stripe.webhooks.constructEvent(raw, req.headers["stripe-signature"], s);\n' }).fails, []);
});

test('S5: STRIPE_SECRET_KEY without an rk_ guard fails', () => {
  assert.ok(has(run({ 'src/stripe.ts': STRIPE_TS.replace(/^export function guard.*$/m, '') + 'export const h = (env) => env.STRIPE_SECRET_KEY;\n' }).fails, /\[stripe\/S5\] src\/stripe\.ts: uses STRIPE_SECRET_KEY but no code checks/));
});

test('S6: missing scope file fails; undeclared endpoint warns; SDK calls are mapped', () => {
  assert.ok(has(run({ 'stripe.scope.json': null }).fails, /\[stripe\/S6\] stripe\.scope\.json: missing; the code calls \/v1\/checkout\/sessions, \/v1\/checkout\/sessions\/\{id\}/));
  assert.ok(has(run({ 'stripe.scope.json': '{"key":"K"}' }).fails, /S6\] stripe\.scope\.json: needs "key"/));
  const w = run({ 'src/refund.ts': 'export const r = (env) => fetch(`${STRIPE_API}/v1/refunds`, { method: "POST" }); // api.stripe.com\n' });
  assert.deepEqual(w.fails, []);
  assert.ok(has(w.warns, /\[stripe\/S6\] src\/refund\.ts: calls \/v1\/refunds, which stripe\.scope\.json does not declare/));
  assert.deepEqual(l.endpointsIn('import Stripe from "stripe"; stripe.billingPortal.sessions.create({}); stripe.paymentIntents.retrieve(id);').sort(), ['/v1/billing_portal/sessions', '/v1/payment_intents/{id}']);
  assert.ok(l.allowMatcher(['GET /v1/checkout/sessions/*'])('/v1/checkout/sessions/{id}'));
  assert.ok(!l.allowMatcher(['/v1/checkout/sessions'])('/v1/customers'));
});

test('S7: buyer identity in metadata fails; the purchased subject passes', () => {
  assert.ok(has(run({ 'src/m.ts': 'f.set("metadata[email]", email);\n' }).fails, /\[stripe\/S7\] src\/m\.ts:1/));
  assert.ok(has(run({ 'src/m.ts': 'const s = { metadata: { property: "x", email: e } };\n' }).fails, /\[stripe\/S7\]/));
  assert.deepEqual(run({ 'src/m.ts': 'f.set("metadata[address]", a); f.set("metadata[property]", "cmfz");\n' }).fails, []);
});

test('S8: a hardcoded price id warns in source, not in config', () => {
  const id = `price_${'1Abc'.repeat(5)}`;
  assert.ok(has(run({ 'src/p.ts': `const p = "${id}";\n` }).warns, /\[stripe\/S8\] src\/p\.ts:1/));
  assert.deepEqual(run({ 'site.config.ts': `export const price = "${id}";\n` }).warns, []);
});

test('tomlVars reads [vars], [env.x.vars] and inline vars, ignores other tables', () => {
  const v = a && l.tomlVars('[vars]\nA = "1"\n[d1]\nB = "2"\n[env.p.vars]\nC = "3"\n[env.q]\nvars = { D = "4" }\n');
  assert.deepEqual(v.map((x) => x.key), ['A', 'C', 'D']);
});

test('audit: duplicate enabled URLs, live workers.dev, disabled or missing .env ids, orphans', () => {
  const eps = [
    { id: 'we_1', url: 'https://a.com/api/stripe-webhook', status: 'enabled' },
    { id: 'we_2', url: 'https://a.com/api/stripe-webhook', status: 'enabled' },
    { id: 'we_3', url: 'https://b.com/api/stripe-webhook', status: 'disabled' },
    { id: 'we_4', url: 'https://x.y.workers.dev/api/stripe-webhook', status: 'enabled' },
  ];
  const known = new Map([['we_1', 'A_PROD_STRIPE_WEBHOOK_ID'], ['we_3', 'B_PROD_STRIPE_WEBHOOK_ID'], ['we_9', 'C_PROD_STRIPE_WEBHOOK_ID']]);
  const f = a.webhookFindings('live', eps, known).map((x) => `${x.level} ${x.what}`);
  assert.ok(has(f, /^FAIL live: 2 enabled endpoints for https:\/\/a\.com/));
  assert.ok(has(f, /^FAIL live: we_4 posts to x\.y\.workers\.dev/));
  assert.ok(has(f, /^FAIL live: B_PROD_STRIPE_WEBHOOK_ID names we_3, which is disabled/));
  assert.ok(has(f, /^FAIL live: C_PROD_STRIPE_WEBHOOK_ID names we_9, which does not exist/));
  assert.ok(has(f, /^WARN live: enabled endpoint we_2/));
  assert.ok(!has(a.webhookFindings('test', [eps[3]], new Map([['we_4', 'X_SANDBOX_STRIPE_WEBHOOK_ID']])).map((x) => x.what), /workers\.dev/), 'sandbox may use workers.dev');
  assert.equal(a.keyClass(RK), 'restricted');
  assert.equal(a.keyClass(SK), 'full');
  assert.equal(a.keyMode(SK), 'live');
  assert.deepEqual(a.parseEnv('# c\nA=1\nexport B="two"\n'), { A: '1', B: 'two' });
});
