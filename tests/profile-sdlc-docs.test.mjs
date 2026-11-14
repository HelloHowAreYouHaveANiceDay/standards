// sdlc-docs 1.1.0: scaffold (copy-if-absent, kit-block refresh), front-matter parsing, rule edge cases, released files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir, node } from './helpers.mjs';

const DIR = process.env.SDLC_DOCS_SRC ? path.join(KIT_ROOT, 'src/profiles/sdlc-docs') : path.join(KIT_ROOT, 'profiles/sdlc-docs/1.1.0');
const STD = path.join(DIR, '.standards/sdlc-docs');
const DOCS = path.join(STD, 'docs.mjs');
const d = await import(pathToFileURL(DOCS).href);
const put = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const scaffolded = () => { const r = tmpdir('sdlc-scaf-'); const s = node([DOCS, '--scaffold', r]); assert.equal(s.code, 0, s.out); return r; };
const spec = (fm, body = '## What you need to decide now\n\n## Decided\n') => `---\n${fm}\n---\n\n# t\n\n${body}`;
const APPROVED = 'id: 0001\ntitle: t\nstatus: approved\napproved: libo 2026-11-13 https://x/y\nappetite: 40';

test('scaffold writes every template when absent; the result fails R1 only for the missing real spec', () => {
  const r = scaffolded();
  for (const f of ['README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/specs/0000-template.md', 'docs/decisions/0000-template.md']) assert.ok(fs.existsSync(path.join(r, f)), f);
  assert.deepEqual(d.check(r), ['docs/specs: R1 needs at least one spec (NNNN-slug.md; the 0000 template does not count)']);
  put(r, 'docs/specs/0001-first.md', spec('id: 0001\ntitle: First\nstatus: draft'));
  assert.deepEqual(d.check(r), []);
});

test('scaffold never overwrites: edited README/CLAUDE stay, a second run changes nothing', () => {
  const r = scaffolded();
  put(r, 'README.md', 'mine\n'); put(r, 'CLAUDE.md', 'mine too\n');
  const s = node([DOCS, '--scaffold', r]);
  assert.equal(s.code, 0);
  assert.equal(fs.readFileSync(path.join(r, 'README.md'), 'utf8'), 'mine\n');
  assert.equal(fs.readFileSync(path.join(r, 'CLAUDE.md'), 'utf8'), 'mine too\n');
  assert.match(s.out, /kept\s+README\.md/);
});

test('scaffold refreshes only the AGENTS.md kit block; notes outside it survive', () => {
  const r = scaffolded();
  const f = path.join(r, 'AGENTS.md');
  const tpl = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, `# mine\n\n${tpl.slice(tpl.indexOf(d.BEGIN)).replace('## Rules', '## Rules (stale)')}\n- a worker note\n`);
  const s = node([DOCS, '--scaffold', r]);
  assert.match(s.out, /updated AGENTS\.md \(kit block\)/);
  const now = fs.readFileSync(f, 'utf8');
  assert.ok(now.startsWith('# mine\n') && now.includes('- a worker note') && !now.includes('(stale)'));
  assert.equal(now.split(d.BEGIN).length, 2);
  const none = path.join(r, 'x'); put(none, 'AGENTS.md', '# no block\n');
  assert.match(node([DOCS, '--scaffold', none]).out, /updated AGENTS\.md \(kit block appended\)/);
  const appended = fs.readFileSync(path.join(none, 'AGENTS.md'), 'utf8');
  assert.ok(appended.startsWith('# no block\n\n' + d.BEGIN) && appended.trimEnd().endsWith(d.END));
  assert.equal(node([DOCS, '--scaffold', none]).out.includes('updated'), false); // idempotent
  const broken = path.join(r, 'y'); put(broken, 'AGENTS.md', `# x\n${d.BEGIN}\nno end marker\n`);
  assert.match(node([DOCS, '--scaffold', broken]).out, /markers are malformed/);
  assert.equal(fs.readFileSync(path.join(broken, 'AGENTS.md'), 'utf8'), `# x\n${d.BEGIN}\nno end marker\n`);
});

