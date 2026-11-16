# Stripe security standard

Applies to every STG repo that calls the Stripe API or receives Stripe webhooks: today the Cloudflare Worker checkout
sites (checkmyfloodzone, ecqualify, septicsoil, checkmysitehistory/landpast). Firebase apps (timeandmaterials,
pdfmarkuptool) adopt it when their Stripe code lands on main. Enforced offline by the `stripe` profile
(`.standards/stripe/lint.mjs`, rules S1-S8, see its RULES.md). The account side is checked by
`scripts/stripe-audit.mjs` (section 9), run from the harness. Approved key model: wiki `spec--stg-payments` (v2).

Why: on 2026-11-16, Worker renames deployed the full account key (`sk_live`) to production Workers. The code only
ever calls `POST /v1/checkout/sessions` and `GET /v1/checkout/sessions/{id}`, so the full key bought nothing and
risked everything: balance, refunds, payouts, customer data. The same move left two enabled webhook endpoints on one
URL. This standard makes the first impossible to ship silently, and makes the second visible.

## 1. Keys: restricted, scoped, one per capability

- **R1.1** A server holds a **restricted key** (`rk_live_` / `rk_test_`), never a secret key (`sk_`). Code checks the
  prefix and refuses to call Stripe on anything else. It fails closed with a 503 and logs only the prefix
  (`rk_live`/`sk_live`), never the value. [S5]
- **R1.2** The key carries only the permissions for the endpoints the code calls. The repo declares both in
  `stripe.scope.json` (key name, permissions, endpoints). Widen a key only when Stripe returns a 403 naming the
  permission, in the same PR that adds the endpoint. [S6]
- **R1.3 Decision: one key per capability, shared across products, not one key per product.** All checkout-only
  sites share `stg-stripe-checkout` (`STG_STRIPE_CHECKOUT_KEY`; Checkout Sessions: Write). A product that needs more
  (subscriptions, billing portal, refunds) gets its own second key; it never widens the shared one. This keeps spec
  `spec--stg-payments` D4/D8, which libo approved 2026-11-12.
  - Why not per product: every key is a one-time dashboard visit by libo (the API cannot mint restricted keys), and
    rotation multiplies by product count. Per-product keys only shrink the blast radius from "all checkout sessions"
    to "one site's checkout sessions". That key can create sessions and read payment intents and products; it cannot
    refund, pay out, read the balance or list customers.
  - Revisit when: a product needs a different scope (then per-capability gives it its own key anyway), a site is
    operated by someone else, or a leak happens (then cut that site to its own key during rotation).
- **R1.4** The account key (`STRIPE_PROD_SECRET_KEY`, `sk_live`) is a provisioning key. It lives only in the wiki
  `.env`. It is never a Worker secret, a GitHub secret, or a value in a CI job.
- **R1.5** Preview, dev and CI use **sandbox** keys only (`rk_test_`/`sk_test_`, `pk_test_`). Before any secret PUT,
  check that the key prefix and the API's `livemode` match the target. A `*-preview` Worker never gets a live key.

## 2. Where secrets live

- **R2.1** Values: wiki `.env` (canonical), plus Worker secrets (`wrangler secret put` / CF API) or Firebase secrets
  (`firebase functions:secrets:set`). Nowhere else.
- **R2.2** Never in: the repo (any branch, any file, tests included unless marked fake), `wrangler.toml` /
  `wrangler.jsonc` `[vars]`, `.dev.vars` / `.env` in git, GitHub Actions logs, chat, kanban cards, or built assets. [S1 S2]
