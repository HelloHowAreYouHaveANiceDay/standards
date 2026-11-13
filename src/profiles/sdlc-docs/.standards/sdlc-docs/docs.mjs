#!/usr/bin/env node
// sdlc-docs: the SDLC document standard (spec H:/working/_design-sdlc-docs/SPEC-v4.md, section 3).
//
//   node .standards/sdlc-docs/docs.mjs [<dir>]               check (what check.mjs runs in follower CI)
//   node .standards/sdlc-docs/docs.mjs --scaffold [<dir>]    copy templates that are absent; never overwrite
//
// Check prints one line per finding, `<file>: R<n> <what>`, and exits 1 if there is any (0 clean, 2 usage).
// Rules (zero dependencies, offline; structure only -- not prose, AC tags, AC coverage, Linear or spend):
//   R1  README.md, AGENTS.md, CLAUDE.md == "@AGENTS.md", docs/specs/ with >=1 spec; no AGENT.md
//   R2  spec and ADR front matter parses with its required fields (spec: id, title, status, and appetite as a
//       positive number unless draft; ADR: id, status, date as YYYY-MM-DD)
//   R3  spec status in {draft, approved, done}; `approved` set unless draft; `reason` set when done
//   R4  spec/ADR id is 4 digits, equals the filename prefix and is unique within its folder
//   R5  no "[NEEDS CLARIFICATION" and an empty "What you need to decide now" in any approved or done spec
// `0000-*` files are the scaffolded templates: they are not specs/ADRs (no rules apply, they do not satisfy R1).
// HTML comments are ignored by R5 (the template's own guidance mentions the marker).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, 'templates');
export const BEGIN = '<!-- kit:sdlc-docs begin -->';
export const END = '<!-- kit:sdlc-docs end -->';
export const STATUSES = ['draft', 'approved', 'done'];

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const exists = (f) => fs.existsSync(f);
const isFile = (f) => exists(f) && fs.statSync(f).isFile();
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

// Front matter: a leading `---` block of top-level `key: value` lines. Returns { fm, body } or { error }.
export function parseFrontMatter(text) {
  const t = text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  if (!t.startsWith('---\n')) return { error: 'no front matter (file must start with a --- block)' };
  const end = t.indexOf('\n---', 3);
  if (end < 0 || !/^\n---[ \t]*(\n|$)/.test(t.slice(end))) return { error: 'front matter is not closed with ---' };
  const fm = {};
  for (const [i, raw] of t.slice(4, end).split('\n').entries()) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const m = /^([A-Za-z_][\w-]*):(.*)$/.exec(raw);
    if (!m) return { error: `front matter line ${i + 2} is not "key: value": ${raw.trim().slice(0, 40)}` };
    let v = m[2].replace(/(^|\s)#.*$/, '').trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1).trim();
    fm[m[1]] = v;
  }
  return { fm, body: t.slice(end).replace(/^\n---[ \t]*\n?/, '') };
}

