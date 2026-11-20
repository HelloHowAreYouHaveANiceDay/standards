#!/usr/bin/env node
// Token rename codemod (ui-kit profile, spec "N. Naming standard"): rewrites a pack's old custom-property names to the
// public --ui-* names in ONE pass, from a fixed old->new table. Zero dependencies, offline. It refuses (exit 1, nothing
// written) when the repo still uses an old-prefix name the table does not map, so a rename can never be half done.
//
//   node scripts/rename-tokens.mjs --table <table.json> [--root <repo>] [--write] [--include <glob>]...
//
// Without --write it only reports. Table (JSON):
//   { "pack": "broadsheet", "from": "bk",
//     "map":  { "--bk-text": "--ui-color-text", "--bk-bg": "--ui-color-background" },
//     "keep": ["--bk-grey-700"] }
// Unprefixed pre-pass (own-pack followers that predate prefixes, e.g. `--ink`, `--bg`): add explicit exact names:
//   "unprefixed": { "--ink": "--ui-color-text" }, "unprefixedKeep": ["--brand"]
// Matching is by whole name (`--ink` never touches `--ink-soft`). When either key is present, any other unprefixed
// custom property DECLARED (`--name:`) in the scanned files must be listed too, else the run is refused; `--ui-*` and
// `--_*` names are exempt. `from` may then be omitted.
// `from` is the old prefix the table polices; every `--<from>-*` name found in the scanned files must be in `map` (renamed)
// or `keep` (private primitive that stays). New names must be valid --ui-* shapes. Two old names may not map to one new
// name. Exit: 0 clean/applied, 1 refused, 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEXT = /\.(css|scss|sass|less|html|htm|njk|astro|vue|svelte|jsx?|tsx?|mjs|cjs|mdx?|json|svg|ya?ml|txt)$/i;
const SKIP = /(^|\/)(node_modules|\.standards|dist|build|out|\.output|\.astro|\.next|\.svelte-kit|\.wrangler|coverage|\.git)\//;
const NEW_NAME = /^--ui-(?:color|font-size|font|space|size|radius|shadow)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX = 5_000_000;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const posix = (p) => p.split(path.sep).join('/');

export function loadTable(file) {
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bad = [];
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('table is not a JSON object');
  const un = t.unprefixed ?? {};
  const unKeep = t.unprefixedKeep ?? [];
  const hasUn = t.unprefixed !== undefined || t.unprefixedKeep !== undefined;
  const UN_OLD = /^--(?:[a-zA-Z][a-zA-Z0-9_-]*[a-zA-Z0-9_]|[a-zA-Z])$/;
  const unObj = un && typeof un === 'object' && !Array.isArray(un);
  if (t.from === undefined && hasUn) { /* unprefixed-only table */ }
  else if (typeof t.from !== 'string' || !/^[a-z]{2,5}$/.test(t.from) || t.from === 'ui') bad.push('"from" must be the old 2-5 letter prefix (not "ui")');
  if (!unObj) bad.push('"unprefixed" must be an object old -> new');
  if (!Array.isArray(unKeep)) bad.push('"unprefixedKeep" must be an array of names');
  const hasMap = t.map && typeof t.map === 'object' && !Array.isArray(t.map) && Object.keys(t.map).length > 0;
  if (!hasMap && !(unObj && Object.keys(un).length > 0)) bad.push('"map" must be a non-empty object old -> new');
  const keep = t.keep ?? [];
  if (!Array.isArray(keep)) bad.push('"keep" must be an array of names');
  const seen = new Map();
  for (const [o, n] of Object.entries(t.map || {})) {
    if (!o.startsWith(`--${t.from}-`)) bad.push(`${o}: old names must start with --${t.from}-`);
    if (typeof n !== 'string' || !NEW_NAME.test(n)) bad.push(`${o} -> ${n}: the new name must be --ui-<category>-<role>[-<variant>][-<state>] (categories: color font font-size space size radius shadow)`);
    else if (seen.has(n)) bad.push(`${o} and ${seen.get(n)} both map to ${n}`);
    else seen.set(n, o);
  }
  for (const [o, n] of Object.entries(unObj ? un : {})) {
    if (!UN_OLD.test(o) || /^--(ui|_)/.test(o) || (t.from && o.startsWith(`--${t.from}-`))) bad.push(`unprefixed: ${o} must be a plain old name (not --ui-*, --_*, or --${t.from}-*)`);
    if (typeof n !== 'string' || !NEW_NAME.test(n)) bad.push(`${o} -> ${n}: the new name must be --ui-<category>-<role>[-<variant>][-<state>] (categories: color font font-size space size radius shadow)`);
    else if (seen.has(n)) bad.push(`${o} and ${seen.get(n)} both map to ${n}`);
    else seen.set(n, o);
  }
  for (const k of Array.isArray(unKeep) ? unKeep : []) {
    if (typeof k !== 'string' || !UN_OLD.test(k) || /^--(ui|_)/.test(k)) bad.push(`unprefixedKeep: ${k} must be a plain old name`);
    else if (unObj && un[k]) bad.push(`${k} is both renamed and kept`);
  }
  for (const k of keep) {
    if (typeof k !== 'string' || !k.startsWith(`--${t.from}-`)) bad.push(`keep: ${k} must start with --${t.from}-`);
    else if (t.map?.[k]) bad.push(`${k} is both renamed and kept`);
  }
  if (bad.length) throw new Error(`table: ${bad.join('; ')}`);
  return { from: t.from, map: t.map || {}, keep: new Set(keep), pack: t.pack, un: hasUn ? { ...un } : null, unKeep: new Set(unKeep) };
}

