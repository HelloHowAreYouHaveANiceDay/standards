// analytics-web 1.0.2: lint.mjs passing and failing cases per rule A1-A8, and track.mjs unit tests
// (redactUrl, consent default per time zone, in-memory visit id, never throws, no double config, no PostHog at tier 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir, node, git } from './helpers.mjs';

const DIR = process.env.ANALYTICS_WEB_SRC ? path.join(KIT_ROOT, 'src/profiles/analytics-web') : path.join(KIT_ROOT, 'profiles/analytics-web/1.0.2');
const SA = path.join(DIR, '.standards/analytics-web');
const LINT = path.join(SA, 'lint.mjs');
const l = await import(pathToFileURL(LINT).href);
const t = await import(pathToFileURL(path.join(SA, 'track.mjs')).href);

const PLAN = {
  schema: 'analytics-plan/1', tier: 1,
  property: { domain: 'example.com', hosts: ['example.com'], ga4: 'G-ABC123XYZ', posthog: null, url_params: ['utm_*', 'gclid'] },
  events: {
    lookup_submitted: { stage: 'engage', sinks: ['ga4', 'ae'], params: { method: { enum: ['typed', 'url'] } } },
    lookup_completed: { stage: 'activate', key_event: true, sinks: ['ga4', 'ae'] },
    begin_checkout: { stage: 'convert', key_event: true, sinks: ['ga4'] },
  },
};
const PAGE = `<html><head>
<script>import('/.standards/analytics-web/track.mjs').then((m) => m.initAnalytics(PLAN));</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"></script>
</head><body></body></html>
`;
const APP = "import { track, initAnalytics } from './.standards/analytics-web/track.mjs';\ninitAnalytics(plan);\ntrack('lookup_submitted', { method: 'typed' });\ntrack('lookup_completed');\n";

function repo(over = {}, plan = PLAN) {
  const r = tmpdir('aw-lint-');
  git(r, 'init', '-q', '-b', 'main');
  const files = { 'analytics.plan.json': JSON.stringify(plan), 'src/index.html': PAGE, 'src/app.ts': APP, ...over };
  for (const [f, text] of Object.entries(files)) {
    if (text === null) continue;
    fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true });
    fs.writeFileSync(path.join(r, f), text);
  }
  git(r, 'add', '-A');
  return r;
}
const run = (over, plan) => l.lint(repo(over, plan));
const has = (list, re) => list.some((x) => re.test(x));
const planWith = (patch) => JSON.parse(JSON.stringify({ ...PLAN, ...patch }));

test('a clean follower passes and the CLI exits 0', () => {
  const r = repo();
  const out = l.lint(r);
  assert.deepEqual(out.fails, []);
  assert.deepEqual(out.warns, []);
  const c = node([LINT, r]);
  assert.equal(c.code, 0, c.out);
  assert.match(c.out, /\[analytics-web\/lint\] OK/);
});

test('A1: missing, unparseable and invalid plans fail', () => {
  assert.ok(has(run({ 'analytics.plan.json': null }).fails, /A1\] analytics\.plan\.json: missing/));
  assert.ok(has(run({ 'analytics.plan.json': 'nope' }).fails, /A1\] analytics\.plan\.json: does not parse/));
  const bad = (patch, re) => assert.ok(has(run({}, planWith(patch)).fails, re), re.source);
  bad({ tier: 3 }, /"tier" must be 1 or 2/);
  bad({ events: { Bad_Name: { stage: 'activate' } } }, /event name "Bad_Name"/);
  bad({ events: { a_viewed: { stage: 'landing' } } }, /exactly one event must have stage "activate" \(found 0\)/);
  bad({ events: { a_done: { stage: 'activate' }, b_done: { stage: 'activate' } } }, /found 2/);
  bad({ events: { a_done: { stage: 'wat' } } }, /stage must be one of/);
  bad({ events: { a_done: { stage: 'activate', params: { 'Bad-Key': {} } } } }, /snake_case/);
  bad({ property: { ...PLAN.property, posthog: { project: 1, decision: 'x' } } }, /posthog must be null at tier 1/);
  bad({ property: { ...PLAN.property, hosts: [] } }, /property\.hosts/);
  bad({ property: { ...PLAN.property, ga4: 'UA-1' } }, /G-XXXX/);
  assert.deepEqual(run({}, planWith({ tier: 2, property: { ...PLAN.property, posthog: { project: 7, decision: 'wiki/log#1' } } })).fails, []);
  assert.ok(has(run({}, planWith({ tier: 2, property: { ...PLAN.property, posthog: null } })).fails, /tier 2 property\.posthog must be/));
});

