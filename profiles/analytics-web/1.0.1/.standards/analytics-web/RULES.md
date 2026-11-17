# analytics-web rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Tier-1 user-side analytics (GA4 with GSC and Bing WMT beside it) for every web property. The repo owns one
`analytics.plan.json`; `lint.mjs` checks the code against it and `track.mjs` is the one sink every page calls.
Gate: `node .standards/analytics-web/lint.mjs`, run by `node .standards/check.mjs`; offline, no credentials, never
prints a param value, URL or UTM value (only the file and line).

| Rule | 1.0.0 | Fails when | Source |
|---|---|---|---|
| A1 | FAIL | `analytics.plan.json` is missing or invalid: bad schema/tier, no hosts, bad GA4 id, event names off `^[a-z][a-z0-9_]{1,39}$`, unknown stage or sink, not exactly one `activate`, a param name off snake_case or more than 25 params, `posthog` set at tier 1 | this spec |
| A2 | WARN | more than one `gtag/js` load or `gtag('config')` in a file, or `.ts/.js/.mjs` code injecting `gtag/js` | double-tag trap |
| A3 | WARN | a literal event name not in the plan, or a computed first argument to `track()` / `gtag('event')` / a plan `wrappers` function outside a wrapper's own body | OTel events |
| A4 | WARN | a param key named `address email phone name lat lng lon q query ip street unit parcel latitude longitude zip postal_code city` (exact key match, in code or in the plan; coarse derived keys such as `target_state`, `target_relation`, `target_distance` are allowed) | GA4 PII policy; spec `projects/spec--analytics-standard.md` "User dimensions and physical-location granularity" |
| A5 | WARN | `gtag('config')` with no host gate before it (`initAnalytics` counts as one) | dev-traffic audit |
| A6 | WARN | no consent default before `gtag('config')`, or its `page_location` does not go through `redactUrl` | Consent Mode v2 |
| A7 | WARN | PostHog is loaded while the plan says `tier: 1` | ladder |
| A8 | WARN | a link carrying `utm_*` with uppercase, or `utm_medium` outside `social video email referral community partner` (also scans `.md .mdx`) | UTM best practices |

Scans tracked `.html .astro .njk .ts .tsx .js .mjs .vue` (A8 also `.md .mdx`), skipping vendored and build dirs; A2-A7
skip test files. WARN does not fail the gate; A2-A8 flip to FAIL in 1.1.0 once the followers are clean.

Suppress one finding with `standards: analytics-ok -- <reason>` on its line or the line above (a reason is required).

## Files

- `analytics.plan.json` (repo root, yours): shape in `plan.schema.json`. `events` are the only names code may send;
  `wrappers` lists your own forwarding functions (callers are checked, not their bodies); `hosts` lists every
  production hostname.
- `track.mjs` + `track.d.ts` (vendored): `initAnalytics(plan)` inline before the gtag script (host gate, Consent Mode v2
  defaults, no Google signals, one `config` with a redacted `page_location`), `track(name, params)`, `redactUrl()`,
  `inConsentRegion()`, `visitId()`, `initSnippet(plan)` for static sites. Tier 1 makes no PostHog call.
