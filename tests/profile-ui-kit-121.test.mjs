// ui-kit 1.2.1: a theme's bare selector matches only rules outside at-rules (the @media bleed). RED on 1.2.0, GREEN on 1.2.1:
//   UI_KIT_VERSION=1.2.0 node --test tests/profile-ui-kit-121.test.mjs   -> fails (the proof the bug is reproduced)
//   node --test tests/profile-ui-kit-121.test.mjs                        -> passes (1.2.1, or UI_KIT_SRC=1 for src/)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir, git } from './helpers.mjs';
import { fixture as fx } from './fixtures/ui-kit.mjs';

const DIR = process.env.UI_KIT_SRC ? path.join(KIT_ROOT, 'src/profiles/ui-kit') : path.join(KIT_ROOT, 'profiles/ui-kit', process.env.UI_KIT_VERSION || '1.2.1');
const SK = path.join(DIR, '.standards/ui-kit');
const l = await import(pathToFileURL(path.join(SK, 'lint.mjs')).href);
const g = await import(pathToFileURL(path.join(SK, 'ui-gen.mjs')).href);
const { hexOf } = await import(pathToFileURL(path.join(SK, 'contrast.mjs')).href);

function repo(files) {
  const r = tmpdir('uk121-');
  git(r, 'init', '-q', '-b', 'main');
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true });
    fs.writeFileSync(path.join(r, f), text);
  }
  git(r, 'add', '-A');
  return r;
}

const DARK = ['background: #101418', 'panel: #1b2229', 'text: #f2f4f6', 'text-muted: #c5ccd2', 'line: #34404a', 'border: #8b99a5',
  'primary: #8cc4f2', 'on-primary: #08233a', 'alert: #ff8a8a', 'on-alert: #2a0507', 'spot: #8cc4f2', 'focus: #8cc4f2', 'risk-1-ink: #7bd88f']
  .map((x) => `    --ui-color-${x};`).join('\n');
const mediaPack = (dark) => JSON.stringify({ ...JSON.parse(fx.files['design/pack.json']), themes: { light: [':root'], dark } }, null, 2) + '\n';
const withMedia = (dark) => ({
  ...fx.files,
  'design/pack.json': mediaPack(dark),
  'design/tokens.css': `${fx.files['design/tokens.css']}\n@media (prefers-color-scheme: dark) {\n  :root {\n${DARK}\n  }\n}\n`,
});
const fails = (found) => found.filter((f) => f.level === 'FAIL');

test('@media dark block on plain :root: the light theme keeps its own values', () => {
  const model = {};
  const found = l.lint(repo(withMedia(['@media (prefers-color-scheme: dark) :root'])), model);
  const { resolved } = model.model;
  assert.equal(hexOf(resolved.light.get('background').c), '#ffffff', 'light background is the light value, not the dark one');
  assert.equal(hexOf(resolved.light.get('on-primary').c), '#ffffff');
  assert.equal(hexOf(resolved.dark.get('background').c), '#101418', 'the dark theme still reads its @media rule');
  assert.equal(hexOf(resolved.dark.get('text').c), '#f2f4f6');
  assert.deepEqual(fails(found), [], 'a correct light + @media dark pack has no FAIL');
});

test('an entry written `<at-rule> <selector>` matches inside its at-rule; a bare entry does not match inside it', () => {
  const m1 = {};
  l.lint(repo(withMedia(['@media (prefers-color-scheme: dark) :root'])), m1);
  assert.ok(m1.model.themeMaps.dark.get('--ui-color-background').value === '#101418');
  // bare ':root' as the dark entry matches only the light block, so dark resolves to the light values
  const m2 = {};
  l.lint(repo(withMedia([':root'])), m2);
  assert.equal(m2.model.themeMaps.dark.get('--ui-color-background').value, 'var(--cmfz-white)');
});

test('ui-gen.mjs reads the same resolved model, so the page shows the light values per theme', () => {
  const r = repo(withMedia(['@media (prefers-color-scheme: dark) :root']));
  assert.equal(g.main([r, '--out', 'dist-ui']), 0);
  const html = fs.readFileSync(path.join(r, 'dist-ui/index.html'), 'utf8');
  assert.match(html, /data-theme-name="light"/);
  assert.match(html, /data-theme-name="dark"/);
});