test('A2: a second config or gtag/js load warns; script code injecting gtag/js warns', () => {
  const two = PAGE.replace('</head>', "<script>gtag('config','G-A')</script><script>gtag('config','G-A')</script></head>");
  assert.ok(has(run({ 'src/index.html': two }).warns, /A2\] src\/index\.html:\d+: second gtag\('config'\)/));
  const loads = PAGE.replace('</head>', '<script async src="https://www.googletagmanager.com/gtag/js?id=G-B"></script></head>');
  assert.ok(has(run({ 'src/index.html': loads }).warns, /A2\] src\/index\.html:\d+: second gtag\/js load/));
  const inj = "const s = document.createElement('script'); s.src = 'https://www.googletagmanager.com/gtag/js?id=G-A';\n";
  assert.ok(has(run({ 'src/inject.ts': inj }).warns, /A2\] src\/inject\.ts:1: script code injects gtag\/js/));
});

test('A3: unknown literal, template-computed and variable names warn; wrappers and the marker are honoured', () => {
  assert.ok(has(run({ 'src/x.ts': "track('mystery_event');\n" }).warns, /A3\] src\/x\.ts:1: track\(\) sends an event that is not in analytics\.plan\.json/));
  assert.ok(has(run({ 'src/x.ts': 'track(`tool_load_${id}`);\n' }).warns, /A3\] src\/x\.ts:1: track\(\) gets a computed event name/));
  assert.ok(has(run({ 'src/x.ts': 'track(name, {});\n' }).warns, /A3\] src\/x\.ts:1: track\(\) gets a computed event name/));
  assert.ok(has(run({ 'src/x.ts': "gtag('event', 'mystery_event', {});\n" }).warns, /A3\] src\/x\.ts:1: gtag\(\)/));
  assert.deepEqual(run({ 'src/x.ts': "gtag('event', 'page_view');\n" }).warns, []);
  const wrap = planWith({ wrappers: ['sendEvent'] });
  const body = 'function sendEvent(n, p) { track(n, p); }\nsendEvent(`x_${a}`);\nsendEvent("lookup_completed");\nsendEvent("nope_done");\n';
  const w = run({ 'src/x.ts': body }, wrap).warns;
  assert.ok(!w.some((x) => /x\.ts:1:/.test(x)), 'a wrapper body may forward a computed name');
  assert.ok(has(w, /A3\] src\/x\.ts:2: sendEvent\(\) gets a computed/));
  assert.ok(!w.some((x) => /x\.ts:3:/.test(x)));
  assert.ok(has(w, /A3\] src\/x\.ts:4: sendEvent\(\) sends an event that is not in/));
  assert.deepEqual(run({ 'src/x.ts': "// standards: analytics-ok -- legacy name kept for GA4 history\ntrack('legacy_thing');\n" }).warns, []);
  assert.ok(has(run({ 'src/x.ts': "// standards: analytics-ok\ntrack('legacy_thing');\n" }).warns, /A3\]/), 'a marker without a reason does not suppress');
});

