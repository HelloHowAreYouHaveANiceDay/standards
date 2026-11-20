#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile ui-kit); do not edit -- re-run sync.
// Zero dependencies, offline. Checks a repo's UI design pack against the org contract (contract.json): pack manifest and
// vendored files (UK1), required roles and 4px/touch/focus floors (UK2), WCAG AA contrast pairs (UK3), ink and type-size
// budgets (UK4), colour literals outside the pack (UK5), visible focus (UK6), reduced motion (UK7), token naming (UK8),
// the brand book (UK9 brand block + required files, UK10 SVG hygiene + logo colours = pack tokens, UK11 raster sizes,
// UK12 served copies byte-equal to design/brand/ masters).
// Rules: RULES.md here; standard text: the kit's docs/ui-kit.md.
//
//   node .standards/ui-kit/lint.mjs [repo-root]
//
// Findings print `standards: FAIL|WARN [ui-kit/UK<n>] <file>[:<line>]: <what> (fix: ...)`. WARN does not fail the gate.
// Suppress one raw colour literal (this line or the one above): `ui-kit: raw-color -- <reason>`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseColor, contrast, hexOf, pairResults, inkResults } from './contrast.mjs';

export { parseColor, contrast };

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONTRACT = JSON.parse(fs.readFileSync(path.join(HERE, 'contract.json'), 'utf8'));

const SKIP = /(^|\/)(node_modules|\.standards|dist|build|out|\.output|\.astro|\.next|\.svelte-kit|\.wrangler|coverage|\.git)\//;
const MAX = 5_000_000;
const CAP = 20; // findings per rule per file before "+N more"
const MARKER = /ui-kit:\s*raw-color\s+--\s*\S/;
const SEG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CATS = [...CONTRACT.categories].sort((a, b) => b.length - a.length);

// ---------- helpers ----------
const posix = (p) => p.split(path.sep).join('/');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

function readText(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX) return null;
    const buf = fs.readFileSync(abs);
    return buf.includes(0) ? null : buf.toString('utf8').replace(/\r\n/g, '\n');
  } catch { return null; }
}

export function repoFiles(root) {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.status === 0) return [...new Set(r.stdout.split('\0').filter(Boolean))].filter((f) => fs.existsSync(path.join(root, f)));
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r2 = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === '.git' || e.name === 'node_modules') continue;
      if (e.isDirectory()) walk(r2); else out.push(r2);
    }
  };
  walk('');
  return out;
}

export function globRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{' && g.indexOf('}', i) > i) { const e = g.indexOf('}', i); re += `(?:${g.slice(i + 1, e).split(',').map(esc).join('|')})`; i = e; }
    else re += esc(c);
  }
  return new RegExp(`^${re}$`);
}

// ---------- CSS ----------
// Flat rule list: { sel, ctx: [enclosing preludes], decls: [{prop, value, line}], line }. Comments dropped, strings and
// parentheses respected, nested rules and at-rules flattened (their preludes land in ctx).
export function parseCss(text) {
  const rules = [];
  const stack = [];
  let buf = '', bufLine = 1, line = 1, paren = 0, q = '';
  const push = (ch) => { if (!buf.trim() && !/\s/.test(ch)) bufLine = line; buf += ch; };
  const flush = () => {
    const s = buf.trim();
    if (s && stack.length) {
      const c = s.indexOf(':');
      if (c > 0) stack[stack.length - 1].decls.push({ prop: s.slice(0, c).trim(), value: s.slice(c + 1).trim().replace(/\s+/g, ' '), line: bufLine });
    }
    buf = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      push(ch);
      if (ch === '\\') { i++; if (i < text.length) push(text[i]); } else if (ch === q) q = '';
      else if (ch === '\n') line++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      const end = e < 0 ? text.length : e + 2;
      for (let k = i; k < end; k++) if (text[k] === '\n') line++;
      i = end - 1;
      continue;
    }
    if (ch === '\n') { line++; buf += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; push(ch); continue; }
    if (ch === '(') { paren++; push(ch); continue; }
    if (ch === ')') { paren = Math.max(0, paren - 1); push(ch); continue; }
    if (paren > 0) { push(ch); continue; }
    if (ch === '{') {
      const prelude = buf.trim();
      stack.push({ prelude, line: prelude ? bufLine : line, decls: [], at: prelude.startsWith('@') });
      buf = '';
    } else if (ch === '}') {
      flush();
      const f = stack.pop();
      if (f && !f.at) rules.push({ sel: f.prelude, ctx: stack.map((x) => x.prelude).filter(Boolean), decls: f.decls, line: f.line });
    } else if (ch === ';') flush();
    else push(ch);
  }
  return rules;
}

export const normSel = (s) => s.toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').replace(/:\s+/g, ':').replace(/\s*([,>+~=()])\s*/g, '$1').trim();

function splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--;
    if (c === ',' && d === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

// Every key a theme entry may name this rule by: each selector alone, and `<at-rule prelude> <selector>`.
function ruleKeys(rule) {
  const keys = new Set();
  const ctx = rule.ctx.join(' ');
  for (const s of splitTop(rule.sel)) {
    keys.add(normSel(s));
    if (ctx) keys.add(normSel(`${ctx} ${s}`));
  }
  return keys;
}

// ---------- values ----------
export function subst(value, lookup, depth = 0) {
  if (depth > 12) return null;
  let out = '', i = 0;
  while (i < value.length) {
    const m = /var\(\s*(--[\w-]+)\s*/y;
    const at = value.indexOf('var(', i);
    if (at < 0) { out += value.slice(i); break; }
    out += value.slice(i, at);
    m.lastIndex = at;
    const mm = m.exec(value);
    if (!mm) return null;
    let d = 1, j = at + 4;
    for (; j < value.length && d > 0; j++) { if (value[j] === '(') d++; else if (value[j] === ')') d--; }
    const inner = value.slice(at + 4, j - 1);
    const comma = inner.indexOf(',');
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
    let got = lookup(name);
    if (got === undefined || got === null) got = fallback;
    if (got === null || got === undefined) return null;
    const r = subst(got, lookup, depth + 1);
    if (r === null) return null;
    out += r;
    i = j;
  }
  return out.trim().replace(/\s*!important$/i, '');
}

export function parsePx(raw) {
  const m = /^(-?\d*\.?\d+)(px|rem)?$/.exec(String(raw).trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2] === 'rem') return n * 16;
  if (m[2] === 'px' || n === 0) return n;
  return null;
}

// ---------- pack manifest ----------
function validatePack(p, { vendored }) {
  const bad = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['not a JSON object'];
  if (typeof p.pack !== 'string' || !/^[a-z][a-z0-9-]*$/.test(p.pack)) bad.push('"pack" must be a lowercase kebab name');
  if (typeof p.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(p.version)) bad.push('"version" must be x.y.z');
  const arr = (k, req) => {
    if (p[k] === undefined) { if (req) bad.push(`"${k}" is required`); return; }
    if (!Array.isArray(p[k]) || p[k].some((x) => typeof x !== 'string' || !x)) bad.push(`"${k}" must be an array of non-empty strings`);
    else if (p[k].some((x) => path.isAbsolute(x) || x.split(/[\\/]/).includes('..'))) bad.push(`"${k}" paths must stay inside the repo`);
  };
  arr('tokens', true);
  if (Array.isArray(p.tokens) && p.tokens.length === 0) bad.push('"tokens" lists no file');
  arr('base', false);
  if (p.storybook !== undefined && !(typeof p.storybook === 'string' && /^https:\/\/[^\s"'<>]+$/.test(p.storybook))) bad.push('"storybook" must be an https URL');
  arr('sources', !vendored);
  if (p.extensions !== undefined && (!Array.isArray(p.extensions) || p.extensions.some((e) => typeof e !== 'string' || !SEG.test(e)))) bad.push('"extensions" must be an array of lowercase kebab role names');
  if (p.budgets !== undefined) {
    const b = p.budgets;
    if (!b || typeof b !== 'object' || Array.isArray(b)) bad.push('"budgets" must be an object {inks, sizes}');
    else for (const k of ['inks', 'sizes']) if (b[k] !== undefined && b[k] !== null && !(Number.isInteger(b[k]) && b[k] > 0)) bad.push(`budgets.${k} must be a positive integer or null`);
  }
  const own = vendored || p.vendor === undefined;
  if (own) {
    if (typeof p.prefix !== 'string' || !/^[a-z]{2,5}$/.test(p.prefix)) bad.push('"prefix" must be 2-5 lowercase letters (the pack\'s private --<prefix>-* namespace)');
    else if (p.prefix === CONTRACT.reservedPrefix) bad.push(`prefix "${CONTRACT.reservedPrefix}" is reserved for the public names`);
    const t = p.themes;
    if (!t || typeof t !== 'object' || Array.isArray(t)) bad.push('"themes" must be an object with a "light" selector list');
    else {
      if (!Array.isArray(t.light) || t.light.length === 0 || t.light.some((x) => typeof x !== 'string' || !x)) bad.push('themes.light must list at least one selector');
      for (const [k, v] of Object.entries(t)) {
        if (k === 'light') continue;
        if (!/^[a-z][a-z0-9-]*$/.test(k) || !Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== 'string' || !x)) bad.push(`themes.${k} must be a kebab name with a non-empty selector list`);
      }
    }
    if (p.vendor !== undefined) bad.push('a vendored pack.json does not itself vendor a pack');
  } else {
    if (typeof p.vendor !== 'string' || !p.vendor) bad.push('"vendor" must be a path');
    else if (path.isAbsolute(p.vendor) || p.vendor.split(/[\\/]/).includes('..')) bad.push('"vendor" must stay inside the repo');
    if (p.prefix !== undefined) bad.push('a converging pack takes its prefix from the vendored pack.json; drop "prefix"');
    if (p.themes !== undefined) bad.push('a converging pack inherits "themes" from the vendored pack.json; drop "themes"');
  }
  return bad;
}

function parseSums(text) {
  const out = new Map();
  for (const l of text.split('\n')) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(l.trim());
    if (m) out.set(m[2], m[1]); else if (l.trim()) out.set(`\0bad:${l}`, '');
  }
  return out;
}

function listFiles(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, r)); else out.push(r);
  }
  return out;
}

// ---------- naming (UK8) ----------
const VARIANT = new Set(CONTRACT.variants);
const STATE = new Set(CONTRACT.states);
const restOk = (segs) => segs.every((s) => VARIANT.has(s) || STATE.has(s) || /^\d+$/.test(s));

