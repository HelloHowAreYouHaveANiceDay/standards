// stripe fixture: a Cloudflare Worker checkout follower that passes lint.mjs, plus injected defects (S1 S2 S4 S5 S6)
// each failing check.mjs naming the file. lint.mjs is offline and zero-dep, so no downloads.
import fs from 'node:fs';
import path from 'node:path';

const STRIPE_TS = `export const STRIPE_API = "https://api.stripe.com";
export function assertRestricted(key: string | undefined): void {
  if (!/^rk_(live|test)_/.test(key ?? "")) throw new Error("STRIPE_SECRET_KEY must be a restricted rk_ key");
}
export const createSession = (env: { STRIPE_SECRET_KEY?: string }) => {
  assertRestricted(env.STRIPE_SECRET_KEY);
  return fetch(\`\${STRIPE_API}/v1/checkout/sessions\`, { method: "POST" });
};
`;
const HOOK_TS = `import { verifyStripeSignature } from "./verify.ts";
export async function webhook(req: Request, env: { STRIPE_WEBHOOK_SECRET: string }): Promise<Response> {
  const raw = await req.text();
  if (!(await verifyStripeSignature(raw, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET))) return new Response("", { status: 400 });
  return new Response("ok");
}
`;
const SCOPE = '{\n  "key": "STG_STRIPE_CHECKOUT_KEY",\n  "permissions": ["Checkout Sessions: Write"],\n  "endpoints": ["POST /v1/checkout/sessions"]\n}\n';

export const fixture = {
  id: 'stripe',
  profiles: ['base@1.0.0', 'stripe@1.0.0'],
  files: {
    'wrangler.toml': 'name = "fixture"\n\n[vars]\nREPORT_SALES_ENABLED = "0"\n',
    'stripe.scope.json': SCOPE,
    'src/stripe.ts': STRIPE_TS,
    'src/webhook.ts': HOOK_TS,
  },
  inject: (dir, h) => {
    const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    const keep = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
    const bites = (msg, re, rel, text, tracked = true) => {
      const before = fs.existsSync(path.join(dir, rel)) ? keep(rel) : null;
      w(rel, text);
      if (tracked) h.git('add', '-A');
      const r = h.check();
      h.step(r.code === 1 && re.test(r.out), msg, r.out);
      if (before === null) { fs.rmSync(path.join(dir, rel)); if (tracked) h.git('add', '-A'); } else { w(rel, before); if (tracked) h.git('add', '-A'); }
    };
    const key = ['rk', 'live', 'Zz9'.repeat(8)].join('_');
    bites('stripe: a restricted key in a tracked file fails S1', /FAIL \[stripe\/S1\] src\/k\.ts:1/, 'src/k.ts', `export const k = "${key}";\n`);
    bites('stripe: a restricted key in untracked dist/ fails S1', /FAIL \[stripe\/S1\] dist\/a\.js:1: built asset/, 'dist/a.js', `var k="${key}";\n`, false);
    bites('stripe: STRIPE_SECRET_KEY in [vars] fails S2', /FAIL \[stripe\/S2\] wrangler\.toml:5: STRIPE_SECRET_KEY/, 'wrangler.toml', 'name = "fixture"\n\n[vars]\nREPORT_SALES_ENABLED = "0"\nSTRIPE_SECRET_KEY = "x"\n');
    bites('stripe: an unverified webhook fails S4', /FAIL \[stripe\/S4\] src\/webhook\.ts/, 'src/webhook.ts', HOOK_TS.replace(/verifyStripeSignature/g, 'trustIt'));
    bites('stripe: no rk_ guard fails S5', /FAIL \[stripe\/S5\]/, 'src/stripe.ts', STRIPE_TS.replace('/^rk_(live|test)_/', '/./'));
    bites('stripe: a broken stripe.scope.json fails S6', /FAIL \[stripe\/S6\] stripe\.scope\.json: does not parse/, 'stripe.scope.json', 'not json');
  },
};
