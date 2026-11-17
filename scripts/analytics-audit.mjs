#!/usr/bin/env node
// Live analytics audit (docs/analytics.md "Live audit", rules G1-G8, S1-S4, L1-L3). Read-only: GET requests, plus the GA4
// Data API runReport POST (a read). Never writes to GA4/GSC/Bing, never queries D1, never prints a token, an API key or a
// query VALUE (only key names and counts). Run by an operator at adoption and after admin changes, never in CI.
//
//   node scripts/analytics-audit.mjs [--repo <dir>] [--plan <file>] [--site-url <url>] [--property <ga4 property id>] [--json]
//
// Plan: <repo>/analytics.plan.json (or --plan). Credentials from env only; a source without one prints SKIP (never PASS):
//   GOOGLE_OAUTH_ACCESS_TOKEN   GA4 Admin + Data API (analytics.readonly) and Search Console (webmasters.readonly)
//   BING_WEBMASTER_API_KEY      Bing Webmaster Tools
// Rule states: PASS, FAIL, SKIP. Exit 0 no FAIL and no SKIP, 1 any FAIL, 3 no FAIL but something unreachable, 2 usage.
// After the rules it prints the coordinator's to-do for the admin steps (GA4 changes are never made by this script).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REDACTION_KEYS = ['address', 'lat', 'lng', 'lon', 'q', 'query', 'email', 'phone', 'name', 'zip'];
const ADMIN = 'https://analyticsadmin.googleapis.com/v1beta';
const ADMIN_ALPHA = 'https://analyticsadmin.googleapis.com/v1alpha';
const DATA = 'https://analyticsdata.googleapis.com/v1beta';
const GSC = 'https://www.googleapis.com/webmasters/v3';
const BING = 'https://ssl.bing.com/webmaster/api.svc/json';
const DEFAULT_PARAMS = ['utm_*', 'gclid'];

