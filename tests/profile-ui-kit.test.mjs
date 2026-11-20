// ui-kit 1.0.0: contract shape, lint.mjs UK1-UK8 passing and failing cases, the pack template, and scripts/rename-tokens.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir, node, git } from './helpers.mjs';

const DIR = process.env.UI_KIT_SRC ? path.join(KIT_ROOT, 'src/profiles/ui-kit') : path.join(KIT_ROOT, 'profiles/ui-kit/1.0.0');
const SK = path.join(DIR, '.standards/ui-kit');
const l = await import(pathToFileURL(path.join(SK, 'lint.mjs')).href);
const codemod = await import(pathToFileURL(path.join(KIT_ROOT, 'scripts/rename-tokens.mjs')).href);
const TPL = path.join(SK, 'templates/pack');
const contract = JSON.parse(fs.readFileSync(path.join(SK, 'contract.json'), 'utf8'));

function repo(files) {
  const r = tmpdir('uk-');
  git(r, 'init', '-q', '-b', 'main');
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true });
    fs.writeFileSync(path.join(r, f), text);
  }
  git(r, 'add', '-A');
  return r;
}
const tpl = (n) => fs.readFileSync(path.join(TPL, n), 'utf8');
const tplFiles = (over = {}) => ({
  'design/pack.json': tpl('pack.json').replace('"pack": ""', '"pack": "demo"').replace('"prefix": ""', '"prefix": "dm"'),
  'design/tokens.css': tpl('tokens.css').replaceAll('--tpl-', '--dm-'),
  'design/base.css': tpl('base.css'),
  'src/app.css': '.a { color: var(--ui-color-text); }\n',
  ...over,
});
const run = (over) => l.lint(repo(tplFiles(over)));
const at = (found, level, rule, re) => found.some((f) => f.level === level && f.rule === rule && re.test(`${f.file}: ${f.msg}`));
const ids = (found, level) => found.filter((f) => f.level === level).map((f) => f.rule);

