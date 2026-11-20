// ui-kit 1.2.0: brand rules UK9-UK12 (lint.mjs), brand.html (ui-gen.mjs), the template brand set and placeholder rasters.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir, git } from './helpers.mjs';
import { fixture as fx } from './fixtures/ui-kit-brand.mjs';
import { fixture as conv } from './fixtures/ui-kit-converging.mjs';
const { hexOf } = await import(pathToFileURL(path.join(KIT_ROOT, process.env.UI_KIT_SRC ? 'src/profiles/ui-kit' : 'profiles/ui-kit/1.2.0', '.standards/ui-kit/contrast.mjs')).href);

const DIR = process.env.UI_KIT_SRC ? path.join(KIT_ROOT, 'src/profiles/ui-kit') : path.join(KIT_ROOT, 'profiles/ui-kit/1.2.0');
const SK = path.join(DIR, '.standards/ui-kit');
const l = await import(pathToFileURL(path.join(SK, 'lint.mjs')).href);
const g = await import(pathToFileURL(path.join(SK, 'ui-gen.mjs')).href);
const pr = await import(pathToFileURL(path.join(SK, 'placeholder-rasters.mjs')).href);

function repo(files) {
  const r = tmpdir('ukb-');
  git(r, 'init', '-q', '-b', 'main');
  for (const [f, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true });
    fs.writeFileSync(path.join(r, f), data);
  }
  git(r, 'add', '-A');
  return r;
}
const NO = (found) => found.filter((f) => f.level === 'FAIL');
const hit = (found, level, rule, re) => found.some((f) => f.level === level && f.rule === rule && re.test(`${f.file}: ${f.msg}`));
const MARK = fx.files['design/brand/mark.svg'];
const pj = (over) => `${JSON.stringify({ ...JSON.parse(fx.files['design/pack.json']), ...over }, null, 2)}\n`;
const brandPj = (over) => pj({ brand: { ...JSON.parse(fx.files['design/pack.json']).brand, ...over } });

test('a clean brand book passes UK9-UK12 with no findings', () => {
  assert.deepEqual(l.lint(repo(fx.files)), []);
});

