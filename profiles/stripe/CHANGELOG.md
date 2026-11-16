# stripe

Stripe payment security for every repo that calls the Stripe API or receives Stripe webhooks (standard: kit
`docs/stripe.md`). One zero-dependency, offline checker, `lint.mjs`, with rules S1-S8: no key material in git or built
output, secrets only as secrets, no secret behind a browser-inlined prefix, verified webhooks, a server that refuses a
full `sk_` key, a declared endpoint scope (`stripe.scope.json`), no buyer identity in metadata, price ids in config.
Pairs with base and the repo's language profile. The live audit (`scripts/stripe-audit.mjs`) stays in the kit.

## 1.0.0

- First release. S1-S5 and S7 fail; S6 fails on a missing or malformed `stripe.scope.json` and warns on an undeclared
  endpoint; S8 warns. Motivated by the 2026-11-16 incident (Worker renames deployed the full account key).