test('contract.json: section N roles, section B pairs, floors', () => {
  assert.equal(contract.version, '1.0.0');
  assert.deepEqual(contract.categories, ['color', 'font', 'font-size', 'space', 'size', 'radius', 'shadow']);
  assert.equal(contract.required.color.length, 12);
  assert.deepEqual(contract.required.space, ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(contract.floors, { unit: 4, touchMinPx: 44, focusRingPx: 2 });
  const pairs = Object.fromEntries(contract.pairs.map((p) => [`${p.fg}/${p.bg}`, p.min]));
  assert.deepEqual(pairs, { 'text/background': 4.5, 'text/panel': 4.5, 'text-muted/background': 4.5, 'text-muted/panel': 4.5, 'border/background': 3, 'on-primary/primary': 4.5, 'primary/background': 3, 'on-alert/alert': 4.5, 'alert/background': 4.5, 'spot/background': 3, 'focus/background': 3 });
  assert.ok(!JSON.stringify(contract).includes('7'), 'AAA (7:1) is not in the contract');
});

test('the template, with a prefix filled in, is a clean pack; untouched it fails UK1 on the blank names', () => {
  assert.deepEqual(run(), []);
  const untouched = l.lint(repo({ ...tplFiles(), 'design/pack.json': tpl('pack.json'), 'design/tokens.css': tpl('tokens.css') }));
  assert.ok(at(untouched, 'FAIL', 'UK1', /"pack" must be a lowercase kebab name/));
  assert.ok(at(untouched, 'FAIL', 'UK1', /"prefix" must be 2-5 lowercase letters/));
});

test('UK1: missing / malformed pack.json, missing named file, reserved prefix', () => {
  assert.ok(at(l.lint(repo({ 'a.txt': 'x' })), 'FAIL', 'UK1', /design\/pack\.json: missing/));
  assert.ok(at(l.lint(repo({ 'design/pack.json': '{' })), 'FAIL', 'UK1', /not valid JSON/));
  const f = tplFiles();
  delete f['design/base.css'];
  assert.ok(at(l.lint(repo(f)), 'FAIL', 'UK1', /design\/base\.css: named by pack\.json but missing/));
  assert.ok(at(run({ 'design/pack.json': tplFiles()['design/pack.json'].replace('"dm"', '"ui"') }), 'FAIL', 'UK1', /reserved/));
});

test('UK2: missing role, alpha, 4px grid, touch and focus-ring floors, unreadable colour', () => {
  const T = tplFiles()['design/tokens.css'];
  assert.ok(at(run({ 'design/tokens.css': T.replace('  --ui-color-line: var(--dm-grey-200);\n', '') }), 'FAIL', 'UK2', /does not assign --ui-color-line/));
  assert.ok(at(run({ 'design/tokens.css': T.replace('--ui-color-panel: var(--dm-grey-50)', '--ui-color-panel: rgba(0, 0, 0, 0.04)') }), 'FAIL', 'UK2', /--ui-color-panel has alpha/));
  assert.ok(at(run({ 'design/tokens.css': T.replace('--ui-space-3: 12px', '--ui-space-3: 10px') }), 'FAIL', 'UK2', /--ui-space-3 is 10px; space steps are multiples of 4px/));
  assert.ok(at(run({ 'design/tokens.css': T.replace('--ui-space-3: 12px', '--ui-space-3: 0.75rem') }), 'FAIL', 'UK2', /x/) === false, '0.75rem = 12px passes');
  assert.ok(at(run({ 'design/tokens.css': T.replace('--ui-size-touch-min: 44px', '--ui-size-touch-min: 40px') }), 'FAIL', 'UK2', /--ui-size-touch-min is 40px/));
  assert.ok(at(run({ 'design/tokens.css': T.replace('--ui-size-focus-ring: 2px', '--ui-size-focus-ring: 1px') }), 'FAIL', 'UK2', /--ui-size-focus-ring is 1px/));
  assert.ok(at(run({ 'design/tokens.css': T.replace('--ui-color-spot: var(--dm-grey-700)', '--ui-color-spot: oklch(50% 0.1 200)') }), 'FAIL', 'UK2', /cannot read it as an opaque colour/));
  assert.ok(at(run({ 'design/tokens.css': T.replace('--ui-font-sans: var(--dm-stack-sans)', '--ui-font-sans: var(--dm-missing)') }), 'FAIL', 'UK2', /--ui-font-sans is empty/));
});

test('UK3: each section-B pair fails below its floor, an extension ink fails below 4.5', () => {
  const T = tplFiles()['design/tokens.css'];
  const bad = (from, to, re) => assert.ok(at(run({ 'design/tokens.css': T.replace(from, to) }), 'FAIL', 'UK3', re), `${to}`);
  bad('--ui-color-text: var(--dm-grey-900)', '--ui-color-text: #999999', /--ui-color-text on --ui-color-background is 2\.85:1/);
  bad('--ui-color-text-muted: var(--dm-grey-700)', '--ui-color-text-muted: #888888', /--ui-color-text-muted on --ui-color-panel/);
  bad('--ui-color-border: var(--dm-grey-500)', '--ui-color-border: #cccccc', /--ui-color-border on --ui-color-background/);
  bad('--ui-color-on-alert: var(--dm-white)', '--ui-color-on-alert: #ff8888', /--ui-color-on-alert on --ui-color-alert/);
  bad('--ui-color-alert: var(--dm-red-700)', '--ui-color-alert: #ee6666', /--ui-color-alert on --ui-color-background/);
  bad('--ui-color-focus: var(--dm-grey-900)', '--ui-color-focus: #dddddd', /--ui-color-focus on --ui-color-background/);
  const ext = tplFiles({
    'design/pack.json': tplFiles()['design/pack.json'].replace('"extensions": []', '"extensions": ["risk"]'),
    'design/tokens.css': T.replace('  --ui-font-sans', '  --ui-color-risk-1-ink: #999999;\n  --ui-font-sans'),
  });
  assert.ok(at(l.lint(repo(ext)), 'FAIL', 'UK3', /--ui-color-risk-1-ink on --ui-color-background is 2\.85:1/));
  assert.equal(l.contrast({ r: 255, g: 255, b: 255, a: 1 }, { r: 0, g: 0, b: 0, a: 1 }), 21);
});

test('UK4: ink and size budgets warn, never fail', () => {
  const p = (b) => tplFiles()['design/pack.json'].replace('"inks": null', `"inks": ${b}`);
  const r = run({ 'design/pack.json': p(3) });
  assert.ok(at(r, 'WARN', 'UK4', /design\/pack\.json: theme "light" uses \d+ distinct colours; the pack's budget is 3/));
  assert.deepEqual(ids(r, 'FAIL'), []);
  assert.deepEqual(run({ 'design/pack.json': p(40) }), []);
  const s = run({ 'design/pack.json': tplFiles()['design/pack.json'].replace('"sizes": null', '"sizes": 1'), 'src/app.css': '.a{font-size:12px}.b{font-size:14px}\n' });
  assert.ok(at(s, 'WARN', 'UK4', /2 distinct font sizes/));
});

test('UK5: colour literals warn outside the pack; markers, anchors and entities do not', () => {
  const r = run({ 'src/app.css': '.a { color: #fff; }\n.b { background: rgb(0, 0, 0); }\n' });
  assert.ok(at(r, 'WARN', 'UK5', /src\/app\.css: colour literal #fff/));
  assert.ok(at(r, 'WARN', 'UK5', /colour literal rgb\(/));
  assert.deepEqual(ids(r, 'FAIL'), []);
  assert.deepEqual(run({ 'src/app.css': '/* ui-kit: raw-color -- logo */\n.a { color: #fff; }\n' }), []);
  assert.deepEqual(run({ 'src/a.html': '<a href="#add">x</a> &#123; <a id="face"></a><a href="#bad">y</a>\n' }), []);
  assert.deepEqual(run({ 'src/app.css': '.a { color: #ggg; background: url(#abc); }\n' }), []);
  assert.deepEqual(run({ 'other/app.css': '.a { color: #fff; }\n' }), [], 'files outside `sources` are not scanned');
});

test('UK6: no focus rule fails; outline: none with no :focus-visible warns', () => {
  assert.ok(at(run({ 'design/base.css': 'body { margin: 0; }\n' }), 'FAIL', 'UK6', /no :focus-visible rule reads var\(--ui-color-focus\)/));
  assert.ok(at(run({ 'design/base.css': ':focus-visible { outline: 2px solid red; }\n@media (prefers-reduced-motion: reduce) { * { transition: none; } }\n' }), 'FAIL', 'UK6', /no :focus-visible rule reads/));
  const w = run({ 'src/app.css': 'button { outline: none; }\n' });
  assert.ok(at(w, 'WARN', 'UK6', /src\/app\.css: outline: none\|0 in a file with no :focus-visible rule/));
  assert.deepEqual(ids(w, 'FAIL'), []);
  assert.deepEqual(run({ 'src/app.css': 'button { outline: none; }\nbutton:focus-visible { outline: 2px solid var(--ui-color-focus); }\n' }), []);
});

test('UK7: motion needs a reduced-motion guard somewhere; transition: none and 0s are not motion', () => {
  const noGuard = tpl('base.css').replace(/@media \(prefers-reduced-motion[\s\S]*?\n}\n\n/, '');
  assert.ok(!/prefers-reduced-motion/.test(noGuard));
  assert.ok(at(run({ 'design/base.css': noGuard, 'src/app.css': '.a { transition: opacity .2s; }\n' }), 'FAIL', 'UK7', /src\/app\.css: motion \(transition: opacity \.2s\)/));
  assert.ok(at(run({ 'design/base.css': noGuard, 'src/app.css': '@keyframes spin { to { opacity: 0; } }\n' }), 'FAIL', 'UK7', /@keyframes/));
  assert.ok(at(run({ 'design/base.css': noGuard, 'src/app.css': 'html { scroll-behavior: smooth; }\n' }), 'FAIL', 'UK7', /scroll-behavior: smooth/));
  assert.deepEqual(run({ 'design/base.css': noGuard, 'src/app.css': '.a { transition: none; animation: 0s; }\n' }), []);
  assert.deepEqual(run({ 'src/app.css': '.a { transition: opacity .2s; }\n' }), [], 'the pack base ships the guard');
});

test('UK8 names: shapes accepted and rejected (checkPublicName)', () => {
  const ok = (n, e = []) => assert.equal(l.checkPublicName(n, e), null, n);
  const no = (n, re, e = []) => assert.match(l.checkPublicName(n, e) || 'ACCEPTED', re, n);
  for (const n of ['--ui-color-background', '--ui-color-text-muted', '--ui-color-primary-hover', '--ui-color-text-muted-disabled', '--ui-color-on-primary', '--ui-font-sans', '--ui-font-size-3', '--ui-space-2', '--ui-radius-sm', '--ui-shadow-1', '--ui-size-touch-min']) ok(n);
  ok('--ui-color-risk-1', ['risk']);
  ok('--ui-color-risk-1-ink', ['risk']);
  ok('--ui-color-on-risk', ['risk']);
  ok('--ui-color-hatch-ink', ['hatch-ink']);
  no('--ui-colour-text', /"colour" is not a category/);
  no('--ui-color', /no role after/);
  no('--ui-color-Text', /lowercase kebab/);
  no('--ui-color-text_muted', /lowercase kebab/);
  no('--ui-color-hover-primary', /state "hover" must be the last/);
  no('--ui-color-muted-text', /variant "muted" must follow the role/);
  no('--ui-color-text-muted-extra', /variant "muted" must follow the role/);
  no('--ui-color-risk-1', /no entry of "extensions"/);
  no('--ui-color-tomato', /no entry of "extensions"/);
  no('--ui-size-gap', /not a standard role/);
});

test('UK8 token files: bad names, local names, foreign prefixes, a converging follower setting a non-spot role', () => {
  const T = tplFiles()['design/tokens.css'];
  const add = (decl) => T.replace('  --ui-font-sans', `  ${decl}\n  --ui-font-sans`);
  assert.ok(at(run({ 'design/tokens.css': add('--ui-colour-ink: #000000;') }), 'FAIL', 'UK8', /design\/tokens\.css: --ui-colour-ink: "colour" is not a category/));
  assert.ok(at(run({ 'design/tokens.css': add('--_scratch: 1px;') }), 'FAIL', 'UK8', /--_scratch: local --_\* names belong in component code/));
  assert.ok(at(run({ 'design/tokens.css': add('--tw-ring: 1px;') }), 'FAIL', 'UK8', /--tw-ring is neither a public --ui-\* name nor a private --dm-\* name/));
  assert.ok(at(run({ 'design/tokens.css': add('--dm-Bad: 1px;') }), 'FAIL', 'UK8', /--dm-Bad is neither/));
  assert.deepEqual(run({ 'design/tokens.css': add('--dm-extra-step-2: 1px;') }), []);
});

test('UK8 source files: private reads, --ui-* declarations, foreign declarations, undeclared --ui-* reads; third-party reads pass', () => {
  const css = (body) => ({ 'src/app.css': `${body}\n` });
  assert.ok(at(run(css('.a { color: var(--dm-grey-700); }')), 'FAIL', 'UK8', /src\/app\.css: reads the private --dm-grey-700/));
  assert.ok(at(run(css('.a { --ui-color-text: red; }')), 'FAIL', 'UK8', /declares --ui-color-text/));
  assert.ok(at(run(css('.a { --card-gap: 4px; }')), 'FAIL', 'UK8', /declares custom property --card-gap; source files declare only --_\* locals/));
  assert.ok(at(run(css('.a { color: var(--ui-color-ink); }')), 'FAIL', 'UK8', /reads --ui-color-ink, which the pack does not declare/));
  assert.ok(at(run({ 'src/a.js': "el.style.setProperty('--tilt', '3deg');\n" }), 'FAIL', 'UK8', /setProperty\(\) declares --tilt/));
  assert.deepEqual(run(css('.a { --_gap: 4px; margin: var(--_gap); box-shadow: var(--tw-ring-shadow, 0 0 transparent); color: var(--radix-accent); }')), []);
});

test('output: file:line, capped at 20 per rule and file with a "+N more" line', () => {
  const body = Array.from({ length: 30 }, (_, i) => `.a${i} { color: var(--dm-grey-700); }`).join('\n');
  const r = run({ 'src/app.css': body });
  const mine = r.filter((f) => f.rule === 'UK8' && f.file === 'src/app.css');
  assert.equal(mine.length, 21);
  assert.match(l.format(mine[0]), /^standards: FAIL \[ui-kit\/UK8\] src\/app\.css:1: reads the private --dm-grey-700; app code reads public --ui-\* names only \(fix: /);
  assert.match(mine[20].msg, /\+10 more/);
});

test('converging pack: vendored folder checks, spot-only own tokens, themes inherited', () => {
  const vp = { pack: 'sheet', prefix: 'bk', version: '1.0.0', themes: { light: [':root'], dark: [':root[data-theme="dark"]'] }, extensions: [], tokens: ['tokens.css'], base: ['base.css'] };
  const base = tpl('base.css');
  const light = tpl('tokens.css').replaceAll('--tpl-', '--bk-');
  const darkVars = light.match(/--ui-color-[a-z-]+: [^;]+;/g).join('\n  ');
  const tokens = `${light}\n:root[data-theme="dark"] {\n  ${darkVars.replace(/var\(--bk-(white|grey-50)\)/g, '#101010').replace(/var\(--bk-[a-z]+-(\d+)\)/g, (m, n) => (Number(n) >= 700 ? '#f0f0f0' : '#bbbbbb'))}\n  --ui-color-background: #101010;\n}\n`;
  const sum = (text) => crypto.createHash('sha256').update(text).digest('hex');
  const vfiles = { 'pack.json': `${JSON.stringify(vp)}\n`, 'tokens.css': tokens, 'base.css': base };
  const V = 'design/vendor/sheet/1.0.0';
  const files = (over = {}) => ({
    'design/pack.json': `${JSON.stringify({ pack: 'sheet', version: '1.0.0', vendor: V, tokens: ['design/tokens.css'], extensions: [], sources: ['src/**/*.css'] })}\n`,
    'design/tokens.css': ':root {\n  --ui-color-spot: #0b5cad;\n}\n:root[data-theme="dark"] {\n  --ui-color-spot: #6fb3f5;\n}\n',
    ...Object.fromEntries(Object.entries(vfiles).map(([k, v]) => [`${V}/${k}`, v])),
    [`${V}/SHA256SUMS`]: Object.entries(vfiles).sort().map(([k, v]) => `${sum(v)}  ${k}\n`).join(''),
    'src/app.css': '.a { color: var(--ui-color-text); }\n',
    ...over,
  });
  const found = l.lint(repo(files()));
  assert.deepEqual(found.map(l.format), []);
  assert.ok(at(l.lint(repo(files({ [`${V}/extra.css`]: 'x' }))), 'FAIL', 'UK1', /extra\.css: is not listed in SHA256SUMS/));
  assert.ok(at(l.lint(repo(files({ [`${V}/base.css`]: `${base}/* edit */\n` }))), 'FAIL', 'UK1', /base\.css: does not match SHA256SUMS/));
  assert.ok(at(l.lint(repo(files({ [`${V}/SHA256SUMS`]: '' }))), 'FAIL', 'UK1', /tokens\.css: is not listed in SHA256SUMS/));
  assert.ok(at(l.lint(repo(files({ 'design/pack.json': `${JSON.stringify({ pack: 'sheet', version: '1.0.0', vendor: V, prefix: 'xx', tokens: ['design/tokens.css'], sources: [] })}\n` }))), 'FAIL', 'UK1', /drop "prefix"/));
  assert.ok(at(l.lint(repo(files({ 'design/tokens.css': ':root { --ui-color-spot: #0b5cad; --ui-radius-sm: 2px; }\n:root[data-theme="dark"] { --ui-color-spot: #6fb3f5; }\n' }))), 'FAIL', 'UK8', /--ui-radius-sm reassigns a sheet role/));
  assert.ok(at(l.lint(repo(files({ 'design/tokens.css': ':root { --ui-color-spot: #0b5cad; }\n' }))), 'FAIL', 'UK2', /theme "dark".*does not assign --ui-color-spot/) === false, 'dark falls back through the vendored tokens');
});

test('lint.mjs CLI: exits 0 clean, 1 on a FAIL, prints the standards line format', () => {
  const ok = node([path.join(SK, 'lint.mjs'), repo(tplFiles())]);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /standards: \[ui-kit\/lint\] OK/);
  const bad = node([path.join(SK, 'lint.mjs'), repo(tplFiles({ 'design/base.css': 'a { color: red; }\n' }))]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /standards: FAIL \[ui-kit\/UK6\] design\/pack\.json: no :focus-visible rule/);
});

// ---- scripts/rename-tokens.mjs ----
const TABLE = { pack: 'sheet', from: 'bk', map: { '--bk-text': '--ui-color-text', '--bk-bg': '--ui-color-background', '--bk-pad': '--ui-space-3' }, keep: ['--bk-grey-700'] };
const table = (t = TABLE) => { const d = tmpdir('uk-tbl-'); const f = path.join(d, 't.json'); fs.writeFileSync(f, JSON.stringify(t)); return f; };

test('rename-tokens: dry run reports, --write rewrites whole names only, keep stays, a second run changes nothing', () => {
  const r = repo({ 'src/a.css': '.a { color: var(--bk-text); background: var(--bk-bg, #fff); --bk-grey-700: red; }\n.b { padding: var(--bk-pad); x: var(--bk-text-extra-not); }\n', 'README.md': 'use --bk-text\n' });
  const T = table({ ...TABLE, keep: ['--bk-grey-700', '--bk-text-extra-not'] });
  const lines = [];
  assert.equal(codemod.main(['--table', T, '--root', r], (s) => lines.push(s)), 0);
  assert.match(lines.at(-1), /dry run, 4 name\(s\) in 2 file\(s\)/);
  assert.match(fs.readFileSync(path.join(r, 'src/a.css'), 'utf8'), /--bk-text/);
  assert.equal(codemod.main(['--table', T, '--root', r, '--write'], () => {}), 0);
  const out = fs.readFileSync(path.join(r, 'src/a.css'), 'utf8');
  assert.equal(out, '.a { color: var(--ui-color-text); background: var(--ui-color-background, #fff); --bk-grey-700: red; }\n.b { padding: var(--ui-space-3); x: var(--bk-text-extra-not); }\n');
  assert.equal(fs.readFileSync(path.join(r, 'README.md'), 'utf8'), 'use --ui-color-text\n');
  const again = [];
  assert.equal(codemod.main(['--table', T, '--root', r, '--write'], (s) => again.push(s)), 0);
  assert.match(again.at(-1), /rewrote 0 name\(s\) in 0 file\(s\)/);
});

test('rename-tokens: refuses an unmapped old-prefix name and writes nothing', () => {
  const r = repo({ 'src/a.css': '.a { color: var(--bk-text); border: var(--bk-rule-weight); }\n', 'src/b.html': '<i style="color: var(--bk-rule-weight)">\n' });
  const lines = [];
  assert.equal(codemod.main(['--table', table(), '--root', r, '--write'], (s) => lines.push(s)), 1);
  assert.match(lines.join('\n'), /refused: 1 --bk-\* name\(s\) are not in the table/);
  assert.match(lines.join('\n'), /--bk-rule-weight {2}\(2x, first src\/a\.css:1\)/);
  assert.match(fs.readFileSync(path.join(r, 'src/a.css'), 'utf8'), /var\(--bk-text\)/, 'nothing written');
});

test('rename-tokens: bad tables are rejected (exit 2) with the reason', () => {
  const bad = (t, re) => { const lines = []; assert.equal(codemod.main(['--table', table(t), '--root', tmpdir('uk-e-')], (s) => lines.push(s)), 2); assert.match(lines.join('\n'), re); };
  bad({ from: 'bk', map: { '--bk-a': '--bk-b' } }, /the new name must be --ui-<category>/);
  bad({ from: 'bk', map: { '--bk-a': '--ui-colour-a' } }, /the new name must be/);
  bad({ from: 'bk', map: { '--bk-a': '--ui-color-a', '--bk-b': '--ui-color-a' } }, /both map to --ui-color-a/);
  bad({ from: 'bk', map: { '--xx-a': '--ui-color-a' } }, /old names must start with --bk-/);
  bad({ from: 'ui', map: { '--ui-a': '--ui-color-a' } }, /"from" must be the old/);
  bad({ from: 'bk', map: { '--bk-a': '--ui-color-a' }, keep: ['--bk-a'] }, /both renamed and kept/);
  assert.equal(codemod.main([], () => {}), 2);
});

test('rename-tokens: skips vendored, build and node_modules paths; --include narrows', () => {
  const r = repo({ 'src/a.css': 'x: var(--bk-text);\n', 'design/vendor/sheet/1.0.0/t.css': '--bk-zzz: 1;\n', 'node_modules/p/i.css': '--bk-yyy: 1;\n', 'dist/o.css': '--bk-www: 1;\n', 'lib/b.css': 'x: var(--bk-text);\n' });
  const lines = [];
  assert.equal(codemod.main(['--table', table(), '--root', r, '--include', 'src/**'], (s) => lines.push(s)), 0);
  assert.match(lines.at(-1), /1 name\(s\) in 1 file\(s\)/);
  assert.equal(codemod.main(['--table', table(), '--root', r], (s) => lines.push(s)), 0);
  assert.match(lines.at(-1), /2 name\(s\) in 2 file\(s\)/);
});