test('A4: PII-named params warn without printing values, in code and in the plan', () => {
  const w = run({ 'src/x.ts': "track('lookup_submitted', { address });\ntrack('lookup_submitted', { 'email': 'a@b.co', method: 'typed' });\n" }).warns;
  assert.ok(has(w, /A4\] src\/x\.ts:1: track\(\) sends a param named address/));
  assert.ok(has(w, /A4\] src\/x\.ts:2: track\(\) sends a param named email/));
  assert.ok(!w.some((x) => /a@b\.co/.test(x)), 'never prints a value');
  assert.deepEqual(run({ 'src/x.ts': "track('lookup_submitted', { method: 'typed' });\n" }).warns, []);
  const p = planWith({ events: { ...PLAN.events, lookup_submitted: { stage: 'engage', params: { lat: {} } } } });
  assert.ok(has(run({}, p).warns, /A4\] analytics\.plan\.json: event lookup_submitted declares a param named lat/));
});

test('A4 (1.0.1): street/unit/parcel/latitude/longitude/zip/postal_code/city warn; coarse target_* keys are exact-key allowed', () => {
  for (const k of ['street', 'unit', 'parcel', 'latitude', 'longitude', 'zip', 'postal_code', 'city']) {
    assert.ok(has(run({ 'src/x.ts': `track('lookup_submitted', { ${k} });\n` }).warns, new RegExp(`A4\\] src/x\\.ts:1: track\\(\\) sends a param named ${k}`)), k);
  }
  assert.deepEqual(run({ 'src/x.ts': "track('lookup_submitted', { target_state, target_relation, target_distance });\n" }).warns, []);
  const p = planWith({ events: { ...PLAN.events, lookup_submitted: { stage: 'engage', params: { target_state: {}, target_relation: {}, target_distance: {} } } } });
  assert.deepEqual(run({}, p).warns, []);
});

test('A5/A6: raw gtag config needs a host gate, consent default and redactUrl; initAnalytics satisfies all three', () => {
  const raw = "<script>window.gtag('config', 'G-ABC123XYZ');</script>\n";
  const w = run({ 'src/index.html': raw }).warns;
  assert.ok(has(w, /A5\] src\/index\.html:1: no host gate/));
  assert.ok(has(w, /A6\] src\/index\.html:1: no gtag\('consent','default'\)/));
  assert.ok(has(w, /A6\] src\/index\.html:1: gtag\('config'\) page_location does not go through redactUrl/));
  const good = "<script>if (location.hostname !== 'example.com') window['ga-disable-G-ABC123XYZ'] = true;\ngtag('consent','default',{ad_storage:'denied'});\ngtag('config','G-ABC123XYZ',{page_location: redactUrl(location.href)});</script>\n";
  assert.deepEqual(run({ 'src/index.html': good }).warns, []);
  const leak = good.replace('redactUrl(location.href)', 'location.href');
  assert.ok(has(run({ 'src/index.html': leak }).warns, /A6\] src\/index\.html:3|A6\] src\/index\.html:\d+: gtag\('config'\) page_location/));
});

test('A7: PostHog at tier 1 warns; at tier 2 it does not', () => {
  const ph = "import posthog from 'posthog-js';\nposthog.init('phc_x');\n";
  assert.ok(has(run({ 'src/ph.ts': ph }).warns, /A7\] src\/ph\.ts:1: loads PostHog but analytics\.plan\.json says tier 1/));
  const t2 = planWith({ tier: 2, property: { ...PLAN.property, posthog: { project: 1, decision: 'log#1' } } });
  assert.deepEqual(run({ 'src/ph.ts': ph }, t2).warns, []);
});