test('UK9: no brand block is a WARN, a malformed block or missing file is a FAIL', () => {
  const { brand, ...rest } = JSON.parse(fx.files['design/pack.json']);
  const none = l.lint(repo({ ...fx.files, 'design/pack.json': `${JSON.stringify(rest)}\n` }));
  assert.deepEqual(NO(none), []);
  assert.ok(hit(none, 'WARN', 'UK9', /design\/pack\.json: no "brand" block/));
  for (const [over, re] of [
    [{ name: '' }, /brand\.name is required/],
    [{ clearspace: 0.1 }, /brand\.clearspace must be a number from 0\.25 to 1/],
    [{ min_px: 12 }, /brand\.min_px must be an integer of at least 16/],
    [{ colors: ['--ui-color-nope'] }, /names --ui-color-nope, which the pack does not declare/],
    [{ served: { 'public/x.svg': 'public/mark.svg' } }, /target for public\/x\.svg must be a file in design\/brand\//],
    [{ wordmark: { font: '--ui-font-nope' } }, /wordmark\.font must name a token/],
  ]) assert.ok(hit(l.lint(repo({ ...fx.files, 'design/pack.json': brandPj(over) })), 'FAIL', 'UK9', re), JSON.stringify(over));
  const gone = { ...fx.files };
  delete gone['design/brand/icon-512.png'];
  assert.ok(hit(l.lint(repo(gone)), 'FAIL', 'UK9', /design\/brand\/icon-512\.png: required brand file is missing/));
  const lockup = l.lint(repo({ ...fx.files, 'design/brand/logo.svg': MARK }));
  assert.ok(hit(lockup, 'FAIL', 'UK9', /logo-mono\.svg: logo\.svg exists, so logo-mono\.svg is required/));
  assert.deepEqual(NO(l.lint(repo({ ...fx.files, 'design/brand/logo.svg': MARK, 'design/brand/logo-mono.svg': fx.files['design/brand/mark-mono.svg'] }))), []);
});

test('UK10: SVG hygiene and logo colours', () => {
  const bad = (svg, re, name = 'mark.svg') => assert.ok(hit(l.lint(repo({ ...fx.files, [`design/brand/${name}`]: svg })), 'FAIL', 'UK10', re), svg.slice(0, 80));
  bad('<svg viewBox="0 0 1 1"><g></svg>', /is not well-formed XML/);
  bad('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1" fill="#0f3a5f"/></svg>', /root element must be <svg> with a viewBox/);
  bad('<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>', /<script> is not allowed/);
  bad('<svg viewBox="0 0 1 1"><foreignObject/></svg>', /<foreignObject> is not allowed/);
  bad('<svg viewBox="0 0 1 1"><image href="#a"/></svg>', /<image> is not allowed/);
  bad('<svg viewBox="0 0 1 1" onload="x()"><path d="M0 0"/></svg>', /event attribute onload/);
  bad('<svg viewBox="0 0 1 1"><use href="https://example.test/a.svg#b"/></svg>', /external href/);
  bad('<svg viewBox="0 0 1 1"><path style="fill:url(http://example.test/x)"/></svg>', /url\(\) points outside/);
  bad('<svg viewBox="0 0 1 1"><path fill="#a4161a" d="M0 0"/></svg>', /fill #a4161a is not the light-theme value of any brand\.colors token/);
  bad('<svg viewBox="0 0 1 1"><path style="stroke: red" d="M0 0"/></svg>', /stroke is red; the lint cannot read it/);
  bad('<svg viewBox="0 0 1 1"><path fill="#0f3a5f" d="M0 0"/></svg>', /fill is #0f3a5f; a mono master uses only currentColor/, 'mark-mono.svg');
  // allowed: token values (also in 3-digit/uppercase form), none, currentColor, url(#gradient), comments and an XML prolog
  const ok = '<?xml version="1.0"?>\n<!-- ok -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path fill="#0F3A5F" stroke="none" d="M0 0"/><path fill="#1b2a35" d="M1 1"/><path fill="url(#g)" d="M2 2"/></svg>\n';
  assert.deepEqual(NO(l.lint(repo({ ...fx.files, 'design/brand/mark.svg': ok, 'public/favicon.svg': ok }))), []);
});

test('UK11: PNG and ICO headers', () => {
  const bad = (rel, data, re) => assert.ok(hit(l.lint(repo({ ...fx.files, [rel]: data })), 'FAIL', 'UK11', re), rel);
  bad('design/brand/og.png', pr.png(1200, 628, [0, 0, 0]), /og\.png: is 1200x628; it must be 1200x630/);
  bad('design/brand/apple-touch-icon.png', pr.png(192, 192, [0, 0, 0]), /apple-touch-icon\.png: is 192x192; it must be 180x180/);
  bad('design/brand/icon-192.png', Buffer.from('not a png at all, just text bytes here'), /icon-192\.png: is not a PNG file/);
  bad('design/brand/icon-512.png', pr.png(256, 256, [0, 0, 0]), /icon-512\.png: is 256x256/);
  bad('design/brand/favicon.ico', pr.ico(16, [0, 0, 0]), /favicon\.ico: has no 32x32 entry \(has 16x16\)/);
  bad('design/brand/favicon.ico', pr.png(32, 32, [0, 0, 0]), /favicon\.ico: is not an ICO file/);
});

test('UK12: served copies equal their masters; a missing copy fails', () => {
  const stale = l.lint(repo({ ...fx.files, 'public/og-default.png': pr.png(1200, 630, [1, 2, 3]) }));
  assert.ok(hit(stale, 'FAIL', 'UK12', /public\/og-default\.png: differs from its master design\/brand\/og\.png/));
  const gone = { ...fx.files };
  delete gone['public/favicon.svg'];
  assert.ok(hit(l.lint(repo(gone)), 'FAIL', 'UK12', /public\/favicon\.svg: is listed in brand\.served but missing/));
});

test('lint helpers: tokenizer and header readers', () => {
  assert.equal(l.xmlElements('<a><b/></a>').els.length, 2);
  assert.match(l.xmlElements('<a><b></a>').error, /closes the wrong element/);
  assert.match(l.xmlElements('<a/><b/>').error, /more than one root/);
  assert.match(l.xmlElements('<!DOCTYPE a [<!ENTITY x "y">]><a/>').error, /entities/);
  assert.equal(l.pngSize(Buffer.from('nope')), null);
  assert.deepEqual(l.icoSizes(pr.ico(32, [0, 0, 0])), [{ w: 32, h: 32 }]);
});

test('template: the brand set is a clean pack once pack/prefix/name are filled; rasters come from placeholder-rasters.mjs', () => {
  const TPL = path.join(SK, 'templates/pack');
  const t = (n) => fs.readFileSync(path.join(TPL, n), 'utf8');
  const files = {
    'design/pack.json': t('pack.json').replace('"pack": ""', '"pack": "demo"').replace('"prefix": ""', '"prefix": "dm"').replace('"name": ""', '"name": "demo"'),
    'design/tokens.css': t('tokens.css').replaceAll('--tpl-', '--dm-'),
    'design/base.css': t('base.css'),
    'design/brand/mark.svg': t('brand/mark.svg'),
    'design/brand/mark-mono.svg': t('brand/mark-mono.svg'),
  };
  const r = repo(files);
  assert.ok(hit(l.lint(r), 'FAIL', 'UK9', /design\/brand\/og\.png: required brand file is missing/), 'binary files are not vendored');
  assert.deepEqual(pr.write(path.join(r, 'design/brand')).sort(), ['apple-touch-icon.png', 'favicon.ico', 'icon-192.png', 'icon-512.png', 'og.png']);
  assert.deepEqual(l.lint(r), [], 'the placeholder set passes UK9-UK12 on day one');
  assert.throws(() => pr.write(path.join(r, 'x'), 'red'), /--color must be #rrggbb/);
});

const gen = (files) => {
  const r = repo(files);
  const res = g.generate(r, path.join(r, 'dist-ui'));
  return { ...res, r, out: path.join(r, 'dist-ui') };
};
const read = (o, f) => fs.readFileSync(path.join(o, f), 'utf8');

test('brand.html: every section, the downloads copy, a Brand link on index.html, pure ASCII output', () => {
  const files = { ...fx.files, 'design/DESIGN.md': '# d\n\n## Look\n\nWarm.\n\n## Logo\n\nA water line \u2013 through a disc.\n\n## Imagery\n\nOwn charts only.\n\n## Assets\n\nThe mark.\n' };
  const { out, findings } = gen(files);
  assert.deepEqual(NO(findings), []);
  const html = read(out, 'brand.html');
  for (const id of ['logo', 'clearspace', 'minsize', 'colour', 'dont', 'icons', 'words']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /<code>checkmyfloodzone<\/code>/);
  assert.match(html, /Keep <strong>0\.5<\/strong> x the mark height clear on every side \(here 48px around a 96px mark\)/);
  assert.match(html, /never smaller than <strong>16px<\/strong>/);
  for (const cap of ['scaleX 1.4', '12 degrees', 'shadows', 'outside the pack tokens', 'Do not outline', 'busy or low-contrast']) assert.ok(html.includes(cap), cap);
  assert.match(html, /<tr><th scope="row"><code>--ui-color-primary<\/code><\/th><td>.*#0f3a5f/);
  assert.match(html, /water line &#x2013; through a disc/);
  assert.match(html, /<li>water-line mark<\/li>/);
  assert.match(html, /<div class="tile" data-theme-name="light"[^>]*>.*full colour/s);
  assert.match(html, /<span class="wordmark" style="font-family:var\(--ui-font-sans\);font-weight:700">checkmyfloodzone<\/span>/, 'text lockup without logo.svg');
  assert.match(html, /<img src="brand\/og\.png" width="600" height="315"/);
  assert.match(html, /<a href="brand\/mark\.svg">mark\.svg<\/a>/);
  for (const f of ['mark.svg', 'mark-mono.svg', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'og.png']) assert.ok(fs.existsSync(path.join(out, 'brand', f)), `brand/${f} copied`);
  assert.match(read(out, 'index.html'), /<a href="brand\.html">Brand<\/a>/);
  assert.ok(read(out, 'ui.css').includes('.mis-stretch'));
  assert.ok(!/(src|href)="https?:/.test(html), 'no external reference');
  for (const f of ['index.html', 'brand.html', 'ui.css', 'pack.css']) assert.ok(!/[^\x00-\x7f]/.test(read(out, f)), `${f} is pure ASCII`);
});

test('brand.html: without a brand block there is no brand page and no link; with a lockup the lockup replaces the text lockup', () => {
  const { brand, ...rest } = JSON.parse(fx.files['design/pack.json']);
  const none = gen({ ...fx.files, 'design/pack.json': `${JSON.stringify(rest)}\n` });
  assert.ok(!fs.existsSync(path.join(none.out, 'brand.html')) && !fs.existsSync(path.join(none.out, 'brand')));
  assert.ok(!read(none.out, 'index.html').includes('brand.html'));
  const lock = gen({ ...fx.files, 'design/brand/logo.svg': MARK, 'design/brand/logo-mono.svg': fx.files['design/brand/mark-mono.svg'] });
  assert.deepEqual(NO(lock.findings), []);
  assert.ok(!read(lock.out, 'brand.html').includes('class="wordmark"'));
});

test('brand.html: a theme where a logo colour is under 3:1 gets the mono variant with the numbers', () => {
  const dark = JSON.parse(fx.files['design/pack.json']);
  dark.themes = { light: [':root'], dark: [':root[data-theme="dark"]'] };
  const tokens = `${fx.files['design/tokens.css']}\n:root[data-theme="dark"] {\n  --ui-color-background: #101418;\n  --ui-color-panel: #1b2229;\n  --ui-color-text: #f2f4f6;\n  --ui-color-text-muted: #c5ccd2;\n  --ui-color-line: #34404a;\n  --ui-color-border: #8b99a5;\n  --ui-color-primary: #8cc4f2;\n  --ui-color-on-primary: #08233a;\n  --ui-color-alert: #ff8a8a;\n  --ui-color-on-alert: #2a0507;\n  --ui-color-spot: #8cc4f2;\n  --ui-color-focus: #8cc4f2;\n}\n`;
  const { out } = gen({ ...fx.files, 'design/pack.json': `${JSON.stringify(dark)}\n`, 'design/tokens.css': tokens });
  const html = read(out, 'brand.html');
  assert.match(html, /data-theme-name="light"[^>]*>.*?Theme <strong>light<\/strong>: full colour/s);
  assert.match(html, /data-theme-name="dark"[^>]*>.*?Theme <strong>dark<\/strong>: mono \(text colour\)\. Logo colours on #101418: <code>#0f3a5f<\/code> 1\.\d\d:1/s);
});

test('brand.html: the CLI exits 1 while UK9-UK12 fail and still writes the page; a converging pack with a brand block works', () => {
  const bad = repo({ ...fx.files, 'public/favicon.svg': 'stale\n' });
  assert.equal(g.main([bad, '--out', 'dist-ui']), 1);
  assert.ok(fs.existsSync(path.join(bad, 'dist-ui/brand.html')));
  const cp = JSON.parse(conv.files['design/pack.json']);
  const model = {};
  l.lint(repo(conv.files), model);
  const ink = hexOf(model.model.resolved.light.get('primary').c);
  const svg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="${fill}"/></svg>\n`;
  const files = { ...conv.files, 'design/pack.json': `${JSON.stringify({ ...cp, brand: { name: 'bim', colors: ['--ui-color-primary', '--ui-color-text'], assets: [] } })}\n`,
    'design/brand/mark.svg': svg(ink), 'design/brand/mark-mono.svg': svg('currentColor') };
  const r = repo(files);
  pr.write(path.join(r, 'design/brand'), ink);
  const found = l.lint(r);
  const brandFails = found.filter((f) => f.level === 'FAIL' && /^UK(9|10|11|12)$/.test(f.rule));
  assert.deepEqual(brandFails, [], 'a converging pack takes colours from the vendored tokens');
  assert.equal(g.main([r, '--out', 'dist-ui']), 0);
  assert.match(read(path.join(r, 'dist-ui'), 'brand.html'), /data-theme-name="dark"/);
});