function files(root, include) {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  let list;
  if (r.status === 0) list = r.stdout.split('\0').filter(Boolean);
  else {
    list = [];
    const walk = (rel) => { for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) { const x = rel ? `${rel}/${e.name}` : e.name; if (e.name === '.git' || e.name === 'node_modules') continue; if (e.isDirectory()) walk(x); else list.push(x); } };
    walk('');
  }
  return list.map(posix).filter((f) => TEXT.test(f) && !SKIP.test(f) && !/(^|\/)design\/vendor\//.test(f) && fs.existsSync(path.join(root, f)) && (!include.length || include.some((re) => re.test(f))));
}

// Plans the rewrite of every scanned file. Returns { changes: [{file, text, n}], unmapped: Map name -> [file:line], counts }.
export function plan(root, table, include = []) {
  const ANY = '--[a-zA-Z0-9_](?:[a-zA-Z0-9_-]*[a-zA-Z0-9_])?';
  const re = new RegExp(`(?<![\\w-])${table.un ? ANY : `--${esc(table.from)}-[a-zA-Z0-9_-]*[a-zA-Z0-9_]`}`, 'g');
  const pre = table.from ? `--${table.from}-` : null;
  const changes = [];
  const unmapped = new Map();
  for (const f of files(root, include)) {
    const abs = path.join(root, f);
    let buf;
    try { const st = fs.statSync(abs); if (st.size > MAX) continue; buf = fs.readFileSync(abs); } catch { continue; }
    if (buf.includes(0)) continue;
    const text = buf.toString('utf8');
    let n = 0;
    const out = text.replace(re, (name, offset) => {
      if (table.map[name]) { n++; return table.map[name]; }
      if (table.keep.has(name)) return name;
      if (table.un) {
        if (Object.hasOwn(table.un, name)) { n++; return table.un[name]; }
        if (table.unKeep.has(name)) return name;
        const prefixed = pre && name.startsWith(pre);
        const declared = /^\s*:/.test(text.slice(offset + name.length));
        if (!prefixed && (!declared || /^--(ui|_)/.test(name))) return name;
      }
      const line = text.slice(0, offset).split('\n').length;
      if (!unmapped.has(name)) unmapped.set(name, []);
      unmapped.get(name).push(`${f}:${line}`);
      return name;
    });
    if (n > 0) changes.push({ file: f, text: out, n });
  }
  return { changes, unmapped };
}

export function main(argv, log = console.log) {
  const val = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const tablePath = val('--table');
  if (!tablePath || argv.includes('--help')) { log('usage: node scripts/rename-tokens.mjs --table <table.json> [--root <repo>] [--write] [--include <glob>]...'); return tablePath ? 0 : 2; }
  const root = path.resolve(val('--root') || process.cwd());
  const include = argv.flatMap((a, i) => (a === '--include' ? [argv[i + 1]] : [])).map(globRe);
  let table;
  try { table = loadTable(path.resolve(tablePath)); } catch (e) { log(`rename-tokens: ${e.message}`); return 2; }
  const { changes, unmapped } = plan(root, table, include);
  if (unmapped.size) {
    log(`rename-tokens: refused: ${unmapped.size} ${table.from ? `--${table.from}-*` : 'unprefixed'} name(s) are not in the table's "map" or "keep"; nothing was written:`);
    for (const [name, at] of [...unmapped].sort(([a], [b]) => (a < b ? -1 : 1))) log(`  ${name}  (${at.length}x, first ${at[0]})`);
    log('add each to "map" (a --ui-* name) or "keep" (a private primitive that stays), then run again');
    return 1;
  }
  const total = changes.reduce((s, c) => s + c.n, 0);
  if (argv.includes('--write')) {
    for (const c of changes) fs.writeFileSync(path.join(root, c.file), c.text);
    log(`rename-tokens: rewrote ${total} name(s) in ${changes.length} file(s)`);
  } else {
    for (const c of changes) log(`  ${c.file}: ${c.n}`);
    log(`rename-tokens: dry run, ${total} name(s) in ${changes.length} file(s); re-run with --write to apply`);
  }
  return 0;
}

function globRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') { if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; } else re += '[^/]*'; }
    else if (c === '?') re += '[^/]';
    else if (c === '{' && g.indexOf('}', i) > i) { const e = g.indexOf('}', i); re += `(?:${g.slice(i + 1, e).split(',').map(esc).join('|')})`; i = e; }
    else re += esc(c);
  }
  return new RegExp(`^${re}$`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv.slice(2));
