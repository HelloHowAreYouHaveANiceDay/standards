// ui-kit fixture, own pack: a clean cmfz-shaped follower (light only, `risk` extension) that passes lint.mjs, plus injected
// defects. Each defect is proved by check.mjs exiting 1 naming the file (WARN defects: exit 0 and the finding names the file).
// lint.mjs is offline and zero-dep, so no downloads.
import fs from 'node:fs';
import path from 'node:path';

const PACK = {
  pack: 'checkmyfloodzone',
  prefix: 'cmfz',
  version: '1.0.0',
  themes: { light: [':root'] },
  extensions: ['risk'],
  budgets: { inks: 20, sizes: 8 },
  tokens: ['design/tokens.css'],
  base: ['design/base.css'],
  sources: ['src/**/*.{css,html,vue}'],
};
const packJson = (over = {}) => `${JSON.stringify({ ...PACK, ...over }, null, 2)}\n`;
const TOKENS = `:root {
  --cmfz-white: #ffffff;
  --cmfz-sand: #f4efe6;
  --cmfz-ink: #1b2a35;
  --cmfz-ink-soft: #4a5a66;
  --cmfz-rule: #d8d2c4;
  --cmfz-edge: #6f7a82;
  --cmfz-navy: #0f3a5f;
  --cmfz-red: #a4161a;
  --cmfz-stack: system-ui, "Segoe UI", sans-serif;

  --ui-color-background: var(--cmfz-white);
  --ui-color-panel: var(--cmfz-sand);
  --ui-color-text: var(--cmfz-ink);
  --ui-color-text-muted: var(--cmfz-ink-soft);
  --ui-color-line: var(--cmfz-rule);
  --ui-color-border: var(--cmfz-edge);
  --ui-color-primary: var(--cmfz-navy);
  --ui-color-on-primary: #ffffff;
  --ui-color-alert: var(--cmfz-red);
  --ui-color-on-alert: #ffffff;
  --ui-color-spot: var(--cmfz-navy);
  --ui-color-focus: var(--cmfz-navy);
  --ui-color-risk-1: #2e7d32;
  --ui-color-risk-5: #a4161a;
  --ui-color-risk-1-ink: #1b5e20;

  --ui-font-sans: var(--cmfz-stack);
  --ui-space-1: 4px;
  --ui-space-2: 8px;
  --ui-space-3: 12px;
  --ui-space-4: 16px;
  --ui-space-5: 24px;
  --ui-space-6: 32px;
  --ui-size-touch-min: 44px;
  --ui-size-focus-ring: 2px;
}
`;
const BASE = `:focus-visible {
  outline: var(--ui-size-focus-ring) solid var(--ui-color-focus);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
`;
const APP = `.btn {
  background: var(--ui-color-primary);
  color: var(--ui-color-on-primary);
  padding: var(--ui-space-2) var(--ui-space-4);
  transition: background 0.2s;
}

.risk-low {
  color: var(--ui-color-risk-1-ink);
}
`;
const PAGE = `<!doctype html>
<html lang="en">
<head><link rel="stylesheet" href="app.css"></head>
<body><button class="btn">Check</button></body>
</html>
`;