// null when `--ui-<body>` is a valid public name for this pack, else why not.
export function checkPublicName(name, exts) {
  const body = name.slice('--ui-'.length);
  if (!SEG.test(body)) return 'public names are lowercase kebab, segments [a-z0-9]+';
  const cat = CATS.find((c) => body === c || body.startsWith(`${c}-`));
  if (!cat) return `"${body.split('-')[0]}" is not a category (${CONTRACT.categories.join(', ')})`;
  const rest = body.slice(cat.length + 1);
  if (!rest) return `no role after the category "${cat}"`;
  const segs = rest.split('-');
  for (let i = 0; i < segs.length; i++) {
    if (STATE.has(segs[i]) && i !== segs.length - 1) return `state "${segs[i]}" must be the last segment (order: role, variant, state)`;
    if (VARIANT.has(segs[i]) && (i === 0 || (i < segs.length - 1 && !STATE.has(segs[i + 1])))) return `variant "${segs[i]}" must follow the role and precede the state (order: role, variant, state)`;
  }
  const known = CONTRACT.known[cat] || {};
  if (known.open) return null;
  for (const role of known.roles || []) {
    const rs = role.split('-');
    if (rs.every((x, i) => segs[i] === x) && restOk(segs.slice(rs.length))) return null;
  }
  for (const e of exts) {
    for (const head of [e, `on-${e}`]) {
      const hs = head.split('-');
      if (hs.every((x, i) => segs[i] === x)) return null;
    }
  }
  return `"${cat}-${rest}" is not a standard role and no entry of "extensions" in pack.json declares it`;
}

// ---------- brand book (UK9-UK12) ----------
const BR = CONTRACT.brand;
const BRAND_DIR = BR.dir;
const SVG_BAN = new Set(BR.svgBannedElements);

// Tiny XML tokenizer: well-formedness (tags nest and close, one root), element names and attributes. No entities, no DTD.
export function xmlElements(text) {
  const els = [];
  const stack = [];
  let rootSeen = false, i = 0;
  const TAG = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text)) return { error: 'declares entities or an internal DTD' };
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { if (text.slice(i).trim() && !stack.length) return { error: 'text outside the root element' }; break; }
    if (text.slice(i, lt).trim() && !stack.length) return { error: 'text outside the root element' };
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt + 4); if (e < 0) return { error: 'unterminated comment' }; i = e + 3; continue; }
    if (text.startsWith('<?', lt)) { const e = text.indexOf('?>', lt + 2); if (e < 0) return { error: 'unterminated processing instruction' }; i = e + 2; continue; }
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt + 9); if (e < 0) return { error: 'unterminated CDATA' }; i = e + 3; continue; }
    if (text.startsWith('<!', lt)) { const e = text.indexOf('>', lt + 2); if (e < 0) return { error: 'unterminated declaration' }; i = e + 1; continue; }
    TAG.lastIndex = lt;
    const m = TAG.exec(text);
    if (!m) return { error: `malformed tag near line ${lineOf(text, lt)}` };
    const [all, close, name, attrText, self] = m;
    i = lt + all.length;
    if (close) {
      if (self || attrText.trim()) return { error: `malformed closing tag </${name}> near line ${lineOf(text, lt)}` };
      if (stack.pop() !== name) return { error: `</${name}> closes the wrong element near line ${lineOf(text, lt)}` };
      continue;
    }
    if (!stack.length) { if (rootSeen) return { error: 'more than one root element' }; rootSeen = true; }
    const attrs = {};
    for (const a of attrText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] ?? a[3];
    els.push({ name, attrs, line: lineOf(text, lt) });
    if (!self) stack.push(name);
  }
  if (!rootSeen) return { error: 'no root element' };
  if (stack.length) return { error: `<${stack.at(-1)}> is never closed` };
  return { els };
}

// every fill / stroke / stop-color value an SVG sets, as attribute or CSS declaration
export function svgPaints(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![\w-])(fill|stroke|stop-color)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^;}"'\s>]+))/g)) {
    const v = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    out.push({ prop: m[1], value: v, line: lineOf(text, m.index) });
  }
  return out;
}

export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

export function icoSizes(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  const n = buf.readUInt16LE(4);
  if (n < 1 || buf.length < 6 + 16 * n) return null;
  const out = [];
  for (let k = 0; k < n; k++) { const o = 6 + 16 * k; out.push({ w: buf[o] || 256, h: buf[o + 1] || 256 }); }
  return out;
}

const underBrand = (rel) => typeof rel === 'string' && !path.isAbsolute(rel) && !rel.split(/[\\/]/).includes('..') && rel.replace(/\\/g, '/').startsWith(`${BRAND_DIR}/`);