- **R2.3** Names, not values, are documented. The repo's `wrangler.toml` comment and `.env.template` list
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_REPORT_PRICE_ID`, `STRIPE_PUBLISHABLE_KEY`. `stripe.scope.json`
  names the wiki `.env` entry (`STG_STRIPE_CHECKOUT_KEY`) whose value is deployed.
- **R2.4** Worker secret names are fixed: `STRIPE_SECRET_KEY` (restricted key), `STRIPE_WEBHOOK_SECRET` (that
  endpoint's `whsec_`), `STRIPE_PUBLISHABLE_KEY`, `STRIPE_<THING>_PRICE_ID`. Wiki `.env` names:
  `<SITE>_PROD_STRIPE_{PRODUCT_ID,PRICE_ID,WEBHOOK_ID,WEBHOOK_SECRET}`.
- **R2.5** Setting a secret: no trailing newline (PowerShell pipes add CRLF). Probe the key before the PUT (section 8).

## 3. The browser gets pk_ only

- **R3.1** Only the publishable key (`pk_live_`/`pk_test_`) reaches the client, served by the Worker from a config
  endpoint or inlined at build. The Worker returns it only if it starts with `pk_` (cmfz `handler.ts` `publishableKey`).
- **R3.2** No Stripe secret name carries a bundler-public prefix (`VITE_`, `PUBLIC_`, `NEXT_PUBLIC_`, ...). [S3]
- **R3.3** Built output is scanned for key material before deploy. The S1 scan reads `dist/`, `build/` and similar on
  disk, tracked or not.

## 4. Webhooks

- **R4.1** Every handler verifies `Stripe-Signature` over the **raw** body (`request.text()`) before parsing:
  `constructEventAsync`, or the cmfz `verifyStripeSignature` (HMAC-SHA256, timing-safe compare, 5-minute tolerance).
  A failed verification returns 400 and changes nothing. [S4]
- **R4.2** One `whsec_` per endpoint. Each environment has its own endpoint (live: custom domain; sandbox: the
  preview Worker). One enabled endpoint per URL.
- **R4.3** Live endpoints point at the custom domain, never `*.workers.dev`.
- **R4.4** Cutover (Worker rename or move, domain change): create the new endpoint, PUT its secret, verify a test
  event, then **disable the old endpoint the same day** and update `<SITE>_PROD_STRIPE_WEBHOOK_ID/SECRET` in the wiki
  `.env`. The audit flags two enabled endpoints on one URL and `.env` ids that point at disabled endpoints.
- **R4.5** Handlers are idempotent. Writes key on the session or payment-intent id (upsert). A replayed event changes
  nothing. Answer 2xx to events you ignore (other property, sales off). Answer 5xx only on a real write failure, so
  Stripe retries.
- **R4.6** Every endpoint receives every subscribed event. Filter on `metadata[property]` and the line-item price
  being your own. The tag is routing, not security; the signature is the gate.

## 5. Products, prices, metadata

- **R5.1** Price and product ids come from configuration per environment (a Worker secret or var such as
  `STRIPE_REPORT_PRICE_ID`, or site config). They never come from request input and are never hardcoded in source,
  so live and test ids cannot cross. [S8 warn]
- **R5.2** Metadata carries the property tag (`metadata[property]`) and the purchased subject (for example the
  report address). It never carries buyer identity: no email, name or phone. Stripe already holds
  `customer_details`; metadata is copied into exports, logs and every key with read on the object. [S7]
- **R5.3** Pin `Stripe-Version` in the client.

## 6. Logs and errors

- **R6.1** Log Stripe error codes and types, never request headers, keys, `whsec_`, client secrets or full event
  bodies. Log at most the key prefix.
- **R6.2** Never echo a Stripe error body containing request parameters back to the browser.

## 7. Rotation and incident runbook

Canonical values live in the wiki `.env`. These steps extend the runbook in `spec--stg-payments` ("Rotation and
incident") and the Hermes skill reference `everbeach-coordination/references/monetization-sizing.md`.

1. **Planned (yearly) restricted-key rotation.** libo creates the new restricted key in the dashboard with the same
   permissions and puts it in the wiki `.env` (`STG_STRIPE_CHECKOUT_KEY`). For each Worker in the audit's
   `STRIPE_SECRET_KEY` list: probe, then PUT, then create one sandbox/live session. Expire the old key after 7 days.
2. **Leak of a restricted key.** PUT the new key everywhere first, then expire the old one. If the leak is active,
   expire at once and accept a checkout gap. Read the Stripe request logs for the key window; watch disputes for 30
   days.
3. **Leak of `whsec_`.** Roll the endpoint secret (API), PUT it to that Worker, and send a test event.
4. **Full key (`sk_`) found on a Worker or in git.** Treat it as leaked: roll it in the dashboard, update the `.env`,
   PUT the restricted key to the Worker, and remove the value from history (rotation makes the old value useless;
   rewriting history is optional).
5. **Retiring a Worker** (rename, move): delete its Stripe secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) or the
   Worker itself. Disable its endpoints. A stale Worker that still holds a key is an unmonitored copy of it.

## 8. Deploy-time probe (instead of a probe endpoint)

Worker secrets cannot be read back, so no audit can prove which key a Worker holds. Considered options:

- **A probe endpoint on each Worker** that calls `/v1/balance` with its own key and reports the status. Rejected: it
  is new public attack surface on every paid site, and it needs its own auth secret.
- **Chosen: probe at the source and fail closed in code.**
  - Before any `STRIPE_SECRET_KEY` PUT, the harness probes the value it is about to set. The prefix must be `rk_`, and
    `livemode` must match the target. `GET /v1/balance` must return 403. `GET /v1/checkout/sessions?limit=1` must
    return 200.
  - The Worker refuses a non-`rk_` key at runtime (R1.1, S5). A wrong key becomes a visible 503, not a silent full
    key in production.
  - The audit lists every Worker that holds Stripe secrets, and probes every key in the `.env`.

## 9. Live audit (`scripts/stripe-audit.mjs`, harness only)

```sh
node scripts/stripe-audit.mjs --env H:/working/wiki/.env [--json]
```

The audit sends only GETs and prints names, ids and statuses, never a value. It does three things:

1. Probes every deployable key in the `.env`. FAIL on `sk_`, or if `/v1/balance` returns 200.
2. Lists Workers with Stripe secrets (`CF_PROVISIONING_TOKEN`). WARN on a key without a webhook secret.
3. Lists live and sandbox webhook endpoints. FAIL on duplicate enabled URLs, on live `workers.dev`, and on `.env`
   webhook ids that are missing or disabled. WARN on enabled endpoints no `.env` id names, and at 12 of the 16
   endpoints a mode allows.

Run it after any Worker rename, key or webhook change, and monthly. It never changes keys or endpoints; fixes go
through the runbook above with owner approval for live changes.

## 10. Adoption

```sh
# repo already a follower: add "stripe": "1.0.0" to .standards.json "profiles", then
node ~/standards/sync.mjs sync
# new follower:
node ~/standards/sync.mjs init base@1.0.0 stripe@1.0.0
# then add stripe.scope.json and the rk_ guard, and run the gate
node .standards/check.mjs
```

The rk_ guard (S5) is a few lines in the Stripe client module. Reference: checkmyfloodzone `src/lib/report/stripe.ts`
(fetch client, signature verification) and `checkout.ts` (idempotent webhook).