export const fixture = {
  id: 'ui-kit',
  profiles: ['base@1.0.0', 'ui-kit@1.2.1'],
  files: {
    'design/pack.json': packJson(),
    'design/tokens.css': TOKENS,
    'design/base.css': BASE,
    'src/app.css': APP,
    'src/index.html': PAGE,
  },
  inject: (dir, h) => {
    const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    const keep = (rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), 'utf8') : null);
    const bites = (msg, re, edits, fails = true, notRe = null) => {
      const before = Object.keys(edits).map((rel) => [rel, keep(rel)]);
      for (const [rel, text] of Object.entries(edits)) w(rel, text);
      h.git('add', '-A');
      const r = h.check();
      h.step((fails ? r.code === 1 : r.code === 0) && re.test(r.out) && !(notRe && notRe.test(r.out)), msg, r.out);
      for (const [rel, text] of before) { if (text === null) fs.rmSync(path.join(dir, rel)); else w(rel, text); }
      h.git('add', '-A');
    };
    bites('ui-kit: a missing --ui-color-focus fails UK2 naming design/tokens.css', /FAIL \[ui-kit\/UK2\] design\/tokens\.css: theme "light" \(:root\) does not assign --ui-color-focus/, { 'design/tokens.css': TOKENS.replace('  --ui-color-focus: var(--cmfz-navy);\n', '') });
    bites('ui-kit: on-primary at under 4.5:1 fails UK3 naming design/tokens.css', /FAIL \[ui-kit\/UK3\] design\/tokens\.css:\d+: --ui-color-on-primary on --ui-color-primary is 3\.\d\d:1/, { 'design/tokens.css': TOKENS.replace('--ui-color-on-primary: #ffffff', '--ui-color-on-primary: #8c8c8c') });
    bites('ui-kit: a dark theme without text-muted fails UK2', /FAIL \[ui-kit\/UK2\] design\/tokens\.css: theme "dark" \(:root\[data-theme="dark"\]\) does not assign --ui-color-text-muted/, {
      'design/pack.json': packJson({ themes: { light: [':root'], dark: [':root[data-theme="dark"]'] } }),
      'design/tokens.css': `${TOKENS}\n:root[data-theme="dark"] {\n  --ui-color-background: #101418;\n  --ui-color-panel: #1b2229;\n  --ui-color-text: #f2f4f6;\n  --ui-color-line: #34404a;\n  --ui-color-border: #8b99a5;\n  --ui-color-primary: #8cc4f2;\n  --ui-color-on-primary: #08233a;\n  --ui-color-alert: #ff8a8a;\n  --ui-color-on-alert: #2a0507;\n  --ui-color-spot: #8cc4f2;\n  --ui-color-focus: #8cc4f2;\n}\n`,
    });
    // 1.2.1: a dark block on plain :root inside @media must not feed the light theme. The dark block leaves
    // --ui-color-risk-1-ink to the light value, which fails on the dark background: only theme "dark" may report it.
    // On 1.2.0 the light theme resolved to the dark background too, so it reported "light" as well (RED).
    const MEDIA_DARK = `${TOKENS}
@media (prefers-color-scheme: dark) {
  :root {
    --ui-color-background: #101418;
    --ui-color-panel: #1b2229;
    --ui-color-text: #f2f4f6;
    --ui-color-text-muted: #c5ccd2;
    --ui-color-line: #34404a;
    --ui-color-border: #8b99a5;
    --ui-color-primary: #8cc4f2;
    --ui-color-on-primary: #08233a;
    --ui-color-alert: #ff8a8a;
    --ui-color-on-alert: #2a0507;
    --ui-color-spot: #8cc4f2;
    --ui-color-focus: #8cc4f2;
  }
}
`;
    bites('ui-kit: a dark block on plain :root inside @media does not feed the light theme (only dark fails UK3)', /FAIL \[ui-kit\/UK3\] design\/tokens\.css:\d+: --ui-color-risk-1-ink on --ui-color-background is 2\.35:1 in theme "dark"/, {
      'design/pack.json': packJson({ themes: { light: [':root'], dark: ['@media (prefers-color-scheme: dark) :root'] } }),
      'design/tokens.css': MEDIA_DARK,
    }, true, /in theme "light"/);
    bites('ui-kit: an unguarded transition fails UK7 naming src/app.css', /FAIL \[ui-kit\/UK7\] src\/app\.css:5: motion/, { 'design/base.css': BASE.replace(/@media[\s\S]*$/, '') });
    bites('ui-kit: no :focus-visible rule fails UK6', /FAIL \[ui-kit\/UK6\] design\/pack\.json: no :focus-visible rule reads var\(--ui-color-focus\)/, { 'design/base.css': BASE.replace(/:focus-visible \{[^}]*\}\n\n/, '') });
    bites('ui-kit: a raw #ff0000 in a .vue file warns UK5 naming it and the gate still exits 0', /WARN \[ui-kit\/UK5\] src\/Card\.vue:2: colour literal #ff0000/, { 'src/Card.vue': '<style>\n.x { color: #ff0000; }\n</style>\n' }, false);
    bites('ui-kit: a raw colour with a reasoned marker passes', /ui-kit\/lint\] OK/, { 'src/Card.vue': '<style>\n/* ui-kit: raw-color -- brand logo mark, fixture reason */\n.x { color: #ff0000; }\n</style>\n' }, false);
    bites('ui-kit: a source file reading --cmfz-navy fails UK8 naming it', /FAIL \[ui-kit\/UK8\] src\/app\.css:\d+: reads the private --cmfz-navy/, { 'src/app.css': `${APP}.x { color: var(--cmfz-navy); }\n` });
    bites('ui-kit: a source file declaring a --ui-* name fails UK8', /FAIL \[ui-kit\/UK8\] src\/app\.css:\d+: declares --ui-color-text/, { 'src/app.css': `${APP}.x { --ui-color-text: red; }\n` });
    bites('ui-kit: hostSet lets a source declare --ui-size-range-steps (OK, exit 0)', /ui-kit\/lint\] OK/, { 'design/pack.json': packJson({ hostSet: ['size-range-steps'] }), 'src/app.css': `${APP}input[type='range'] {\n  --ui-size-range-steps: 5;\n}\n` }, false);
    bites('ui-kit: without hostSet a source declaring --ui-size-range-steps fails UK8', /FAIL \[ui-kit\/UK8\] src\/app\.css:\d+: declares --ui-size-range-steps/, { 'src/app.css': `${APP}input[type='range'] {\n  --ui-size-range-steps: 5;\n}\n` });
    bites('ui-kit: hostSet does not open other public names (--ui-color-text still fails UK8)', /FAIL \[ui-kit\/UK8\] src\/app\.css:\d+: declares --ui-color-text/, { 'design/pack.json': packJson({ hostSet: ['size-range-steps'] }), 'src/app.css': `${APP}.x { --ui-color-text: red; }\n` });
    bites('ui-kit: a malformed hostSet fails UK1', /FAIL \[ui-kit\/UK1\] design\/pack\.json: .*"hostSet" must be an array/, { 'design/pack.json': packJson({ hostSet: ['--ui-size-range-steps'] }) });
    bites('ui-kit: default exclude skips a *.test.css file (OK, exit 0)', /ui-kit\/lint\] OK/, { 'src/Card.test.css': '.x { --ui-color-text: red; color: #ff0000; }\n' }, false);
    bites('ui-kit: a custom exclude replaces the default, so *.test.css is linted again (UK8)', /FAIL \[ui-kit\/UK8\] src\/Card\.test\.css:\d+: declares --ui-color-text/, { 'design/pack.json': packJson({ exclude: ['src/legacy/**'] }), 'src/Card.test.css': '.x { --ui-color-text: red; }\n' });
    bites('ui-kit: a custom exclude skips its glob (OK, exit 0)', /ui-kit\/lint\] OK/, { 'design/pack.json': packJson({ exclude: ['src/legacy/**'] }), 'src/legacy/old.css': '.x { --ui-color-text: red; }\n' }, false);
    bites('ui-kit: --ui-color-risk-1 without a declared extension fails UK8', /FAIL \[ui-kit\/UK8\] design\/tokens\.css:\d+: --ui-color-risk-1: .*no entry of "extensions"/, { 'design/pack.json': packJson({ extensions: [] }) });
    bites('ui-kit: --ui-colour-text fails UK8 naming design/tokens.css', /FAIL \[ui-kit\/UK8\] design\/tokens\.css:\d+: --ui-colour-text: "colour" is not a category/, { 'design/tokens.css': TOKENS.replace('--ui-font-sans', '--ui-colour-text: #000000;\n  --ui-font-sans') });
  },
};