// ctx: { declared: Set of token names, colorOf(name) -> {c} | null, fail, warn }
export function brandLint(root, pack, ctx) {
  const { declared, colorOf, fail, warn } = ctx;
  const PACK = 'design/pack.json';
  const exists = (rel) => fs.existsSync(path.join(root, rel));
  const b = pack.brand;
  if (b === undefined) { warn('UK9', PACK, null, `no "brand" block and no ${BRAND_DIR}/ brand book`, 'add a "brand" block to pack.json and the files from .standards/ui-kit/templates/pack/brand/ (RULES.md "Brand")'); return; }
  const bad = [];
  if (!b || typeof b !== 'object' || Array.isArray(b)) { fail('UK9', PACK, null, '"brand" must be an object', 'see RULES.md "Brand"'); return; }
  if (typeof b.name !== 'string' || !b.name.trim()) bad.push('brand.name is required (the display name, exact casing)');
  const cs = b.clearspace;
  if (cs !== undefined && !(typeof cs === 'number' && cs >= BR.clearspace.min && cs <= BR.clearspace.max)) bad.push(`brand.clearspace must be a number from ${BR.clearspace.min} to ${BR.clearspace.max} (x mark height)`);
  if (b.min_px !== undefined && !(Number.isInteger(b.min_px) && b.min_px >= BR.minPx)) bad.push(`brand.min_px must be an integer of at least ${BR.minPx}`);
  if (b.wordmark !== undefined && !(b.wordmark && typeof b.wordmark === 'object' && !Array.isArray(b.wordmark) && typeof b.wordmark.font === 'string' && declared.has(b.wordmark.font))) bad.push('brand.wordmark.font must name a token the pack declares (for example --ui-font-sans)');
  let colors = [];
  if (b.colors !== undefined && !(Array.isArray(b.colors) && b.colors.every((x) => typeof x === 'string'))) bad.push('brand.colors must be an array of token names');
  else {
    colors = b.colors || [];
    for (const c of colors) if (!declared.has(c)) bad.push(`brand.colors names ${c}, which the pack does not declare`);
  }
  if (b.assets !== undefined && !(Array.isArray(b.assets) && b.assets.every((x) => typeof x === 'string' && x.trim()))) bad.push('brand.assets must be an array of non-empty strings');
  let served = {};
  if (b.served !== undefined) {
    if (!b.served || typeof b.served !== 'object' || Array.isArray(b.served)) bad.push('brand.served must be an object { served path: master path }');
    else {
      served = b.served;
      for (const [k, v] of Object.entries(served)) {
        if (!k || path.isAbsolute(k) || k.split(/[\\/]/).includes('..')) bad.push(`brand.served key "${k}" must be a repo-relative path`);
        if (!underBrand(v)) bad.push(`brand.served target for ${k} must be a file in ${BRAND_DIR}/`);
      }
    }
  }
  for (const p of bad) fail('UK9', PACK, null, p, 'see RULES.md "Brand"');
  for (const f of BR.required) if (!exists(`${BRAND_DIR}/${f}`)) fail('UK9', `${BRAND_DIR}/${f}`, null, 'required brand file is missing', 'add it (templates/pack/brand/ has the placeholder SVGs; `node .standards/ui-kit/placeholder-rasters.mjs` writes placeholder rasters)');
  if (exists(`${BRAND_DIR}/logo.svg`) && !exists(`${BRAND_DIR}/logo-mono.svg`)) fail('UK9', `${BRAND_DIR}/logo-mono.svg`, null, 'logo.svg exists, so logo-mono.svg is required', 'add the lockup drawn with fill="currentColor" only');

  // UK10: SVG masters
  const allowed = new Set();
  for (const c of colors) { const r = colorOf(c); if (r) allowed.add(hexOf(r.c)); }
  for (const f of ['mark.svg', 'mark-mono.svg', 'logo.svg', 'logo-mono.svg']) {
    const rel = `${BRAND_DIR}/${f}`;
    const text = readText(path.join(root, rel));
    if (text === null) continue;
    const x = xmlElements(text);
    if (x.error) { fail('UK10', rel, null, `is not well-formed XML (${x.error})`, 'export the SVG again'); continue; }
    const rootEl = x.els[0];
    if (rootEl.name !== 'svg' || !rootEl.attrs.viewBox) fail('UK10', rel, rootEl.line, 'root element must be <svg> with a viewBox', 'add viewBox="0 0 <w> <h>"');
    for (const el of x.els) {
      if (SVG_BAN.has(el.name.toLowerCase())) fail('UK10', rel, el.line, `<${el.name}> is not allowed in a logo master`, el.name.toLowerCase() === 'text' ? 'convert the text to outlines' : 'remove it; masters are plain shapes');
      for (const [a, v] of Object.entries(el.attrs)) {
        if (/^on/i.test(a)) fail('UK10', rel, el.line, `event attribute ${a}`, 'remove it');
        if (/^(xlink:)?href$/.test(a) && !v.trim().startsWith('#')) fail('UK10', rel, el.line, `external ${a}="${v.slice(0, 40)}"`, 'masters reference nothing outside the file');
      }
    }
    if (/url\(\s*["']?\s*(https?:|\/\/)/i.test(text)) fail('UK10', rel, null, 'url() points outside the file', 'masters reference nothing outside the file');
    const mono = f.includes('-mono');
    const seen = new Set();
    for (const p of svgPaints(text)) {
      const v = p.value, lv = v.toLowerCase();
      if (lv === 'none' || lv === 'currentcolor' || /^url\(\s*#/.test(lv)) continue;
      const k = `${p.prop}:${lv}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (mono) { fail('UK10', rel, p.line, `${p.prop} is ${v}; a mono master uses only currentColor or none`, 'use currentColor'); continue; }
      const c = parseColor(v);
      if (!c || c.a < 1) fail('UK10', rel, p.line, `${p.prop} is ${v}; the lint cannot read it as an opaque colour of a brand.colors token`, 'use a hex equal to a token in brand.colors');
      else if (!allowed.has(hexOf(c))) fail('UK10', rel, p.line, `${p.prop} ${hexOf(c)} is not the light-theme value of any brand.colors token${colors.length ? ` (${colors.join(', ')})` : ' (brand.colors is empty)'}`, 'recolour the mark to a pack token value, or change the token and the mark together');
    }
  }

  // UK11: raster sizes from headers
  for (const [f, w, h] of BR.pngSizes) {
    const rel = `${BRAND_DIR}/${f}`;
    if (!exists(rel)) continue;
    const s = pngSize(fs.readFileSync(path.join(root, rel)));
    if (!s) fail('UK11', rel, null, 'is not a PNG file', 'export a real PNG');
    else if (s.w !== w || s.h !== h) fail('UK11', rel, null, `is ${s.w}x${s.h}; it must be ${w}x${h}`, `re-render it at ${w}x${h}`);
  }
  if (exists(`${BRAND_DIR}/favicon.ico`)) {
    const sz = icoSizes(fs.readFileSync(path.join(root, `${BRAND_DIR}/favicon.ico`)));
    if (!sz) fail('UK11', `${BRAND_DIR}/favicon.ico`, null, 'is not an ICO file', 'export a real .ico');
    else if (!sz.some((e) => e.w === BR.icoSize && e.h === BR.icoSize)) fail('UK11', `${BRAND_DIR}/favicon.ico`, null, `has no ${BR.icoSize}x${BR.icoSize} entry (has ${sz.map((e) => `${e.w}x${e.h}`).join(', ')})`, `add a ${BR.icoSize}x${BR.icoSize} image`);
  }

  // UK12: served copies equal their masters
  for (const [target, master] of Object.entries(served)) {
    if (!underBrand(master) || !target || path.isAbsolute(target) || target.split(/[\\/]/).includes('..')) continue;
    const mAbs = path.join(root, master), tAbs = path.join(root, target);
    if (!fs.existsSync(mAbs)) continue; // UK9 already reports a missing master
    if (!fs.existsSync(tAbs)) { fail('UK12', target, null, `is listed in brand.served but missing (master ${master})`, `copy ${master} to ${target}`); continue; }
    if (sha256(fs.readFileSync(mAbs)) !== sha256(fs.readFileSync(tAbs))) fail('UK12', target, null, `differs from its master ${master}`, `copy ${master} over it; edit the master, never the served copy`);
  }
}

// ---------- the lint ----------
export function lint(root, out = {}) {
  const F = [];
  const add = (level, rule, file, line, msg, fix) => F.push({ level, rule, file, line, msg, fix });
  const fail = (rule, file, line, msg, fix) => add('FAIL', rule, file, line, msg, fix);
  const warn = (rule, file, line, msg, fix) => add('WARN', rule, file, line, msg, fix);
  const capped = new Map();
  const capAdd = (level, rule, file, line, msg, fix) => {
    const k = `${rule}\0${file}\0${level}`;
    const n = (capped.get(k) || 0) + 1;
    capped.set(k, n);
    if (n <= CAP) add(level, rule, file, line, msg, fix);
  };
  const flushCaps = () => {
    for (const [k, n] of capped) if (n > CAP) { const [rule, file, level] = k.split('\0'); add(level, rule, file, null, `+${n - CAP} more finding(s) of this rule in this file`, 'fix the ones listed first'); }
    capped.clear();
  };

  // UK1: manifest
  const PACK = 'design/pack.json';
  const packText = readText(path.join(root, PACK));
  if (packText === null) { fail('UK1', PACK, null, 'missing', 'copy .standards/ui-kit/templates/pack/ to design/ and fill it in, or vendor a pack'); return F; }
  let pack;
  try { pack = JSON.parse(packText); } catch (e) { fail('UK1', PACK, null, `not valid JSON (${e.message})`, 'fix the JSON'); return F; }
  const problems = validatePack(pack, { vendored: false });
  for (const p of problems) fail('UK1', PACK, null, p, 'see .standards/ui-kit/RULES.md "pack.json"');
  if (problems.length) return F;

  const converging = pack.vendor !== undefined;
  let vendorDir = null, vendorPack = null;
  const tokenFiles = []; // {rel, own}
  const baseFiles = [];
  const packFiles = new Set([PACK]);
  let prefix = pack.prefix;
  let themes = pack.themes;
  let exts = [...(pack.extensions || [])];
  let budgets = pack.budgets || {};

  if (converging) {
    vendorDir = pack.vendor.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!vendorDir.endsWith(`/${pack.pack}/${pack.version}`)) fail('UK1', PACK, null, `"vendor" is ${vendorDir}; it must end in /${pack.pack}/${pack.version}`, 'vendor the pinned version into design/vendor/<pack>/<version>/');
    const vpText = readText(path.join(root, vendorDir, 'pack.json'));
    if (vpText === null) { fail('UK1', `${vendorDir}/pack.json`, null, 'missing', 're-vendor the pinned pack folder'); return F; }
    try { vendorPack = JSON.parse(vpText); } catch (e) { fail('UK1', `${vendorDir}/pack.json`, null, `not valid JSON (${e.message})`, 're-vendor the pinned pack folder'); return F; }
    const vp = validatePack(vendorPack, { vendored: true });
    for (const p of vp) fail('UK1', `${vendorDir}/pack.json`, null, p, 're-vendor the pinned pack folder');
    if (vp.length) return F;
    if (vendorPack.pack !== pack.pack || vendorPack.version !== pack.version) fail('UK1', `${vendorDir}/pack.json`, null, `says ${vendorPack.pack}@${vendorPack.version} but design/pack.json pins ${pack.pack}@${pack.version}`, 'make both name the same pack and version');
    // SHA256SUMS of the vendored folder
    const sumsText = readText(path.join(root, vendorDir, 'SHA256SUMS'));
    if (sumsText === null) fail('UK1', `${vendorDir}/SHA256SUMS`, null, 'missing', 're-vendor the pinned pack folder with its SHA256SUMS');
    else {
      const sums = parseSums(sumsText);
      const have = listFiles(path.join(root, vendorDir)).filter((f) => f !== 'SHA256SUMS');
      for (const [f, h] of sums) {
        if (f.startsWith('\0bad:')) { fail('UK1', `${vendorDir}/SHA256SUMS`, null, `unreadable line "${f.slice(5)}"`, 're-vendor'); continue; }
        if (!have.includes(f)) fail('UK1', `${vendorDir}/${f}`, null, 'listed in SHA256SUMS but missing', 're-vendor the pinned pack folder');
        else if (sha256(fs.readFileSync(path.join(root, vendorDir, f))) !== h) fail('UK1', `${vendorDir}/${f}`, null, 'does not match SHA256SUMS: a vendored file was edited', 'revert the edit; change the look in design/tokens.css, or release a new pack version and re-vendor');
      }
      for (const f of have) if (!sums.has(f)) fail('UK1', `${vendorDir}/${f}`, null, 'is not listed in SHA256SUMS', 'remove it, or re-vendor the pinned pack folder');
    }
    for (const f of listFiles(path.join(root, vendorDir))) packFiles.add(`${vendorDir}/${f}`);
    prefix = vendorPack.prefix;
    themes = vendorPack.themes;
    exts = [...new Set([...(vendorPack.extensions || []), ...exts])];
    budgets = { ...(vendorPack.budgets || {}), ...(pack.budgets || {}) };
    for (const f of vendorPack.tokens) tokenFiles.push({ rel: `${vendorDir}/${f}`, own: false });
    for (const f of vendorPack.base || []) baseFiles.push({ rel: `${vendorDir}/${f}`, own: false });
  }
  for (const f of pack.tokens) tokenFiles.push({ rel: f.replace(/\\/g, '/'), own: true });
  for (const f of pack.base || []) baseFiles.push({ rel: f.replace(/\\/g, '/'), own: true });
  for (const f of [...tokenFiles, ...baseFiles]) packFiles.add(f.rel);
  let missing = false;
  for (const f of [...tokenFiles, ...baseFiles]) {
    f.text = readText(path.join(root, f.rel));
    if (f.text === null) { fail('UK1', f.rel, null, 'named by pack.json but missing or unreadable', 'create it or drop it from pack.json'); missing = true; }
  }
  if (missing) return F;

  // token declarations
  const decls = [];
  for (const f of tokenFiles) {
    for (const rule of parseCss(f.text)) {
      const keys = ruleKeys(rule);
      for (const d of rule.decls) if (d.prop.startsWith('--')) decls.push({ name: d.prop, value: d.value, file: f.rel, line: d.line, keys, own: f.own });
    }
  }
  const themeMaps = {};
  for (const [t, sels] of Object.entries(themes)) {
    const want = new Set(sels.map(normSel));
    const m = new Map();
    for (const d of decls) if ([...d.keys].some((k) => want.has(k))) m.set(d.name, d);
    themeMaps[t] = m;
  }
  const light = themeMaps.light;
  const lookupFor = (t) => (name) => (themeMaps[t].get(name) ?? light.get(name))?.value;
  const primary = pack.tokens[0].replace(/\\/g, '/');
  const ui = (cat, role) => `--ui-${cat}-${role}`;

  // UK2 + UK3
  const resolved = {}; // theme -> Map name -> {c, d}
  for (const [t, m] of Object.entries(themeMaps)) {
    resolved[t] = new Map();
    const lookup = lookupFor(t);
    const selTxt = themes[t].join(', ');
    for (const role of CONTRACT.required.color) {
      const name = ui('color', role);
      const d = m.get(name);
      if (!d) { fail('UK2', primary, null, `theme "${t}" (${selTxt}) does not assign ${name}`, `assign ${name} under ${themes[t][0]}; a dark theme assigns every colour role again`); continue; }
      const v = subst(d.value, lookup);
      const c = v === null ? null : parseColor(v);
      if (!c) { fail('UK2', d.file, d.line, `${name} is \`${d.value}\` in theme "${t}": the lint cannot read it as an opaque colour`, 'use a hex, rgb() or hsl() value, or a var() that resolves to one'); continue; }
      if (c.a < 1) { fail('UK2', d.file, d.line, `${name} has alpha in theme "${t}" (${d.value})`, 'role colours are opaque; bake the blend into a solid colour'); continue; }
      resolved[t].set(role, { c, d });
    }
    // extension inks (own and inherited) and any other colour the pack assigns, resolved for the budget
    for (const [name, d] of new Map([...light, ...m])) {
      if (!name.startsWith('--ui-color-')) continue;
      const role = name.slice('--ui-color-'.length);
      if (resolved[t].has(role)) continue;
      const v = subst(d.value, lookup);
      const c = v === null ? null : parseColor(v);
      if (c && c.a === 1) resolved[t].set(role, { c, d, ext: true });
    }
    for (const r of pairResults(CONTRACT, resolved[t])) {
      if (!r.pass) fail('UK3', r.a.d.file, r.a.d.line, `${ui('color', r.fg)} on ${ui('color', r.bg)} is ${r.ratio.toFixed(2)}:1 in theme "${t}" (${hexOf(r.a.c)} on ${hexOf(r.b.c)}); the floor is ${r.min}:1`, 'darken or lighten one of the two; AA floors are text 4.5, borders, focus and marks 3');
    }
    for (const r of inkResults(CONTRACT, resolved[t])) {
      if (!r.pass) fail('UK3', r.x.d.file, r.x.d.line, `${ui('color', r.role)} on ${ui('color', CONTRACT.extensionInk.bg)} is ${r.ratio.toFixed(2)}:1 in theme "${t}"; text colours need ${CONTRACT.extensionInk.min}:1`, 'darken the ink');
    }
  }
  out.model = { root, pack, prefix, themes, exts, converging, vendorPack, themeMaps, resolved, light, lookupFor, tokenFiles, baseFiles };
  // non-colour required roles, light only
  const lk = lookupFor('light');
  for (const [cat, roles] of Object.entries(CONTRACT.required)) {
    if (cat === 'color') continue;
    for (const role of roles) {
      const name = ui(cat, role);
      if (!light.has(name)) fail('UK2', primary, null, `theme "light" does not assign ${name}`, `assign ${name} under ${themes.light[0]}`);
    }
  }
  for (const [name, d] of light) {
    if (!name.startsWith('--ui-space-')) continue;
    const px = parsePx(subst(d.value, lk) ?? '');
    if (px === null || px % CONTRACT.floors.unit !== 0) fail('UK2', d.file, d.line, `${name} is ${d.value}; space steps are multiples of ${CONTRACT.floors.unit}px`, `use ${CONTRACT.floors.unit}px multiples`);
  }
  const sizeCheck = (role, min, label) => {
    const d = light.get(ui('size', role));
    if (!d) return;
    const px = parsePx(subst(d.value, lk) ?? '');
    if (px === null || px < min) fail('UK2', d.file, d.line, `${ui('size', role)} is ${d.value}; ${label} is at least ${min}px`, `set it to ${min}px or more`);
  };
  sizeCheck('touch-min', CONTRACT.floors.touchMinPx, 'the touch target');
  sizeCheck('focus-ring', CONTRACT.floors.focusRingPx, 'the focus ring');
  for (const f of CONTRACT.required.font) if (light.has(ui('font', f)) && !(subst(light.get(ui('font', f)).value, lk) ?? '').trim()) fail('UK2', light.get(ui('font', f)).file, light.get(ui('font', f)).line, `${ui('font', f)} is empty`, 'give it a font stack');

  // UK8: names in token files
  const declared = new Set(decls.map((d) => d.name));
  const privRe = typeof prefix === 'string' ? new RegExp(`^--${esc(prefix)}-[a-z0-9]+(-[a-z0-9]+)*$`) : null;
  const seenName = new Set();
  const spot = ui('color', 'spot');
  for (const d of decls) {
    const k = `${d.file}\0${d.name}`;
    if (seenName.has(k)) continue;
    seenName.add(k);
    if (d.name.startsWith('--ui-')) {
      const why = checkPublicName(d.name, exts);
      if (why) fail('UK8', d.file, d.line, `${d.name}: ${why}`, 'follow --ui-<category>-<role>[-<variant>][-<state>]; declare domain scales under "extensions" in pack.json');
      else if (converging && d.own && !(d.name === spot || isExtensionName(d.name, exts))) fail('UK8', d.file, d.line, `${d.name} reassigns a ${pack.pack} role; a converging pack sets only ${spot} and its declared extensions`, `drop it, or release a ${pack.pack} version with the new value`);
    } else if (d.name.startsWith('--_')) {
      fail('UK8', d.file, d.line, `${d.name}: local --_* names belong in component code, never in a token file`, 'move it to the component or rename it into the pack');
    } else if (privRe && privRe.test(d.name)) {
      if (converging && d.own) fail('UK8', d.file, d.line, `${d.name}: a converging pack's own tokens set only ${spot} and its declared extensions`, 'use a var() of a public name or a literal value for the spot');
    } else {
      fail('UK8', d.file, d.line, `${d.name} is neither a public --ui-* name nor a private --${prefix}-* name`, `rename it to --ui-... (public) or --${prefix}-... (private)`);
    }
  }

  // UK9-UK12: brand book
  brandLint(root, pack, {
    declared, fail, warn,
    colorOf: (name) => { const v = subst(light.get(name)?.value ?? '', lk); const c = v ? parseColor(v) : null; return c && c.a === 1 ? { c } : null; },
  });

  // sources
  const globs = (pack.sources || []).map(globRe);
  const srcFiles = repoFiles(root).map(posix).filter((f) => !SKIP.test(f) && !packFiles.has(f) && globs.some((g) => g.test(f)));
  const srcTexts = [];
  for (const f of srcFiles) { const t = readText(path.join(root, f)); if (t !== null) srcTexts.push({ rel: f, text: t }); }
  const allTexts = [...tokenFiles, ...baseFiles].map((f) => ({ rel: f.rel, text: f.text, pack: true })).concat(srcTexts);
  const readPriv = typeof prefix === 'string' ? new RegExp(`^--${esc(prefix)}-`) : null;

  for (const { rel, text } of srcTexts) {
    const lines = text.split('\n');
    // UK8: declarations and reads
    for (const m of text.matchAll(/(?<![\w-])(--[a-zA-Z0-9_-]+)\s*:/g)) {
      const n = m[1];
      if (n.startsWith('--_')) continue;
      const ln = lineOf(text, m.index);
      if (n.startsWith('--ui-')) capAdd('FAIL', 'UK8', rel, ln, `declares ${n}; source files never declare or reassign a public name`, 'read it with var(); change the value in the pack tokens');
      else capAdd('FAIL', 'UK8', rel, ln, `declares custom property ${n}; source files declare only --_* locals`, `rename it --_${n.slice(2)}`);
    }
    for (const m of text.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) {
      if (m[1].startsWith('--_')) continue;
      capAdd('FAIL', 'UK8', rel, lineOf(text, m.index), `setProperty() declares ${m[1]}; source files declare only --_* locals`, `use --_${m[1].slice(2)}`);
    }
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const n = m[1], ln = lineOf(text, m.index);
      if (readPriv && readPriv.test(n)) capAdd('FAIL', 'UK8', rel, ln, `reads the private ${n}; app code reads public --ui-* names only`, 'read the matching --ui-* role; scripts/rename-tokens.mjs renames in one pass');
      else if (n.startsWith('--ui-') && !declared.has(n)) capAdd('FAIL', 'UK8', rel, ln, `reads ${n}, which the pack does not declare`, 'fix the name, or declare the role in the pack');
    }
    // UK5
    for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}(?![\w-])|\b(?:rgba?|hsla?)\(\s*[\d.%]/g)) {
      const s = m[0];
      if (s.startsWith('#')) {
        if (![4, 5, 7, 9].includes(s.length)) continue;
        const before = text.slice(Math.max(0, m.index - 24), m.index);
        if (/[&\w]$/.test(before) || /(?:href|id|for|to|name|data-[\w-]+)\s*=\s*["']?$/.test(before) || /url\(\s*["']?$/.test(before)) continue;
      }
      const ln = lineOf(text, m.index);
      if (MARKER.test(lines[ln - 1] || '') || MARKER.test(lines[ln - 2] || '')) continue;
      capAdd('WARN', 'UK5', rel, ln, `colour literal ${s.startsWith('#') ? s : `${s}...)`} outside the pack files`, 'read a --ui-color-* role, or mark a reasoned exception: ui-kit: raw-color -- <reason>');
    }
  }
  flushCaps();

  // UK6
  const FOCUS_OK = /:focus-visible[^{}]*\{[^{}]*var\(\s*--ui-color-focus\b/;
  if (!allTexts.some((f) => FOCUS_OK.test(f.text))) fail('UK6', PACK, null, 'no :focus-visible rule reads var(--ui-color-focus) in the pack files or sources', 'add the :focus-visible block from templates/pack/base.css, which reads var(--ui-color-focus)');
  for (const f of allTexts) {
    if (/:focus-visible/.test(f.text)) continue;
    const m = /(?<![\w-])outline\s*:\s*(?:none|0)(?![\w.%-])/.exec(f.text);
    if (m) warn('UK6', f.rel, lineOf(f.text, m.index), 'outline: none|0 in a file with no :focus-visible rule', 'style :focus-visible next to it, or drop the outline reset');
  }

  // UK7
  const MOTION = /(?<![\w-])(?:-webkit-)?(?:transition|transition-duration|animation|animation-name|animation-duration)\s*:\s*([^;}\n]*)|@keyframes\b|(?<![\w-])scroll-behavior\s*:\s*smooth/g;
  const NOOP = /^(?:none|0s?|0ms|initial|unset|inherit|revert)(?:\s*!important)?$/i;
  if (!allTexts.some((f) => /prefers-reduced-motion/.test(f.text))) {
    for (const f of allTexts) {
      let hit = null;
      for (const m of f.text.matchAll(MOTION)) { if (m[1] !== undefined && NOOP.test(m[1].trim())) continue; hit = m; break; }
      if (hit) { fail('UK7', f.rel, lineOf(f.text, hit.index), `motion (${hit[0].trim().slice(0, 40)}) and no prefers-reduced-motion guard anywhere in the pack files or sources`, 'add the @media (prefers-reduced-motion: reduce) block from templates/pack/base.css, or wrap motion in (prefers-reduced-motion: no-preference)'); break; }
    }
  }

  // UK4 (WARN)
  if (Number.isInteger(budgets.inks)) {
    for (const [t, m] of Object.entries(resolved)) {
      const n = new Set([...m.values()].map((x) => hexOf(x.c))).size;
      if (n > budgets.inks) warn('UK4', PACK, null, `theme "${t}" uses ${n} distinct colours; the pack's budget is ${budgets.inks}`, 'merge near-duplicate inks, or raise budgets.inks deliberately in pack.json');
    }
  }
  if (Number.isInteger(budgets.sizes)) {
    const sizes = new Set();
    for (const [name, d] of light) if (name.startsWith('--ui-font-size-')) sizes.add((subst(d.value, lk) ?? d.value).toLowerCase());
    for (const f of allTexts) for (const m of f.text.matchAll(/(?<![\w-])font-size\s*:\s*([^;}\n]+)/g)) { const v = m[1].trim().toLowerCase(); if (!/^var\(|^inherit|^initial|^unset/.test(v)) sizes.add(v); }
    if (sizes.size > budgets.sizes) warn('UK4', PACK, null, `${sizes.size} distinct font sizes; the pack's budget is ${budgets.sizes}`, 'use the type scale, or raise budgets.sizes deliberately in pack.json');
  }
  return F;
}

export function isExtensionName(name, exts) {
  const body = name.slice('--ui-'.length);
  const cat = CATS.find((c) => body.startsWith(`${c}-`));
  if (!cat) return false;
  const segs = body.slice(cat.length + 1).split('-');
  return exts.some((e) => [e, `on-${e}`].some((h) => h.split('-').every((x, i) => segs[i] === x)));
}

export const format = (f) => `standards: ${f.level} [ui-kit/${f.rule}] ${f.file}${f.line ? `:${f.line}` : ''}: ${f.msg} (fix: ${f.fix})`;

export function main(root = process.cwd()) {
  const found = lint(root);
  const fails = found.filter((f) => f.level === 'FAIL'), warns = found.filter((f) => f.level === 'WARN');
  for (const f of [...fails, ...warns]) console.log(format(f));
  if (fails.length) console.log(`standards: ui-kit: ${fails.length} finding(s)${warns.length ? `, ${warns.length} warning(s)` : ''}`);
  else console.log(`standards: [ui-kit/lint] OK${warns.length ? ` with ${warns.length} warning(s)` : ''}`);
  return fails.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(HERE, '..', '..'));