test('the scaffolded AGENTS.md block equals spec Appendix A markers and CLAUDE.md is exactly the shim', () => {
  const r = scaffolded();
  const a = fs.readFileSync(path.join(r, 'AGENTS.md'), 'utf8');
  assert.equal(a.split(d.BEGIN).length, 2); assert.equal(a.split(d.END).length, 2);
  assert.equal(fs.readFileSync(path.join(r, 'CLAUDE.md'), 'utf8').trim(), '@AGENTS.md');
});

test('front matter: comments stripped, quotes removed, CRLF accepted, errors reported', () => {
  const p = d.parseFrontMatter('---\r\nid: "0001"   # four digits\r\ntitle: a: b\r\n---\r\nbody\r\n');
  assert.deepEqual(p.fm, { id: '0001', title: 'a: b' });
  assert.match(d.parseFrontMatter('# no fm\n').error, /no front matter/);
  assert.match(d.parseFrontMatter('---\nid: 1\n').error, /not closed/);
  assert.match(d.parseFrontMatter('---\nnot a pair\n---\n').error, /not "key: value"/);
});

test('rules: R2 non-numeric/zero appetite, R3 approved empty, R4 duplicate and bad filename, R5 missing section', () => {
  const r = scaffolded();
  put(r, 'docs/specs/0001-a.md', spec(APPROVED.replace('appetite: 40', 'appetite: $40')));
  put(r, 'docs/specs/0002-b.md', spec(APPROVED.replace('id: 0001', 'id: 0002').replace('appetite: 40', 'appetite: 0')));
  put(r, 'docs/specs/0003-c.md', spec('id: 0003\ntitle: t\nstatus: approved\nappetite: 5'));
  put(r, 'docs/specs/0004-d.md', spec(APPROVED.replace('id: 0001', 'id: 0004'), '## Decided\n'));
  put(r, 'docs/specs/notes.md', spec('id: 0005\ntitle: t\nstatus: draft'));
  put(r, 'docs/decisions/0001-x.md', '---\nid: 0001\nstatus: accepted\ndate: 11/13/2026\n---\n');
  const out = d.check(r).join('\n');
  assert.match(out, /0001-a\.md: R2 appetite "\$40"/);
  assert.match(out, /0002-b\.md: R2 appetite "0"/);
  assert.match(out, /0003-c\.md: R3 approved is empty/);
  assert.match(out, /0004-d\.md: R5 section "What you need to decide now" is missing/);
  assert.match(out, /notes\.md: R4 filename must be NNNN-slug\.md/);
  assert.match(out, /0001-x\.md: R2 date "11\/13\/2026"/);
});

test('R4: two files may not share an id within a folder (the template 0000 is exempt)', () => {
  const r = scaffolded();
  put(r, 'docs/specs/0001-a.md', spec('id: 0001\ntitle: t\nstatus: draft'));
  put(r, 'docs/specs/0001-b.md', spec('id: 0001\ntitle: t\nstatus: draft'));
  assert.deepEqual(d.check(r), ['docs/specs/0001-b.md: R4 id 0001 is already used by docs/specs/0001-a.md']);
});

test('CLI: usage error exits 2; check.json declares the one command', () => {
  assert.equal(node([DOCS, '--bogus']).code, 2);
  const cj = JSON.parse(fs.readFileSync(path.join(STD, 'check.json'), 'utf8'));
  assert.equal(cj.profile, 'sdlc-docs');
  assert.deepEqual(cj.commands, [{ id: 'docs', tool: 'docs', run: ['node', '.standards/sdlc-docs/docs.mjs'] }]);
  assert.deepEqual(fs.readdirSync(STD).sort(), ['check.json', 'docs.mjs', 'templates']); // no schema.json / RULES.md
});
