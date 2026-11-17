// scripts/analytics-audit.mjs: G1-G8, S1-S4, L1-L3 PASS / FAIL / SKIP against mocked HTTP (no live calls); read-only; no secrets or values printed.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT } from './helpers.mjs';

const a = await import(pathToFileURL(path.join(KIT_ROOT, 'scripts/analytics-audit.mjs')).href);
const PLAN = {
  schema: 'analytics-plan/1', tier: 1,
  property: { domain: 'demo.test', hosts: ['demo.test'], ga4: 'G-DEMO1', posthog: null, url_params: ['utm_*', 'gclid'] },
  events: {
    lookup_completed: { stage: 'activate', key_event: true, sinks: ['ga4'], params: { target_state: { dim: true } } },
    begin_checkout: { stage: 'convert', key_event: true, sinks: ['ga4'] },
  },
};
const TOKEN = 'tok-secret-123';
const KEY = 'bing-secret-456';

function mock(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url: String(url), method });
    for (const [needle, r] of routes) {
      if (!String(url).includes(needle)) continue;
      const v = typeof r === 'function' ? r({ url: String(url), method, init }) : r;
      const [status, body] = Array.isArray(v) ? v : [200, v];
      return { status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
    }
    return { status: 404, json: async () => ({}), text: async () => 'nope' };
  };
  fn.calls = calls;
  return fn;
}
const rows = (...r) => ({ rows: r.map(([d, n]) => ({ dimensionValues: [{ value: d }], metricValues: [{ value: String(n) }] })) });
const HOME = '<html><script async src="https://www.googletagmanager.com/gtag/js?id=G-DEMO1"></script><script type="application/ld+json">{"@type":"WebSite"}</script></html>';

const GOOD = [
  ['accountSummaries', { accountSummaries: [{ propertySummaries: [{ property: 'properties/9' }] }] }],
  ['/properties/9/dataStreams?', { dataStreams: [{ name: 'properties/9/dataStreams/1', webStreamData: { measurementId: 'G-DEMO1' } }] }],
  ['/keyEvents', { keyEvents: [{ eventName: 'lookup_completed' }, { eventName: 'begin_checkout' }] }],
  ['/customDimensions', { customDimensions: [{ parameterName: 'target_state', scope: 'EVENT' }] }],
  [':runReport', ({ init }) => {
    const b = JSON.parse(init.body).dimensions[0].name;
    if (b === 'eventName') return rows(['page_view', 100], ['lookup_completed', 5], ['begin_checkout', 1]);
    if (b === 'hostName') return rows(['demo.test', 100]);
    return rows(['/?utm_source=x', 3], ['/', 9]);
  }],
  ['dataRetentionSettings', { eventDataRetention: 'FOURTEEN_MONTHS' }],
  ['googleSignalsSettings', { state: 'GOOGLE_SIGNALS_DISABLED' }],
  ['dataRedactionSettings', { queryParameterRedactionEnabled: true, queryParameterKeys: a.REDACTION_KEYS }],
  ['webmasters/v3/sites/', { sitemap: [{ errors: '0' }] }],
  ['webmasters/v3/sites', { siteEntry: [{ siteUrl: 'sc-domain:demo.test', permissionLevel: 'siteOwner' }] }],
  ['GetUserSites', { d: [{ Url: 'https://demo.test/', IsVerified: true }] }],
  ['/sitemap.xml', [200, '<urlset><url><loc>x</loc><lastmod>2026-01-01</lastmod></url></urlset>']],
  ['/robots.txt', [200, 'User-agent: *\nSitemap: https://demo.test/sitemap.xml']],
  ['__analytics-audit-', [404, 'gone']],
  ['https://demo.test/', [200, HOME]],
];
const over = (...p) => [...p, ...GOOD];
const run = (routes, opts = {}) => a.audit(PLAN, { token: TOKEN, bingKey: KEY, ...opts, fetch: mock(routes) });
const by = (res) => Object.fromEntries(res.map((r) => [r.rule, r]));

test('every rule PASSes on a clean property; exit 0', async () => {
  const res = await run(GOOD);
  for (const r of res) assert.equal(r.state, 'PASS', `${r.rule}: ${r.what}`);
  assert.equal(res.length, 15);
  assert.equal(a.exitCode(res), 0);
});

