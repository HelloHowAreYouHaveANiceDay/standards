# stripe rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Every repo that calls the Stripe API or receives Stripe webhooks. The full standard, with reasons, key model and
runbooks, is the kit's `docs/stripe.md`. Gate: `node .standards/stripe/lint.mjs`, run by `node .standards/check.mjs`;
offline, no credentials, never prints a secret value (only its file and line).

| Rule | Level | Fails when |
|---|---|---|
| S1 | FAIL | a tracked file, or any file under `dist/ build/ out/ .output/ .vercel/output/ .svelte-kit/output/ .wrangler/deploy/` on disk, contains `sk_live_ sk_test_ rk_live_ rk_test_` + 20 chars or `whsec_` + 20 chars |
| S2 | FAIL | `wrangler.toml` / `wrangler.json(c)` `[vars]` or `[env.*.vars]` holds a `STRIPE_*SECRET*` / `*WEBHOOK*` / `*RESTRICTED*` name or an `sk_ rk_ whsec_` value; a tracked `.env*` / `.dev.vars` / `.runtimeconfig.json` mentions Stripe |
| S3 | FAIL | a `VITE_ PUBLIC_ NEXT_PUBLIC_ REACT_APP_ ...` name carries a Stripe secret/webhook/restricted key |
| S4 | FAIL | a source file reads the `Stripe-Signature` header without calling `constructEvent(Async)` / `verify*Signature(`; or Stripe event types are handled and no file reads the header |
| S5 | FAIL | code uses `STRIPE_SECRET_KEY` and no code checks the key is `rk_` (fail closed on a full `sk_` key) |
| S6 | FAIL / WARN | FAIL: the code calls Stripe endpoints and `stripe.scope.json` is missing or malformed. WARN: an endpoint the code calls is not declared |
| S7 | FAIL | `metadata[email|name|phone|...]` or `metadata: { email: ... }` |
| S8 | WARN | a `price_...` id hardcoded in source outside config files |

## stripe.scope.json (repo root)

```json
{
  "key": "STG_STRIPE_CHECKOUT_KEY",
  "permissions": ["Checkout Sessions: Write"],
  "endpoints": ["POST /v1/checkout/sessions", "GET /v1/checkout/sessions/{id}"]
}
```

`key` is the wiki `.env` NAME of the restricted key deployed as `STRIPE_SECRET_KEY` (never a value). `permissions` are
the key's dashboard permissions. `endpoints` are what the code calls; `{id}` or `*` matches one path segment, and
the method is documentation (the lint compares paths). Widen the key only when Stripe 403s naming a permission, in
the same PR that adds the endpoint here.

## Markers

- `standards: fake-stripe-key -- <reason>` on the line allows an S1 match in a tracked test fixture. Never in built
  output.

## Limits (pattern checks, not proofs)

- S1 sees literal keys only; a key split across strings or base64-encoded is not found. The live audit
  (`scripts/stripe-audit.mjs` in the kit) is the backstop for what is actually deployed.
- S4 proves a verify call exists in the handler file, not that it guards every path or uses the raw body.
- S5 proves an `rk_` check exists somewhere, not that it runs before every call.
- S6 finds `/v1/...` string literals and `stripe.<resource>.<verb>(` SDK calls; paths built some other way are
  invisible, and the HTTP method is not compared.
- Test files (`*.test.*`, `*.spec.*`, `test/ tests/ __tests__/ fixtures/ e2e/`) are exempt from S4-S8.