// Text of a `## <title>` section (case-insensitive) up to the next `## `; null if the heading is absent.
export function section(body, title) {
  const lines = body.split('\n');
  const want = title.toLowerCase();
  const i = lines.findIndex((l) => { const m = /^##\s+(.*?)\s*#*\s*$/.exec(l); return m && m[1].toLowerCase() === want; });
  if (i < 0) return null;
  const out = [];
  for (const l of lines.slice(i + 1)) { if (/^##\s/.test(l)) break; out.push(l); }
  return out.join('\n');
}

const listMd = (dir) => (exists(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md').map((e) => e.name).sort() : []);
const isTemplate = (name) => name.startsWith('0000-');

export function check(root) {
  const out = [];
  const bad = (file, rule, what) => out.push(`${file}: ${rule} ${what}`);

  // R1
  for (const f of ['README.md', 'AGENTS.md']) if (!isFile(path.join(root, f))) bad(f, 'R1', 'missing');
  if (!isFile(path.join(root, 'CLAUDE.md'))) bad('CLAUDE.md', 'R1', 'missing');
  else if (read(path.join(root, 'CLAUDE.md')).trim() !== '@AGENTS.md') bad('CLAUDE.md', 'R1', 'must contain exactly "@AGENTS.md"');
  if (fs.readdirSync(root).includes('AGENT.md')) bad('AGENT.md', 'R1', 'must not exist (fold it into AGENTS.md)');

  const folders = [{ dir: 'docs/specs', kind: 'spec' }, { dir: 'docs/decisions', kind: 'adr' }];
  const real = { spec: 0, adr: 0 };
  for (const { dir, kind } of folders) {
    const seen = new Map();
    for (const name of listMd(path.join(root, dir))) {
      const rel = `${dir}/${name}`;
      if (isTemplate(name)) continue;
      real[kind]++;
      const m = /^(\d{4})-[^/]+\.md$/.exec(name);
      if (!m) bad(rel, 'R4', 'filename must be NNNN-slug.md (4-digit id prefix)');
      const p = parseFrontMatter(read(path.join(root, rel)));
      if (p.error) { bad(rel, 'R2', p.error); continue; }
      const { fm, body } = p;
      const need = kind === 'spec' ? ['id', 'title', 'status'] : ['id', 'status', 'date'];
      for (const k of need) if (!fm[k]) bad(rel, 'R2', `front matter field "${k}" is missing or empty`);
      // R4
      if (fm.id) {
        if (!/^\d{4}$/.test(fm.id)) bad(rel, 'R4', `id "${fm.id}" is not 4 digits`);
        else if (m && fm.id !== m[1]) bad(rel, 'R4', `id ${fm.id} does not equal the filename prefix ${m[1]}`);
        else if (seen.has(fm.id)) bad(rel, 'R4', `id ${fm.id} is already used by ${seen.get(fm.id)}`);
        if (!seen.has(fm.id)) seen.set(fm.id, rel);
      }
      if (kind === 'adr') {
        if (fm.date && !/^\d{4}-\d{2}-\d{2}$/.test(fm.date)) bad(rel, 'R2', `date "${fm.date}" is not YYYY-MM-DD`);
        continue;
      }
      // spec: R3
      const st = fm.status;
      if (st && !STATUSES.includes(st)) bad(rel, 'R3', `status "${st}" is not one of ${STATUSES.join(' | ')}`);
      const settled = !!st && st !== 'draft'; // any non-draft value is held to the approved rules
      if (settled) {
        if (!fm.approved) bad(rel, 'R3', 'approved is empty (approved_by, date, link to the owner\'s message)');
        if (!/^\d+(\.\d+)?$/.test(fm.appetite || '') || Number(fm.appetite) <= 0) bad(rel, 'R2', `appetite "${fm.appetite || ''}" must be a positive number (USD)`);
      }
      if (st === 'done' && !fm.reason) bad(rel, 'R3', 'reason is empty (shipped | superseded by NNNN | abandoned: <why>)');
      // R5
      if (st === 'approved' || st === 'done') {
        const clean = stripComments(body);
        if (clean.includes('[NEEDS CLARIFICATION')) bad(rel, 'R5', 'contains "[NEEDS CLARIFICATION" in a(n) ' + st + ' spec');
        const sec = section(clean, 'What you need to decide now');
        if (sec === null) bad(rel, 'R5', 'section "What you need to decide now" is missing');
        else if (sec.trim()) bad(rel, 'R5', `section "What you need to decide now" must be empty in a(n) ${st} spec`);
      }
    }
  }
  if (real.spec === 0) bad('docs/specs', 'R1', 'needs at least one spec (NNNN-slug.md; the 0000 template does not count)');
  return out;
}

// Replace the kit block of an existing AGENTS.md with the template's block; null if it has no (single) block.
export function refreshBlock(existing, template) {
  const grab = (t) => { const a = t.indexOf(BEGIN); const b = t.indexOf(END); return a >= 0 && b > a ? [a, b + END.length] : null; };
  const e = grab(existing); const t = grab(template);
  if (!e || !t || existing.indexOf(BEGIN, e[0] + 1) >= 0) return null;
  return existing.slice(0, e[0]) + template.slice(t[0], t[1]) + existing.slice(e[1]);
}

// Copy-if-absent. AGENTS.md's kit block (between the markers) is the one region the kit keeps current.
export function scaffold(root) {
  const log = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(TEMPLATES, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(r); continue; }
      const dst = path.join(root, r);
      const tpl = read(path.join(TEMPLATES, r));
      if (!exists(dst)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, tpl);
        log.push(`created ${r}`);
      } else if (r === 'AGENTS.md') {
        const cur = read(dst);
        const next = refreshBlock(cur, tpl);
        if (next === null) log.push(`kept    ${r} (no single kit:sdlc-docs block to refresh -- add the block from the template)`);
        else if (next !== cur) { fs.writeFileSync(dst, next); log.push(`updated ${r} (kit block)`); }
        else log.push(`kept    ${r}`);
      } else log.push(`kept    ${r}`);
    }
  };
  walk('');
  return log;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const doScaffold = args.includes('--scaffold');
  const rest = args.filter((a) => a !== '--scaffold');
  if (rest.some((a) => a.startsWith('-')) || rest.length > 1) { console.error('usage: docs.mjs [--scaffold] [<dir>]'); process.exit(2); }
  const root = path.resolve(rest[0] || path.join(HERE, '..', '..'));
  if (doScaffold) { for (const l of scaffold(root)) console.log(`sdlc-docs: ${l}`); process.exit(0); }
  const findings = check(root);
  for (const f of findings) console.log(f);
  console.log(findings.length ? `sdlc-docs: ${findings.length} finding(s)` : 'sdlc-docs: ok');
  process.exit(findings.length ? 1 : 0);
}
