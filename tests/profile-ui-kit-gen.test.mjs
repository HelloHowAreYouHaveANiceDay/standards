// ui-kit 1.1.0: ui-gen.mjs generates the ui.<domain> page for a Broadsheet-shaped (converging, light + dark) and a cmfz-shaped
// (own pack, light only, extension) fixture; the contrast table on the page must equal what lint.mjs UK3 reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir, git } from './helpers.mjs';
import { fixture as own } from './fixtures/ui-kit.mjs';
import { fixture as conv } from './fixtures/ui-kit-converging.mjs';

const DIR = process.env.UI_KIT_SRC ? path.join(KIT_ROOT, 'src/profiles/ui-kit') : path.join(KIT_ROOT, 'profiles/ui-kit/1.1.0');
const SK = path.join(DIR, '.standards/ui-kit');
const l = await import(pathToFileURL(path.join(SK, 'lint.mjs')).href);
const g = await import(pathToFileURL(path.join(SK, 'ui-gen.mjs')).href);

const DESIGN = '# Design: demo\n\n## Look\n\nWarm **paper** and `navy` ink.\n\n## Voice\n\n- Plain words.\n- Second person.\n';

function repo(fx, over = {}) {
  const r = tmpdir('ukg-');
  git(r, 'init', '-q', '-b', 'main');
  for (const [f, text] of Object.entries({ ...fx.files, 'design/DESIGN.md': DESIGN, ...over })) {
    fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true });
    fs.writeFileSync(path.join(r, f), text);
  }
  git(r, 'add', '-A');
  return r;
}
const gen = (r) => { const res = g.generate(r, path.join(r, 'dist-ui')); return { ...res, html: fs.readFileSync(path.join(r, 'dist-ui/index.html'), 'utf8'), dir: path.join(r, 'dist-ui') }; };

// rows of every contrast table: theme -> [{ pair, ratio, min, pass }]
function pageRows(html) {
  const out = {};
  for (const t of html.matchAll(/<table class="contrast" data-theme-name="([^"]+)">([\s\S]*?)<\/table>/g)) {
    out[t[1]] = [...t[2].matchAll(/<tr><th scope="row">(.*?)<\/th>.*?<td>([\d.]+):1<\/td><td>([\d.]+):1<\/td><td class="(pass|fail)">/g)]
      .map((r) => ({ pair: r[1].replace(/<\/?code>/g, ''), ratio: r[2], min: Number(r[3]), pass: r[4] === 'pass' }));
  }
  return out;
}

for (const [name, fx, themes, pairsPerTheme] of [['cmfz-shaped (own pack)', own, ['light'], 11 + 1], ['Broadsheet-shaped (converging)', conv, ['light', 'dark'], 11]]) {
  test(`ui-gen: ${name} page has every section and the lint's contrast table`, () => {
    const r = repo(fx);
    const lintFound = l.lint(r);
    assert.deepEqual(lintFound.filter((f) => f.level === 'FAIL'), [], 'the fixture is lint-clean');
    const { html, dir, findings } = gen(r);
    assert.deepEqual(findings.filter((f) => f.level === 'FAIL'), []);
    for (const f of ['index.html', 'pack.css', 'ui.css']) assert.ok(fs.existsSync(path.join(dir, f)), f);
    // every required --ui-color-* role is a swatch row, in every theme
    for (const role of l.CONTRACT.required.color) assert.ok(html.includes(`<code>--ui-color-${role}</code>`), role);
    const rows = pageRows(html);
    assert.deepEqual(Object.keys(rows), themes);
    for (const t of themes) {
      assert.equal(rows[t].length, pairsPerTheme, `rows in ${t}`);
      assert.ok(rows[t].every((x) => x.pass), 'clean pack: every row passes');
      assert.ok(rows[t].every((x) => Number(x.ratio) >= x.min));
    }
    for (const id of ['colour', 'tokens', 'focus', 'elements', 'extensions', 'voice', 'look']) assert.ok(html.includes(`id="${id}"`), id);
    for (const el of ['<button', '<input', '<select', '<table', '<a href="#elements"', 'role="alert"', 'badge-demo']) assert.ok(html.includes(el), el);
    assert.ok(html.includes('prefers-reduced-motion') && html.includes('Focus and motion'));
    assert.match(html, /<h2 id="h-voice">Voice<\/h2>\s*<ul><li>Plain words\.<\/li>/);
    assert.match(html, /<h2 id="h-look">Look<\/h2>\s*<p>Warm <strong>paper<\/strong> and <code>navy<\/code> ink\.<\/p>/);
    assert.ok(!/(src|href)="https?:/.test(html), 'no external script, font or stylesheet');
    assert.equal(/id="theme-toggle"/.test(html), themes.includes('dark'), 'toggle only when the pack declares dark');
  });
}

test('ui-gen: a failing pair is a FAIL row on the page with the same ratio the lint prints', () => {
  const bad = repo(own, { 'design/tokens.css': own.files['design/tokens.css'].replace('--ui-color-on-primary: #ffffff', '--ui-color-on-primary: #8c8c8c') });
  const found = l.lint(bad).filter((f) => f.rule === 'UK3');
  assert.equal(found.length, 1);
  const lintRatio = /is (\d\.\d\d):1/.exec(found[0].msg)[1];
  const { html, findings } = gen(bad);
  assert.equal(findings.filter((f) => f.rule === 'UK3').length, 1);
  const failing = pageRows(html).light.filter((x) => !x.pass);
  assert.equal(failing.length, 1);
  assert.equal(failing[0].pair, '--ui-color-on-primary on --ui-color-primary');
  assert.equal(failing[0].ratio, lintRatio);
  assert.equal(g.main([bad, '--out', 'dist-ui']), 1, 'the CLI still writes the page but exits 1 while the pack fails lint');
});

test('ui-gen: extension ink rows, storybook link, dark selector toggle, DESIGN.md gaps', () => {
  const a = gen(repo(own));
  assert.ok(pageRows(a.html).light.some((x) => x.pair === '--ui-color-risk-1-ink on --ui-color-background'), 'extension ink is a contrast row');
  assert.ok(a.html.includes('<code>--ui-color-risk-5</code>'));
  assert.ok(!a.html.includes('id="storybook"'));
  const pj = JSON.parse(own.files['design/pack.json']);
  const sb = gen(repo(own, { 'design/pack.json': JSON.stringify({ ...pj, storybook: 'https://storybook.example.test/' }) }));
  assert.ok(sb.html.includes('<a href="https://storybook.example.test/">'));
  const bsd = gen(repo(conv));
  assert.match(bsd.html, /id="theme-toggle"/);
  assert.match(bsd.html, /setAttribute\("data-theme", "dark"\)/);
  const noDesign = gen(repo(own, { 'design/DESIGN.md': '# x\n' }));
  assert.ok(noDesign.html.includes('Not written yet'));
  const evil = JSON.parse(own.files['design/pack.json']);
  const bad = l.lint(repo(own, { 'design/pack.json': JSON.stringify({ ...evil, storybook: 'javascript:alert(1)' }) }));
  assert.ok(bad.some((f) => f.rule === 'UK1' && /storybook/.test(f.msg)));
});

test('ui-gen: CLI usage errors exit 2; an unreadable pack writes nothing', () => {
  assert.equal(g.main(['--bogus']), 2);
  const none = tmpdir('ukg-');
  git(none, 'init', '-q', '-b', 'main');
  assert.equal(g.main([none]), 1);
  assert.ok(!fs.existsSync(path.join(none, 'dist-ui')));
});
