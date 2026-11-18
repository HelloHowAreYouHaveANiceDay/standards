# analytics-web

Tier-1 user-side analytics (GA4, with GSC and Bing WMT beside it) for every web property (spec: wiki
`projects/spec--analytics-standard.md`). One follower-owned `analytics.plan.json`; `lint.mjs` rules A1-A8; a zero-dep
`track.mjs` sink (host gate, Consent Mode v2 defaults, URL allowlist). Pairs with base.

## 1.0.2

- A8: `ai-agent` added to the allowed `utm_medium` list (links in content served to AI agents; `utm_source` = agent
  label). Still WARN.

## 1.0.1

- A4 key list extended for user/location dimensions: adds `street unit parcel latitude longitude zip postal_code city`
  (spec `projects/spec--analytics-standard.md`, "User dimensions and physical-location granularity"). Exact-key match, so
  coarse `target_state`, `target_relation`, `target_distance` stay allowed. Still WARN.

## 1.0.0

- First release. A1 (plan missing or invalid) fails; A2-A8 warn (one gtag tag, events in the plan, no PII params, host
  gate, consent default + `redactUrl`, no PostHog at tier 1, UTM shape) and flip to FAIL in 1.1.0 once followers are clean.
- `track.mjs`: `initAnalytics`, `track`, `redactUrl`, `inConsentRegion`, `visitId`, `initSnippet`; no PostHog call at tier 1.
