#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile analytics-web); do not edit -- re-run sync.
// Zero dependencies, offline. Lints a site's tier-1 analytics code against its own analytics.plan.json: plan valid (A1),
// one gtag tag (A2), events named in the plan (A3), no PII params (A4), host gate (A5), consent default + URL allowlist (A6),
// no PostHog at tier 1 (A7), UTM shape (A8). Rules: RULES.md here; standard: the kit's docs/analytics.md.
//
//   node .standards/analytics-web/lint.mjs [repo-root]
//
// Findings print `standards: FAIL|WARN [analytics-web/A<n>] <file>[:<line>]: <what> (fix: ...)`. Matched values (param
// values, UTM values, URLs) are NEVER printed -- only where they are. WARN does not fail the gate.
// Suppress one line (this line or the one above): `standards: analytics-ok -- <reason>`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CODE = /\.(html|astro|njk|ts|tsx|js|mjs|vue)$/;
const PROSE = /\.(md|mdx)$/;
const JS_ONLY = /\.(ts|tsx|js|mjs)$/;
const SKIP = /(^|\/)(node_modules|\.standards|vendor|dist|build|out|\.output|\.astro|\.next|\.svelte-kit|\.wrangler|coverage|\.git)\//;
const TEST = /(^|\/)(tests?|__tests__|__mocks__|spec|e2e|fixtures?|testdata)\/|\.(test|spec)\.[a-z]+$/;
const MAX = 5_000_000;
const MARKER = /standards:\s*analytics-ok\s+--\s*\S/;