export function readPlan(file) {
  try { return { plan: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { return { reason: `${path.basename(file)}: ${e.code === 'ENOENT' ? 'not found' : 'not valid JSON'}` }; }
}

// Pure helpers (unit-tested).
export const allowed = (key, params) => (params || DEFAULT_PARAMS).some((p) => (p.endsWith('*') ? key.startsWith(p.slice(0, -1)) : key === p));
export function queryKeys(pathPlusQuery) {
  const i = pathPlusQuery.indexOf('?');
  if (i < 0) return [];
  return [...new URLSearchParams(pathPlusQuery.slice(i + 1)).entries()].map(([k, v]) => ({ key: k.toLowerCase(), redacted: v === '(redacted)' }));
}
export function jsonLdBlocks(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let ok = false;
    try {
      const j = JSON.parse(m[1]);
      const nodes = Array.isArray(j) ? j : j['@graph'] ? [j, ...j['@graph']] : [j];
      ok = nodes.length > 0 && nodes.every((n) => n && typeof n === 'object' && (n['@type'] || n['@graph']));
    } catch { /* invalid */ }
    out.push(ok);
  }
  return out;
}
export const gtagLoads = (html) => (String(html).match(/googletagmanager\.com\/gtag\/js/g) || []).length;
export const hasLastmod = (xml) => /<lastmod>\s*\S+\s*<\/lastmod>/i.test(String(xml));

export async function audit(plan, opts = {}) {
  const f = opts.fetch || fetch;
  const env = opts.env || process.env;
  const token = opts.token !== undefined ? opts.token : env.GOOGLE_OAUTH_ACCESS_TOKEN;
  const bingKey = opts.bingKey !== undefined ? opts.bingKey : env.BING_WEBMASTER_API_KEY;
  const prop = plan.property;
  const siteUrl = (opts.siteUrl || `https://${prop.domain}`).replace(/\/$/, '');
  const res = [];
  const add = (rule, state, what) => res.push({ rule, state, what });
  const skip = (rules, why) => rules.forEach((r) => add(r, 'SKIP', why));
  const call = async (url, init = {}, auth = true) => {
    const r = await f(url, { method: 'GET', ...init, headers: { ...(auth && token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) }, signal: AbortSignal.timeout(20_000) });
    let body = null;
    try { body = await r.json(); } catch { /* not json */ }
    return { status: r.status, ok: r.status < 400, body };
  };
  const text = async (url) => {
    try {
      const r = await f(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      return { status: r.status, text: await r.text() };
    } catch (e) { return { error: e.cause?.code || e.name || 'request failed' }; }
  };
  const failed = (r) => `HTTP ${r.status}`;

  // ---- GA4 ----
  const GA = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'];
  if (!token) skip(GA, 'no GOOGLE_OAUTH_ACCESS_TOKEN');
  else {
    try {
      let pid = opts.property;
      let streamName = null;
      if (!pid) {
        const s = await call(`${ADMIN}/accountSummaries?pageSize=200`);
        if (!s.ok) skip(GA, `accountSummaries ${failed(s)}`);
        else {
          for (const acct of s.body?.accountSummaries || []) {
            for (const ps of acct.propertySummaries || []) {
              const ds = await call(`${ADMIN}/${ps.property}/dataStreams?pageSize=200`);
              const st = (ds.body?.dataStreams || []).find((d) => d.webStreamData?.measurementId === prop.ga4);
              if (st) { pid = ps.property.replace('properties/', ''); streamName = st.name; break; }
            }
            if (pid) break;
          }
          if (!pid) skip(GA, `no property with stream ${prop.ga4} visible to this token`);
        }
      }
      if (pid) await ga4Rules(pid, streamName);
    } catch (e) { skip(GA.filter((g) => !res.some((r) => r.rule === g)), `GA4 unreachable: ${e.cause?.code || e.name}`); }
  }

  async function ga4Rules(pid, streamName) {
    const P = `properties/${pid}`;
    if (!streamName) {
      const ds = await call(`${ADMIN}/${P}/dataStreams?pageSize=200`);
      streamName = (ds.body?.dataStreams || []).find((d) => d.webStreamData?.measurementId === prop.ga4)?.name;
    }
    const events = Object.entries(plan.events);
    // G1 key events match the plan
    const ke = await call(`${ADMIN}/${P}/keyEvents?pageSize=200`);
    if (!ke.ok) add('G1', 'SKIP', `keyEvents ${failed(ke)}`);
    else {
      const have = new Set((ke.body?.keyEvents || []).map((k) => k.eventName));
      const want = new Set(events.filter(([, e]) => e.key_event).map(([n]) => n));
      const miss = [...want].filter((n) => !have.has(n));
      const extra = [...have].filter((n) => !want.has(n));
      add('G1', miss.length || extra.length ? 'FAIL' : 'PASS', miss.length || extra.length ? `key events differ from plan: missing [${miss}] extra [${extra}]` : `${want.size} key events match the plan`);
    }
    // G2 custom dims match the plan
    const cd = await call(`${ADMIN}/${P}/customDimensions?pageSize=200`);
    if (!cd.ok) add('G2', 'SKIP', `customDimensions ${failed(cd)}`);
    else {
      const have = new Set((cd.body?.customDimensions || []).filter((d) => d.scope === 'EVENT').map((d) => d.parameterName));
      const want = new Set(events.flatMap(([, e]) => Object.entries(e.params || {}).filter(([, p]) => p.dim).map(([n]) => n)));
      const miss = [...want].filter((n) => !have.has(n));
      add('G2', miss.length ? 'FAIL' : 'PASS', miss.length ? `plan dims not registered in GA4: [${miss}]` : `${want.size} plan dims registered`);
    }
    // G3/G4 28 d event report
    const rep = await call(`${DATA}/${P}:runReport`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }], dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }], limit: 1000 }) });
    if (!rep.ok) skip(['G3', 'G4'], `runReport events ${failed(rep)}`);
    else {
      const seen = new Set((rep.body?.rows || []).map((r) => r.dimensionValues[0].value));
      const GA_AUTO = new Set(['page_view', 'session_start', 'first_visit', 'user_engagement', 'scroll', 'click', 'file_download', 'form_start', 'form_submit', 'video_start', 'video_progress', 'video_complete', 'view_search_results']);
      const silent = events.filter(([, e]) => (e.sinks || ['ga4']).includes('ga4')).map(([n]) => n).filter((n) => !seen.has(n));
      add('G3', silent.length ? 'FAIL' : 'PASS', silent.length ? `plan events with 0 fires in 28 d: [${silent}]` : 'every GA4 plan event fired in 28 d');
      const unplanned = [...seen].filter((n) => !plan.events[n] && !GA_AUTO.has(n));
      add('G4', unplanned.length ? 'FAIL' : 'PASS', unplanned.length ? `events seen but not in the plan: [${unplanned}]` : 'no unplanned events');
    }
    // G5 non-prod hostname share
    const hs = await call(`${DATA}/${P}:runReport`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }], dimensions: [{ name: 'hostName' }], metrics: [{ name: 'sessions' }], limit: 1000 }) });
    if (!hs.ok) add('G5', 'SKIP', `runReport hostName ${failed(hs)}`);
    else {
      let tot = 0; let bad = 0;
      for (const r of hs.body?.rows || []) { const n = Number(r.metricValues[0].value) || 0; tot += n; if (!prop.hosts.includes(r.dimensionValues[0].value)) bad += n; }
      const pct = tot ? (100 * bad) / tot : 0;
      add('G5', pct > 5 ? 'FAIL' : 'PASS', `non-prod hostname share ${pct.toFixed(1)}% of ${tot} sessions (limit 5%)`);
    }
    // G6 page-path query keys outside the allowlist (names + counts only)
    const pq = await call(`${DATA}/${P}:runReport`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }], dimensions: [{ name: 'pagePathPlusQueryString' }], metrics: [{ name: 'screenPageViews' }], limit: 10000 }) });
    if (!pq.ok) add('G6', 'SKIP', `runReport pagePathPlusQueryString ${failed(pq)}`);
    else {
      const bad = new Map(); let redacted = 0;
      for (const r of pq.body?.rows || []) {
        const n = Number(r.metricValues[0].value) || 0;
        for (const q of queryKeys(r.dimensionValues[0].value)) {
          if (allowed(q.key, prop.url_params)) continue;
          if (q.redacted) redacted += n; else bad.set(q.key, (bad.get(q.key) || 0) + n);
        }
      }
      const list = [...bad].map(([k, n]) => `${k} (${n})`).join(', ');
      add('G6', bad.size ? 'FAIL' : 'PASS', bad.size ? `query keys outside the allowlist in 28 d page paths: ${list}${redacted ? `; ${redacted} more already (redacted)` : ''}` : `no off-allowlist query keys${redacted ? ` (${redacted} (redacted) views counted apart)` : ''}`);
    }
    // G7 retention 14 months, signals off
    const rt = await call(`${ADMIN}/${P}/dataRetentionSettings`);
    if (!rt.ok) add('G7', 'SKIP', `dataRetentionSettings ${failed(rt)}`);
    else {
      const v = rt.body?.eventDataRetention;
      const sg = await call(`${ADMIN}/${P}/googleSignalsSettings`);
      const sigOff = sg.ok ? sg.body?.state !== 'GOOGLE_SIGNALS_ENABLED' : null;
      const probs = [];
      if (v !== 'FOURTEEN_MONTHS') probs.push(`retention ${v || 'unknown'} (want FOURTEEN_MONTHS)`);
      if (sigOff === false) probs.push('Google signals enabled');
      add('G7', probs.length ? 'FAIL' : 'PASS', probs.length ? probs.join('; ') : `retention 14 months${sigOff === null ? '; signals unchecked' : ', signals off'}`);
    }
    // G8 query-key redaction on with the fleet list
    if (!streamName) add('G8', 'SKIP', 'web stream not found');
    else {
      const dr = await call(`${ADMIN_ALPHA}/${streamName}/dataRedactionSettings`);
      if (!dr.ok) add('G8', 'SKIP', `dataRedactionSettings ${failed(dr)}`);
      else {
        const have = new Set((dr.body?.queryParameterKeys || []).map((k) => k.toLowerCase()));
        const miss = REDACTION_KEYS.filter((k) => !have.has(k));
        const on = dr.body?.queryParameterRedactionEnabled === true;
        add('G8', !on || miss.length ? 'FAIL' : 'PASS', !on ? 'query-parameter redaction is off' : miss.length ? `redaction keys missing: [${miss}]` : 'query-key redaction on with the fleet key list');
      }
    }
  }

  // ---- Search ----
  const origin = new URL(siteUrl);
  const sm = await text(`${siteUrl}/sitemap.xml`);
  const rb = await text(`${siteUrl}/robots.txt`);
  if (!token) skip(['S1', 'S3'], 'no GOOGLE_OAUTH_ACCESS_TOKEN');
  else {
    try {
      const sites = await call(`${GSC}/sites`);
      if (!sites.ok) skip(['S1', 'S3'], `GSC sites ${failed(sites)}`);
      else {
        const entry = (sites.body?.siteEntry || []).find((s) => [`sc-domain:${prop.domain}`, `${siteUrl}/`, `https://${prop.domain}/`].includes(s.siteUrl) && s.permissionLevel !== 'siteUnverifiedUser');
        add('S1', entry ? 'PASS' : 'FAIL', entry ? 'domain verified in Search Console' : 'domain not verified in Search Console');
        if (!entry) add('S3', 'SKIP', 'no verified GSC property');
        else {
          const sl = await call(`${GSC}/sites/${encodeURIComponent(entry.siteUrl)}/sitemaps`);
          if (!sl.ok) add('S3', 'SKIP', `GSC sitemaps ${failed(sl)}`);
          else {
            const errs = (sl.body?.sitemap || []).reduce((n, s) => n + (Number(s.errors) || 0), 0);
            add('S3', errs ? 'FAIL' : 'PASS', errs ? `${errs} GSC sitemap errors` : 'GSC sitemap errors = 0');
          }
        }
      }
    } catch (e) { skip(['S1', 'S3'].filter((g) => !res.some((r) => r.rule === g)), `GSC unreachable: ${e.cause?.code || e.name}`); }
  }
  if (!bingKey) add('S2', 'SKIP', 'no BING_WEBMASTER_API_KEY');
  else {
    try {
      const b = await call(`${BING}/GetUserSites?apikey=${encodeURIComponent(bingKey)}`, {}, false);
      if (!b.ok) add('S2', 'SKIP', `Bing GetUserSites ${failed(b)}`);
      else {
        const hit = (b.body?.d || []).find((s) => { try { return new URL(s.Url).hostname.replace(/^www\./, '') === prop.domain.replace(/^www\./, ''); } catch { return false; } });
        add('S2', hit?.IsVerified ? 'PASS' : 'FAIL', hit?.IsVerified ? 'domain verified in Bing Webmaster Tools' : 'domain not verified in Bing Webmaster Tools');
      }
    } catch (e) { add('S2', 'SKIP', `Bing unreachable: ${e.cause?.code || e.name}`); }
  }
  if (sm.error || rb.error) add('S4', 'SKIP', `site unreachable: ${sm.error || rb.error}`);
  else {
    const probs = [];
    if (sm.status !== 200) probs.push(`sitemap.xml HTTP ${sm.status}`); else if (!hasLastmod(sm.text)) probs.push('sitemap has no <lastmod>');
    if (rb.status !== 200 || !/^\s*sitemap:/im.test(rb.text)) probs.push('robots.txt does not name the sitemap');
    add('S4', probs.length ? 'FAIL' : 'PASS', probs.length ? probs.join('; ') : 'sitemap 200 with lastmod; robots.txt names it');
  }

  // ---- Live page ----
  const home = await text(`${siteUrl}/`);
  if (home.error) skip(['L1', 'L2', 'L3'], `site unreachable: ${home.error}`);
  else {
    const nf = await text(`${origin.origin}/__analytics-audit-${Date.now().toString(36)}-nope`);
    if (nf.error) add('L1', 'SKIP', `site unreachable: ${nf.error}`);
    else add('L1', nf.status === 404 ? 'PASS' : 'FAIL', nf.status === 404 ? 'unknown path returns 404' : `unknown path returns HTTP ${nf.status} (soft 404)`);
    const blocks = jsonLdBlocks(home.text);
    const badLd = blocks.filter((b) => !b).length;
    add('L2', badLd ? 'FAIL' : 'PASS', badLd ? `${badLd} of ${blocks.length} JSON-LD blocks do not parse or lack @type` : `${blocks.length} JSON-LD blocks parse with @type`);
    const g = gtagLoads(home.text);
    add('L3', g === 1 ? 'PASS' : 'FAIL', `home page loads gtag/js ${g} time(s) (want exactly 1)`);
  }
  return res;
}

