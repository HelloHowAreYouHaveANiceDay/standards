// Vendored by HelloHowAreYouHaveANiceDay/standards (profile analytics-web); do not edit -- re-run sync.
// Zero-dep tier-1 sink: host gate, Consent Mode v2 defaults, URL allowlist, track(). Calls window.gtag only; never loads
// a second tag, never validates at runtime, never throws. PostHog is called at tier 2 only (this release: tier 1).
const ZONE = /^(Europe|Arctic)\/|^(Atlantic\/(Reykjavik|Canary|Madeira|Azores|Faroe|Faeroe|Jan_Mayen)|Asia\/(Nicosia|Famagusta)|America\/(Martinique|Guadeloupe|Cayenne|St_Barthelemy|Marigot)|Indian\/(Reunion|Mayotte))$/;
let state = { tier: 1, visit_id: false };

// EU/EEA/UK/CH by browser time zone (same definition as pdfmarkuptool consentRegion.ts); unreadable zone counts as inside.
export function inConsentRegion(zone) {
  try { if (zone === undefined) zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { zone = ''; }
  return !zone || ZONE.test(zone);
}

// Origin + path + allowlisted query keys ("utm_*" = prefix, else exact); fragment dropped. Bad input gives ''.
export function redactUrl(url, allow = ['utm_*', 'gclid']) {
  try {
    const u = new URL(url, globalThis.location ? globalThis.location.href : 'https://invalid.invalid/');
    const keep = new URLSearchParams();
    for (const [k, v] of u.searchParams) if (allow.some((p) => (p.endsWith('*') ? k.startsWith(p.slice(0, -1)) : k === p))) keep.append(k, v);
    const q = keep.toString();
    return u.origin + u.pathname + (q ? `?${q}` : '');
  } catch { return ''; }
}

function boot(c) {
  const w = globalThis.window || globalThis, id = c.ga4;
  if (w['__aw_' + id]) return false;
  w['__aw_' + id] = true;
  if (!c.hosts.includes(globalThis.location.hostname)) { w['ga-disable-' + id] = true; return false; }
  w.dataLayer = w.dataLayer || [];
  w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
  w.gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: inConsentRegion() ? 'denied' : 'granted' });
  w.gtag('js', new Date());
  w.gtag('config', id, { allow_google_signals: false, page_location: redactUrl(globalThis.location.href, c.url_params) });
  return true;
}

const cfgOf = (plan) => ({ ga4: plan.property.ga4, hosts: plan.property.hosts, url_params: plan.property.url_params || ['utm_*', 'gclid'] });

// Call inline before the gtag/js script. Returns false when the host gate or an earlier call stopped it.
export function initAnalytics(plan) {
  try { state = { tier: plan.tier, visit_id: !!plan.visit_id }; return boot(cfgOf(plan)); } catch { return false; }
}

// Inline <script> body for static sites (no bundler): the same code, serialized.
export function initSnippet(plan) {
  return `(function(){const ZONE=${ZONE};${inConsentRegion}${redactUrl}${boot}boot(${JSON.stringify(cfgOf(plan))});})();`;
}

// One call per event. Values cut to 100 chars, 25 params max; posthog only at tier 2.
export function track(name, params = {}) {
  try {
    const w = globalThis.window;
    if (!w) return;
    const p = {};
    for (const [k, v] of Object.entries(params || {}).slice(0, 25)) p[k] = typeof v === 'string' ? v.slice(0, 100) : v;
    if (typeof w.gtag === 'function') w.gtag('event', name, p);
    if (state.tier === 2 && w.posthog && typeof w.posthog.capture === 'function') w.posthog.capture(name, p);
  } catch { /* analytics never breaks the page */ }
}

// Per-tab random id for our own server (x-visit-id), only when the plan sets visit_id; never sent to GA4.
let visit = null;
export function visitId() {
  try {
    if (!state.visit_id) return null;
    if (visit) return visit;
    const mk = () => (globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : String(Math.random()).slice(2));
    const ss = !inConsentRegion() && globalThis.sessionStorage;
    visit = (ss && ss.getItem('aw_visit')) || mk();
    if (ss) ss.setItem('aw_visit', visit);
    return visit;
  } catch { return null; }
}