test('GA4 findings: key events, dims, silent/unplanned events, hosts, query keys, retention, redaction', async () => {
  const r = by(await run(over(
    ['/keyEvents', { keyEvents: [{ eventName: 'purchase' }] }],
    ['/customDimensions', { customDimensions: [] }],
    [':runReport', ({ init }) => {
      const d = JSON.parse(init.body).dimensions[0].name;
      if (d === 'eventName') return rows(['page_view', 1], ['mystery_event', 2]);
      if (d === 'hostName') return rows(['demo.test', 80], ['127.0.0.1', 20]);
      return rows(['/?address=SECRETSTREET&utm_source=a', 4], ['/?lat=(redacted)', 2]);
    }],
    ['dataRetentionSettings', { eventDataRetention: 'TWO_MONTHS' }],
    ['dataRedactionSettings', { queryParameterRedactionEnabled: true, queryParameterKeys: ['q'] }],
  )));
  for (const k of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']) assert.equal(r[k].state, 'FAIL', `${k}: ${r[k].what}`);
  assert.match(r.G6.what, /address \(4\)/);
  assert.match(r.G6.what, /2 more already \(redacted\)/);
  assert.doesNotMatch(r.G6.what, /SECRETSTREET/); // values are never printed
});

test('no tokens: GA4, GSC and Bing rules SKIP (never PASS); exit 3; live rules still run', async () => {
  const res = await a.audit(PLAN, { token: '', bingKey: '', fetch: mock(GOOD) });
  const r = by(res);
  for (const k of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'S1', 'S2', 'S3']) assert.equal(r[k].state, 'SKIP', k);
  for (const k of ['S4', 'L1', 'L2', 'L3']) assert.equal(r[k].state, 'PASS', k);
  assert.equal(a.exitCode(res), 3);
});

test('unreachable API answers SKIP with the status; a FAIL wins the exit code', async () => {
  const r = by(await run(over(['/keyEvents', [403, {}]], ['GetUserSites', [500, {}]])));
  assert.equal(r.G1.state, 'SKIP'); assert.match(r.G1.what, /HTTP 403/);
  assert.equal(r.S2.state, 'SKIP');
  assert.equal(a.exitCode([{ state: 'SKIP' }, { state: 'FAIL' }]), 1);
});

test('search and live findings', async () => {
  const r = by(await run(over(
    ['webmasters/v3/sites/', { sitemap: [{ errors: '2' }] }],
    ['GetUserSites', { d: [{ Url: 'https://demo.test/', IsVerified: false }] }],
    ['/sitemap.xml', [200, '<urlset><url><loc>x</loc></url></urlset>']],
    ['/robots.txt', [200, 'User-agent: *']],
    ['__analytics-audit-', [200, 'soft']],
    ['https://demo.test/', [200, `${HOME}<script src="https://www.googletagmanager.com/gtag/js?id=G-DEMO1"></script><script type="application/ld+json">{bad</script>`]],
  )));
  for (const k of ['S2', 'S3', 'S4', 'L1', 'L2', 'L3']) assert.equal(r[k].state, 'FAIL', `${k}: ${r[k].what}`);
  assert.match(r.S4.what, /lastmod/);
  assert.match(r.L3.what, /2 time/);
});

test('read-only: only GET plus runReport POSTs, no D1, no secret in any output', async () => {
  const f = mock(GOOD);
  const res = await a.audit(PLAN, { token: TOKEN, bingKey: KEY, fetch: f });
  for (const c of f.calls) {
    assert.ok(c.method === 'GET' || (c.method === 'POST' && c.url.includes(':runReport')), `${c.method} ${c.url}`);
    assert.doesNotMatch(c.url, /d1|cloudflare/i);
  }
  const out = JSON.stringify(res) + a.TODO.join('\n');
  assert.ok(!out.includes(TOKEN) && !out.includes(KEY));
  assert.ok(!/uptimerobot|deletion request/i.test(out));
});

test('helpers: allowlist, query keys, JSON-LD, gtag count, lastmod', () => {
  assert.ok(a.allowed('utm_source', ['utm_*']) && a.allowed('gclid', ['gclid']) && !a.allowed('lat', ['utm_*']));
  assert.deepEqual(a.queryKeys('/p?A=1&lat=(redacted)'), [{ key: 'a', redacted: false }, { key: 'lat', redacted: true }]);
  assert.deepEqual(a.queryKeys('/p'), []);
  assert.deepEqual(a.jsonLdBlocks('<script type="application/ld+json">{"@type":"X"}</script><script type="application/ld+json">{}</script>'), [true, false]);
  assert.equal(a.gtagLoads('googletagmanager.com/gtag/js googletagmanager.com/gtag/js'), 2);
  assert.ok(a.hasLastmod('<lastmod>2026-01-01</lastmod>') && !a.hasLastmod('<url/>'));
});
