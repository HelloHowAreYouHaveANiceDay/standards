# Analytics standard (tier 1, user-side)

Applies to every web property we run. Scope is user-side analytics: browser events, GA4, Search Console, Bing
Webmaster Tools, first-party AE/D1 product events and their warehouse landing. Server error logging is a separate
standard. Offline lint: the `analytics-web` profile (`.standards/analytics-web/`, rules A1-A8, see its RULES.md). Live
check: `scripts/analytics-audit.mjs` (section 9). Spec: wiki `projects/spec--analytics-standard.md` (v2).

## 1. Ladder and triggers

- **Tier 1 (every site):** GA4 + Search Console + Bing Webmaster Tools + Cloudflare analytics + the existing
  first-party AE/D1 events. `analytics.plan.json` has `"tier": 1` and `"posthog": null`.
- **Tier 2 (traction plus a purchase funnel to optimize):** PostHog with strict PII settings. A property enters on its
  own Decision Log entry, recorded as `posthog: { project, decision }` in the plan. Sanctioned today: pdfmarkuptool,
  bimathome; checkmyfloodzone qualifies on numbers and enters on its own entry.
- **Tier 3:** paid retention or raw export, only with paying customers.
- $0 rule: no BigQuery export, no new paid vendor. Rejected by the owner: a third-party uptime monitor
  (UptimeRobot), and a GA4 data-deletion request for the cmfz leak (those rows age out with 14-month retention).

## 2. Taxonomy rubric

- Name matches `^[a-z][a-z0-9_]{1,39}$`, `object_action`, past tense (`lookup_completed`). GA4 recommended names win
  where they fit: `sign_up`, `generate_lead`, `begin_checkout`, `purchase`, `share`, `search`. [Amplitude, GA4]
- One name per act, stage lives in the plan and never in the name. No dynamic parts: one `tool_loaded` with
  `tool: "google_sheets_to_excel"`, never `tool_load_<x>`. [OTel events]
- Params: snake_case, at most 25 per event, values at most 100 chars. Enumerated values go in the plan; failures carry
  `reason`. [GA4 limits]
- Stages: `landing`, `engage`, `activate` (exactly one per property), `convert`, `pay`.
- Fleet verbs: `*_viewed`, `*_clicked`, `*_submitted`, `*_completed` / `*_failed`, `*_downloaded`.
- Renames reset GA4 history for the renamed event: rename only drift (`cta_clicked` / `report_cta_click(ed)`; the
  `download*` family to `file_downloaded`), never a working key event.

## 3. UTM convention (U1)

Lowercase, one value per platform, fixed medium list. [UTM best practices]

- `utm_source` = platform (`youtube`, `x`, `linkedin`, `reddit`, `substack`, `newsletter`), or the site domain for a
  cross-site link.
- `utm_medium` in `social | video | email | referral | community | partner`.
- `utm_campaign` = lowercase slug of the post or launch (`bimcli-launch-2026-11`).
- Our own links between our sites stay untagged unless a launch is measured: tags overwrite the real source. Lint A8
  checks links in code and in `.md`/`.mdx`.

## 4. PII rules

- Nothing personal goes into an event param, a URL, a page title or a user property: no address, email, phone, name,
  coordinates, IP, free text, typed input. Lint A4 flags the key names; GA4 query-key redaction (G8) is the backstop.
- Page URLs go through `redactUrl`: origin + path + the plan's `url_params` allowlist (`utm_*`, `gclid` by default);
  fragment dropped. The code allowlist is the real control, GA4 redaction is a 30-key denylist.
- Physical location, per sink:

| Dimension | Third party (GA4/PostHog) | First party (AE/D1) | Never stored |
|---|---|---|---|
| Searcher location | nothing sent (GA4 derives country/region/city itself) | `cf.country`, `cf.regionCode`, `cf.metroCode` | IP, `cf.city`+`cf.postalCode` together, lat/lng |
| Search target location | `target_state` | state, `county_fips`, ZIP5, city | street/house number, unit, parcel id, lat/lng, ZIP+4, the typed input |
| Searcher vs target | `target_relation` (`same_metro`, `same_state`, `other_state`, `other_country`, `unknown`), `target_distance` (`lt_25mi`, `25_100mi`, `100_500mi`, `gt_500mi`, `unknown`) | same two values | the coordinates used to compute them |
| Behavior | event, stage, `input_method`, outcome enums, landing path, channel/UTM | plus `visit_id`, `client_kind` | free text, request bodies |

  A new geo dimension must fit a row of this table; a finer value needs an owner decision. Compute relation and
  distance in the Worker, in memory, per request, and throw the coordinates away.

## 5. Consent table

No consent banner. The consent region (EU/EEA/UK/CH by browser time zone, one fleet-wide definition,
`inConsentRegion()`) decides:

| Visitor | GA4 `analytics_storage` | `ad_*` storage/user data/personalization | PostHog (tier 2) | `visit_id` |
|---|---|---|---|---|
| Outside the region | granted | denied | person id allowed | per tab |
| Inside the region | denied (cookieless pings) | denied | no person id, no replay (`persistence: 'memory'`) | in memory only |