const NAME = /^[a-z][a-z0-9_]{1,39}$/;
const PARAM = /^[a-z][a-z0-9_]{0,39}$/;
const STAGES = ['landing', 'engage', 'activate', 'convert', 'pay'];
const SINKS = ['ga4', 'ae', 'posthog'];
const PII_KEYS = ['address', 'email', 'phone', 'name', 'lat', 'lng', 'lon', 'q', 'query', 'ip', 'street', 'unit', 'parcel', 'latitude', 'longitude', 'zip', 'postal_code', 'city'];
const MEDIUMS = ['social', 'video', 'email', 'referral', 'community', 'partner', 'ai-agent'];
const BUILTIN_EVENTS = new Set(['page_view']);
const POSTHOG = /posthog-js|posthog\.init\s*\(|\b(us|eu|app)(\.i)?\.posthog\.com|posthog\.com\/static|\bposthog-node\b/;
const GTAG_JS = /googletagmanager\.com\/gtag\/js/g;
const GTAG_CONFIG = /\bgtag\s*\(\s*['"`]config['"`]/g;
const CONSENT_DEFAULT = /\bgtag\s*\(\s*['"`]consent['"`]\s*,\s*['"`]default['"`]/;
const SINK_INIT = /\binitAnalytics\s*\(|\binitSnippet\s*\(/;
const FN_DECL = /function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/g;

export function tracked(root) {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${(r.stderr || '').trim()}`);
  return r.stdout.split('\0').filter(Boolean);
}

function readText(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX) return null;
    const buf = fs.readFileSync(abs);
    return buf.includes(0) ? null : buf.toString('utf8');
  } catch { return null; }
}

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// Text of a call's argument list starting just after its "(" (balanced, strings respected, capped).
export function argsAt(text, open) {
  let depth = 1, q = '';
  for (let i = open; i < text.length && i < open + 2000; i++) {
    const c = text[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) return text.slice(open, i); }
  }
  return text.slice(open, open + 2000);
}

// First argument: { lit } for a plain string literal, { dyn: true } for anything computed (including `x_${y}`).
export function firstArg(args) {
  const m = /^\s*(['"])([^'"\\\n]*)\1\s*(,|$)/.exec(args);
  if (m) return { lit: m[2] };
  const b = /^\s*`([^`$\\]*)`\s*(,|$)/.exec(args);
  if (b) return { lit: b[1] };
  return { dyn: true };
}

export function validatePlan(plan) {
  const bad = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return ['not a JSON object'];
  if (plan.schema !== 'analytics-plan/1') bad.push('"schema" must be "analytics-plan/1"');
  if (plan.tier !== 1 && plan.tier !== 2) bad.push('"tier" must be 1 or 2');
  const p = plan.property;
  if (!p || typeof p !== 'object') bad.push('"property" is missing');
  else {
    if (typeof p.domain !== 'string' || !p.domain) bad.push('property.domain must be a string');
    if (!Array.isArray(p.hosts) || !p.hosts.length || p.hosts.some((h) => typeof h !== 'string' || !h)) bad.push('property.hosts must list every production hostname');
    if (typeof p.ga4 !== 'string' || !/^G-[A-Z0-9]+$/.test(p.ga4)) bad.push('property.ga4 must be a G-XXXX measurement id');
    if (!('posthog' in p)) bad.push('property.posthog is required (null at tier 1)');
    else if (plan.tier === 1 && p.posthog !== null) bad.push('property.posthog must be null at tier 1 (PostHog is tier 2)');
    else if (plan.tier === 2 && !(p.posthog && p.posthog.project !== undefined && typeof p.posthog.decision === 'string' && p.posthog.decision)) bad.push('at tier 2 property.posthog must be { project, decision } (Decision Log link)');
    if (p.url_params !== undefined && (!Array.isArray(p.url_params) || p.url_params.some((k) => typeof k !== 'string'))) bad.push('property.url_params must be a list of strings');
  }
  if (plan.wrappers !== undefined && (!Array.isArray(plan.wrappers) || plan.wrappers.some((w) => typeof w !== 'string'))) bad.push('"wrappers" must be a list of function names');
  const ev = plan.events;
  if (!ev || typeof ev !== 'object' || Array.isArray(ev) || !Object.keys(ev).length) bad.push('"events" must list at least one event');
  else {
    let activate = 0;
    for (const [n, e] of Object.entries(ev)) {
      if (!NAME.test(n)) bad.push(`event name ${JSON.stringify(n)} must match ${NAME}`);
      if (!e || typeof e !== 'object') { bad.push(`event ${n} must be an object`); continue; }
      if (!STAGES.includes(e.stage)) bad.push(`event ${n}: stage must be one of ${STAGES.join(', ')}`);
      if (e.stage === 'activate') activate++;
      if (e.sinks !== undefined && (!Array.isArray(e.sinks) || e.sinks.some((s) => !SINKS.includes(s)))) bad.push(`event ${n}: sinks must be from ${SINKS.join(', ')}`);
      if (e.params !== undefined) {
        const keys = e.params && typeof e.params === 'object' ? Object.keys(e.params) : null;
        if (!keys) bad.push(`event ${n}: params must be an object`);
        else {
          if (keys.length > 25) bad.push(`event ${n}: more than 25 params`);
          for (const k of keys) if (!PARAM.test(k)) bad.push(`event ${n}: param name ${JSON.stringify(k)} must be snake_case`);
        }
      }
    }
    if (activate !== 1) bad.push(`exactly one event must have stage "activate" (found ${activate})`);
  }
  return bad;
}

export function lint(root) {
  const fails = [];
  const warns = [];
  const fail = (rule, where, what) => fails.push(`standards: FAIL [analytics-web/${rule}] ${where}: ${what}`);
  const files = tracked(root).filter((f) => !SKIP.test(f) && !f.startsWith('.standards/'));
  const text = new Map();
  const get = (f) => { if (!text.has(f)) text.set(f, readText(path.join(root, ...f.split('/')))); return text.get(f); };
  const warnAt = (rule, f, t, idx, what) => {
    const n = lineOf(t, idx);
    const lines = t.split('\n');
    if (MARKER.test(lines[n - 1] || '') || (n > 1 && MARKER.test(lines[n - 2] || ''))) return;
    warns.push(`standards: WARN [analytics-web/${rule}] ${f}:${n}: ${what}`);
  };

  // A1 the plan exists and is valid.
  let plan = null;
  const raw = get('analytics.plan.json');
  if (raw === null || raw === undefined) fail('A1', 'analytics.plan.json', 'missing (fix: add analytics.plan.json at the app root; shape in .standards/analytics-web/plan.schema.json)');
  else {
    try { plan = JSON.parse(raw); } catch (e) { fail('A1', 'analytics.plan.json', `does not parse (${e.message})`); }
    if (plan !== null) {
      const bad = validatePlan(plan);
      for (const b of bad) fail('A1', 'analytics.plan.json', `${b} (fix: see .standards/analytics-web/plan.schema.json)`);
      if (bad.length) plan = null;
    }
  }
  const planEvents = plan ? new Set(Object.keys(plan.events)) : null;
  const wrappers = new Set(plan && Array.isArray(plan.wrappers) ? plan.wrappers : []);

  // A4 on the plan itself: a PII-named param is a design error before any code exists.
  if (plan) {
    for (const [n, e] of Object.entries(plan.events)) {
      for (const k of Object.keys(e.params || {})) {
        if (PII_KEYS.includes(k)) warns.push(`standards: WARN [analytics-web/A4] analytics.plan.json: event ${n} declares a param named ${k}, which can carry personal data (fix: send a category or id, never the visitor's input)`);
      }
    }
  }

  for (const f of files) {
    const isCode = CODE.test(f);
    if (!isCode && !PROSE.test(f)) continue;
    const t = get(f);
    if (!t) continue;

    // A8 UTM shape, in code and prose.
    for (const m of t.matchAll(/utm_(source|medium|campaign|term|content)=([^&\s"'`#)<>\]]*)/g)) {
      const v = m[2];
      if (/[A-Z]/.test(v)) warnAt('A8', f, t, m.index, `a link's utm_${m[1]} has uppercase (fix: lowercase every utm value; GA4 treats case as a different source)`);
      else if (m[1] === 'medium' && v && !/[${}]/.test(v) && !MEDIUMS.includes(v)) warnAt('A8', f, t, m.index, `a link's utm_medium is not one of ${MEDIUMS.join(' | ')} (fix: pick from the fixed list)`);
    }
    if (!isCode || TEST.test(f)) continue;

    // A7 PostHog while the plan says tier 1.
    if (plan && plan.tier === 1) {
      const m = POSTHOG.exec(t);
      if (m) warnAt('A7', f, t, m.index, 'loads PostHog but analytics.plan.json says tier 1 (fix: remove it, or promote the property with a Decision Log entry and set tier 2)');
    }

    // A2 one tag per file; script code must not inject gtag/js.
    const loads = [...t.matchAll(GTAG_JS)];
    const cfgs = [...t.matchAll(GTAG_CONFIG)];
    if (loads.length > 1) warnAt('A2', f, t, loads[1].index, 'second gtag/js load in one page/layout (fix: one tag per page; a second one double-counts)');
    if (cfgs.length > 1) warnAt('A2', f, t, cfgs[1].index, "second gtag('config') in one page/layout (fix: one config per page; use initAnalytics)");
    if (JS_ONLY.test(f) && loads.length) warnAt('A2', f, t, loads[0].index, 'script code injects gtag/js (fix: the page template carries the one tag; call initAnalytics from it)');

    // A5/A6 host gate, consent default and URL allowlist before the first gtag('config'); initAnalytics does all three.
    const first = cfgs[0];
    if (first && !SINK_INIT.test(t)) {
      const before = t.slice(0, first.index);
      if (!/ga-disable-|\.hostname\b/.test(before)) warnAt('A5', f, t, first.index, "no host gate before gtag('config') (fix: call initAnalytics(plan), or set window['ga-disable-<id>'] when location.hostname is not in the plan's hosts)");
      if (!CONSENT_DEFAULT.test(before)) warnAt('A6', f, t, first.index, "no gtag('consent','default') before gtag('config') (fix: call initAnalytics(plan); it sets Consent Mode v2 defaults)");
      const args = argsAt(t, first.index + first[0].length);
      if (!/page_location\s*:\s*[^,}]*redactUrl\s*\(/.test(args)) warnAt('A6', f, t, first.index, "gtag('config') page_location does not go through redactUrl (fix: page_location: redactUrl(location.href))");
    }

    // A3/A4 event calls: track(...), gtag('event', ...), the plan's wrappers (callers are checked, not their bodies).
    const calls = [];
    for (const n of ['track', ...wrappers]) {
      const re = new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}\\s*\\(`, 'g');
      for (const m of t.matchAll(re)) {
        if (/function\s+$/.test(t.slice(Math.max(0, m.index - 12), m.index))) continue;
        calls.push({ i: m.index, name: n, args: argsAt(t, m.index + m[0].length) });
      }
    }
    for (const m of t.matchAll(/\bgtag\s*\(\s*['"`]event['"`]\s*,/g)) calls.push({ i: m.index, name: 'gtag', args: argsAt(t, m.index + m[0].length) });
    const decls = [...t.matchAll(FN_DECL)].map((d) => ({ at: d.index, name: d[1] || d[2] }));
    const piiRe = new RegExp(`[{,]\\s*['"]?(${PII_KEYS.join('|')})['"]?\\s*(?=[:,}])`, 'g');
    for (const c of calls) {
      const a = firstArg(c.args);
      if (a.lit !== undefined) {
        if (planEvents && !planEvents.has(a.lit) && !BUILTIN_EVENTS.has(a.lit)) warnAt('A3', f, t, c.i, `${c.name}() sends an event that is not in analytics.plan.json (fix: add it to the plan with a stage, or reuse a planned event; names are past tense snake_case)`);
      } else {
        const enc = decls.filter((d) => d.at < c.i).pop();
        const forwarding = c.name === 'track' && enc && wrappers.has(enc.name);
        if (!forwarding) warnAt('A3', f, t, c.i, `${c.name}() gets a computed event name (fix: one literal name per event and the variant as a param, e.g. tool_loaded {tool}; or list the forwarding function under "wrappers" in the plan)`);
      }
      const comma = c.args.indexOf(',');
      const rest = comma < 0 ? '' : c.args.slice(comma);
      for (const k of rest.matchAll(piiRe)) warnAt('A4', f, t, c.i, `${c.name}() sends a param named ${k[1]}, which can carry personal data (fix: send a category, count or id; never the visitor's input)`);
    }
  }
  return { fails, warns, plan: plan !== null };
}

export function main(root = process.cwd()) {
  const { fails, warns } = lint(root);
  for (const l of [...fails, ...warns]) console.log(l);
  if (fails.length) console.log(`standards: analytics-web: ${fails.length} finding(s)${warns.length ? `, ${warns.length} warning(s)` : ''}`);
  else console.log(`standards: [analytics-web/lint] OK${warns.length ? ` with ${warns.length} warning(s)` : ''}`);
  return fails.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