export const TODO = [
  'Retention 14 months on every property still at 2 months (G7): analytics ga retention <site>.',
  `Data redaction on every web stream, query keys ${REDACTION_KEYS.join(', ')} (G8); GA4 admin, 30 keys max.`,
  'Data filters: developer traffic (Exclude) and web hostname (Include only the plan hosts), created in Testing, Active after 48 h of only dev rows; Active filters are permanent (G5).',
  'Unwanted referrals: checkout.stripe.com on every property with a checkout.',
  'From each merged plan: register key events and custom dims (G1, G2); archive default purchase where no pay event exists.',
  'Verify the bimcli.com web stream; verify smalltigergroup.com home page carries gtag.',
  'Monthly Bing AI Performance snapshot (no API).',
];

export const exitCode = (res) => (res.some((r) => r.state === 'FAIL') ? 1 : res.some((r) => r.state === 'SKIP') ? 3 : 0);

async function main(argv) {
  const at = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const repo = at('--repo') || process.cwd();
  const planFile = at('--plan') || path.join(repo, 'analytics.plan.json');
  const { plan, reason } = readPlan(planFile);
  if (!plan) { console.error(`analytics-audit: ${reason}`); return 2; }
  if (!plan.property?.domain || !plan.events) { console.error('analytics-audit: plan lacks property.domain or events (run the analytics-web lint)'); return 2; }
  const res = await audit(plan, { siteUrl: at('--site-url'), property: at('--property') });
  if (argv.includes('--json')) console.log(JSON.stringify({ results: res, todo: TODO }, null, 2));
  else {
    for (const r of res) console.log(`${r.state.padEnd(4)} ${r.rule}  ${r.what}`);
    console.log('\nCoordinator to-do (admin steps this script never performs):');
    TODO.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  }
  return exitCode(res);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`analytics-audit: ${e.message}`); process.exitCode = 2; });