Storing anything on the device of a consent-region visitor needs a banner first. Google signals stay off everywhere.
Expect cookieless pings to lower GA4 user counts in the region. [Consent Mode v2]

## 6. How to add an event

1. Add it to `analytics.plan.json`: name, `stage`, `sinks`, params with enums, `key_event` and `"dim": true` where
   needed. The plan is the source for key events and custom dimensions.
2. Send it through `track(name, params)` (or a plan `wrapper`). Literal names only.
3. `node .standards/check.mjs </dev/null` must exit 0 (lint A1-A8).
4. After merge, the coordinator registers the key event / custom dims in GA4 (admin writes are never in a PR) and runs
   the audit: G1/G2 must PASS and G3 passes once the event has fired in prod.

## 7. Offline lint

`analytics-web` rules A1-A8 run in `check.mjs`; A1 FAILs, A2-A8 WARN in 1.0.0 and flip to FAIL in 1.1.0 once
followers are clean. Suppress one finding with `standards: analytics-ok -- <reason>`.

## 8. Studio-side admin steps (coordinator, token-bound)

Not in any follower PR. The audit prints this list after its results.

1. Retention 14 months on every property still at 2 months.
2. Data redaction on every web stream: query keys `address, lat, lng, lon, q, query, email, phone, name, zip`.
3. Data filters: developer traffic (Exclude) and web hostname (Include only the plan's `hosts`), created in Testing,
   switched to Active after 48 h shows only dev rows. Active filters are permanent: a wrong hostname filter drops prod data.
4. Unwanted referrals: `checkout.stripe.com` on every property with a checkout.
5. From each merged plan: key events, custom dims; archive default `purchase` where no `pay` event exists.
6. Verify the bimcli.com web stream and the smalltigergroup.com home-page tag.
7. Monthly Bing AI Performance snapshot (no API; bro recipe in ai-search-visibility).

## 9. Live audit (`scripts/analytics-audit.mjs`)

```
node scripts/analytics-audit.mjs [--repo <dir>] [--plan <file>] [--site-url <url>] [--property <id>] [--json]
```

Read-only: GETs plus GA4 Data API `runReport` POSTs (reads). Never writes to GA4/GSC/Bing, never queries D1, never
prints a token, API key or query value (key names and counts only; `(redacted)` values are counted apart).
Credentials from env: `GOOGLE_OAUTH_ACCESS_TOKEN` (GA4 Admin + Data readonly, Search Console readonly),
`BING_WEBMASTER_API_KEY`. A source it cannot reach prints SKIP with the reason, never PASS.
Exit 0 clean, 1 any FAIL, 3 no FAIL but something unreachable, 2 usage.

| Rule | Checks |
|---|---|
| G1 | GA4 key events equal the plan's `key_event` set |
| G2 | plan custom dims (`"dim": true`) are registered |
| G3 | every GA4 plan event fired in the last 28 d |
| G4 | no events seen in GA4 that the plan lacks (GA4 automatic events excepted) |
| G5 | non-plan hostnames are at most 5% of 28 d sessions |
| G6 | page-path query keys all inside the allowlist |
| G7 | retention is 14 months, Google signals off |
| G8 | query-key redaction on with the fleet key list |
| S1 | domain verified in Search Console |
| S2 | domain verified in Bing Webmaster Tools |
| S3 | GSC sitemap errors = 0 |
| S4 | `sitemap.xml` 200 with `lastmod`; robots.txt names the sitemap |
| L1 | an unknown path returns 404 |
| L2 | every JSON-LD block parses and has `@type` |
| L3 | the home page loads exactly one `gtag/js` |

Run it at adoption, after admin changes, and as the live acceptance of each follower PR. Not in CI: its findings
describe a property, not a commit.

## 10. Incident runbook: personal data found in analytics

1. Confirm with G6 (which key names, how many views) and a GA4 exploration on the page-path dimension.
2. Stop the flow: add the key to GA4 query-key redaction (G8 list) the same hour. That masks new rows only.
3. Fix the code: route the URL through `redactUrl` (allowlist), add a RED test with the leaking query first, ship it.
4. Re-run the audit; G6 shows the key only as `(redacted)` once both layers hold.
5. Old rows are not deleted on request: they age out with 14-month retention. Record the leak window and the fix in the
   owner's log.

## Sources

- GA4 limits https://support.google.com/analytics/answer/9267744
- GA4 recommended events https://support.google.com/analytics/answer/9267735
- GA4 data retention https://support.google.com/analytics/answer/7667196
- GA4 data redaction https://support.google.com/analytics/answer/13544947
- GA4 data filters https://support.google.com/analytics/answer/13296761
- UTM best practices https://support.google.com/analytics/answer/10917952
- Amplitude taxonomy https://amplitude.com/docs/data/data-planning-playbook
- Consent Mode https://developers.google.com/tag-platform/security/guides/consent
- OTel events https://opentelemetry.io/docs/specs/semconv/general/events/