test('A8 (1.0.2): utm_medium=ai-agent is allowed; unknown ai-bot still warns', () => {
  const link = (m) => ({ 'posts/a.md': `[x](https://example.com/?utm_source=claude&utm_medium=${m})\n` });
  assert.deepEqual(run(link('ai-agent')).warns, []);
  assert.ok(has(run(link('ai-bot')).warns, /A8\] posts\/a\.md:1: a link's utm_medium is not one of/));
});

test('A8: uppercase utm values and off-list mediums warn (code and markdown); values are not printed', () => {
  const w = run({ 'src/index.html': PAGE + '<a href="https://x.test/?utm_source=YouTube&utm_medium=Social">x</a>\n', 'posts/a.md': '[go](https://x.test/?utm_source=x&utm_medium=banner&utm_campaign=launch)\n' }).warns;
  assert.ok(has(w, /A8\] src\/index\.html:\d+: a link's utm_source has uppercase/));
  assert.ok(has(w, /A8\] src\/index\.html:\d+: a link's utm_medium has uppercase/));
  assert.ok(has(w, /A8\] posts\/a\.md:1: a link's utm_medium is not one of/));
  assert.ok(!w.some((x) => /YouTube|banner/.test(x)));
  assert.deepEqual(run({ 'posts/a.md': '[go](https://x.test/?utm_source=x&utm_medium=social&utm_campaign=launch-2026-11)\n' }).warns, []);
});

test('vendored and build dirs are skipped', () => {
  assert.deepEqual(run({ 'dist/a.js': "track('mystery_event');\n", 'node_modules/p/a.js': "track('mystery_event');\n" }).warns, []);
});

// ---- track.mjs ----
function env({ host = 'example.com', href = 'https://example.com/a?address=1&utm_source=x&gclid=g#frag', tz = 'America/New_York', storage = null } = {}) {
  const w = {};
  if (storage) w.sessionStorage = storage;
  globalThis.window = w;
  globalThis.location = { hostname: host, href };
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage || undefined, configurable: true, writable: true });
  const RealDTF = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function () { return { resolvedOptions: () => ({ timeZone: tz }) }; };
  return { w, done: () => { Intl.DateTimeFormat = RealDTF; delete globalThis.window; delete globalThis.location; delete globalThis.sessionStorage; } };
}
const calls = (w) => (w.dataLayer || []).map((a) => Array.from(a));

test('track: redactUrl keeps path + allowlisted keys, drops the fragment and everything else', () => {
  const e = env();
  try {
    assert.equal(t.redactUrl('https://example.com/a?address=1&lat=2&utm_source=x&utm_medium=social&gclid=g#frag'), 'https://example.com/a?utm_source=x&utm_medium=social&gclid=g');
    assert.equal(t.redactUrl('https://example.com/a?lat=1&lng=2'), 'https://example.com/a');
    assert.equal(t.redactUrl('https://example.com/a?ref=1&utm_x=1', ['ref']), 'https://example.com/a?ref=1');
    assert.equal(t.redactUrl('/b?q=1#x'), 'https://example.com/b');
    assert.equal(t.redactUrl('http://[bad'), '');
  } finally { e.done(); }
});

test('track: consent region by time zone; unreadable zone counts as inside', () => {
  for (const z of ['Europe/Berlin', 'Europe/London', 'Europe/Zurich', 'Atlantic/Canary', 'Asia/Nicosia', 'Indian/Reunion', 'Arctic/Longyearbyen', '']) assert.equal(t.inConsentRegion(z), true, z);
  for (const z of ['America/New_York', 'Asia/Tokyo', 'Australia/Sydney', 'America/Sao_Paulo']) assert.equal(t.inConsentRegion(z), false, z);
});

test('track: initAnalytics sets consent defaults per time zone, then one redacted config', () => {
  const us = env();
  try {
    assert.equal(t.initAnalytics(PLAN), true);
    const c = calls(us.w);
    assert.deepEqual(c[0], ['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' }]);
    assert.equal(c[1][0], 'js');
    assert.deepEqual(c[2], ['config', 'G-ABC123XYZ', { allow_google_signals: false, page_location: 'https://example.com/a?utm_source=x&gclid=g' }]);
    assert.equal(t.initAnalytics(PLAN), false, 'no double config');
    assert.equal(calls(us.w).filter((a) => a[0] === 'config').length, 1);
  } finally { us.done(); }
  const eu = env({ tz: 'Europe/Paris' });
  try {
    t.initAnalytics({ ...PLAN, property: { ...PLAN.property, ga4: 'G-EU1' } });
    assert.equal(calls(eu.w)[0][2].analytics_storage, 'denied');
  } finally { eu.done(); }
});

test('track: host gate disables GA4 and sends nothing for a non-production host', () => {
  const e = env({ host: '127.0.0.1' });
  try {
    assert.equal(t.initAnalytics({ ...PLAN, property: { ...PLAN.property, ga4: 'G-DEV1' } }), false);
    assert.equal(e.w['ga-disable-G-DEV1'], true);
    assert.equal(e.w.dataLayer, undefined);
  } finally { e.done(); }
});

test('track: track() truncates, caps params, never throws, and makes no PostHog call at tier 1', () => {
  const e = env();
  try {
    const seen = [];
    let ph = 0;
    e.w.gtag = (...a) => seen.push(a);
    e.w.posthog = { capture: () => { ph++; } };
    t.initAnalytics({ ...PLAN, property: { ...PLAN.property, ga4: 'G-T1' } });
    const params = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, 'x'.repeat(150)]));
    t.track('lookup_completed', params);
    const ev = seen.find((a) => a[0] === 'event');
    assert.equal(Object.keys(ev[2]).length, 25);
    assert.equal(ev[2].p0.length, 100);
    assert.equal(ph, 0, 'tier 1 never calls posthog');
    e.w.gtag = () => { throw new Error('boom'); };
    assert.doesNotThrow(() => t.track('lookup_completed', null));
    delete globalThis.window;
    assert.doesNotThrow(() => t.track('lookup_completed'));
    assert.doesNotThrow(() => t.initAnalytics(null));
  } finally { e.done(); }
});

test('track: posthog.capture is called at tier 2 only', () => {
  const e = env();
  try {
    let ph = 0;
    e.w.gtag = () => {};
    e.w.posthog = { capture: () => { ph++; } };
    t.initAnalytics({ ...PLAN, tier: 2, property: { ...PLAN.property, ga4: 'G-T2', posthog: { project: 1, decision: 'x' } } });
    t.track('lookup_completed');
    assert.equal(ph, 1);
  } finally { e.done(); }
});

test('track: visitId is null unless the plan asks, in memory in the consent region, per-tab storage elsewhere', () => {
  const eu = env({ tz: 'Europe/Paris', storage: { getItem: () => { throw new Error('touched'); }, setItem: () => { throw new Error('touched'); } } });
  try {
    t.initAnalytics({ ...PLAN, visit_id: false, property: { ...PLAN.property, ga4: 'G-V0' } });
    assert.equal(t.visitId(), null);
    t.initAnalytics({ ...PLAN, visit_id: true, property: { ...PLAN.property, ga4: 'G-V1' } });
    const id = t.visitId();
    assert.match(id, /^[0-9a-f-]{8,}$/);
    assert.equal(t.visitId(), id, 'stable within the page');
  } finally { eu.done(); }
});

test('track: initSnippet is a self-contained classic script that does the same', () => {
  const e = env();
  try {
    const code = t.initSnippet({ ...PLAN, property: { ...PLAN.property, ga4: 'G-SN1' } });
    assert.doesNotMatch(code, /\bimport\b|\bexport\b/);
    new vm.Script(code);
    vm.runInThisContext(code);
    const c = calls(e.w);
    assert.equal(c[0][0], 'consent');
    assert.deepEqual(c[2], ['config', 'G-SN1', { allow_google_signals: false, page_location: 'https://example.com/a?utm_source=x&gclid=g' }]);
  } finally { e.done(); }
});

test('track.mjs stays under 80 lines and the plan schema parses', () => {
  assert.ok(fs.readFileSync(path.join(SA, 'track.mjs'), 'utf8').split('\n').length <= 81);
  const s = JSON.parse(fs.readFileSync(path.join(SA, 'plan.schema.json'), 'utf8'));
  assert.equal(s.title, 'analytics-plan/1');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(SA, 'check.json'), 'utf8')).commands[0].run, ['node', '.standards/analytics-web/lint.mjs']);
});
