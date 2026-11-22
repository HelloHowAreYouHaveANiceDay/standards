// ui-kit fixture, converging pack: a clean follower that vendors Broadsheet 1.0.0 (a frozen copy shaped like the real pack, with
// SHA256SUMS) and sets only its own spot, plus injected defects. The vendored dark theme has two selectors.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const V = 'design/vendor/broadsheet/1.0.0';
const VPACK = `${JSON.stringify({
  pack: 'broadsheet',
  prefix: 'bk',
  version: '1.0.0',
  themes: { light: [':root'], dark: [':root[data-theme="dark"]', '@media (prefers-color-scheme: dark) :root:not([data-theme="light"])'] },
  extensions: [],
  budgets: { inks: 20, sizes: 8 },
  tokens: ['tokens.css'],
  base: ['base.css'],
}, null, 2)}\n`;
const LIGHT = `  --ui-color-background: var(--bk-paper);
  --ui-color-panel: var(--bk-grey-100);
  --ui-color-text: var(--bk-grey-900);
  --ui-color-text-muted: var(--bk-grey-700);
  --ui-color-line: var(--bk-grey-300);
  --ui-color-border: var(--bk-grey-500);
  --ui-color-primary: var(--bk-grey-900);
  --ui-color-on-primary: var(--bk-paper);
  --ui-color-alert: var(--bk-red);
  --ui-color-on-alert: var(--bk-paper);
  --ui-color-spot: var(--bk-grey-700);
  --ui-color-focus: var(--bk-grey-900);
`;
const DARK = `  --ui-color-background: #101010;
  --ui-color-panel: #1c1c1c;
  --ui-color-text: #f0f0f0;
  --ui-color-text-muted: #b5b5b5;
  --ui-color-line: #333333;
  --ui-color-border: #8a8a8a;
  --ui-color-primary: #f0f0f0;
  --ui-color-on-primary: #101010;
  --ui-color-alert: #ff8a8a;
  --ui-color-on-alert: #1a0000;
  --ui-color-spot: #b5b5b5;
  --ui-color-focus: #f0f0f0;
`;
const VTOKENS = `:root {
  --bk-paper: #ffffff;
  --bk-grey-100: #f5f5f5;
  --bk-grey-300: #d4d4d4;
  --bk-grey-500: #767676;
  --bk-grey-700: #545454;
  --bk-grey-900: #141414;
  --bk-red: #b00020;
  --bk-stack: Georgia, "Times New Roman", serif;
${LIGHT}  --ui-font-sans: var(--bk-stack);
  --ui-space-1: 4px;
  --ui-space-2: 8px;
  --ui-space-3: 12px;
  --ui-space-4: 16px;
  --ui-space-5: 24px;
  --ui-space-6: 32px;
  --ui-size-touch-min: 44px;
  --ui-size-focus-ring: 2px;
}

:root[data-theme="dark"] {
${DARK}}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${DARK.replace(/^/gm, '  ').replace(/ +$/gm, '')}  }
}
`;
const VBASE = `:focus-visible {
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
const vendorFiles = { 'pack.json': VPACK, 'tokens.css': VTOKENS, 'base.css': VBASE };
const sums = (files) => `${Object.keys(files).sort().map((f) => `${crypto.createHash('sha256').update(files[f]).digest('hex')}  ${f}\n`).join('')}`;

const PACK = {
  pack: 'broadsheet',
  version: '1.0.0',
  vendor: V,
  tokens: ['design/tokens.css'],
  extensions: [],
  sources: ['src/**/*.{css,html,njk}'],
};
const packJson = (over = {}) => `${JSON.stringify({ ...PACK, ...over }, null, 2)}\n`;
const TOKENS = `:root {
  --ui-color-spot: #0b5cad;
}

:root[data-theme="dark"] {
  --ui-color-spot: #6fb3f5;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ui-color-spot: #6fb3f5;
  }
}
`;
const APP = `.mark {
  border-left: 4px solid var(--ui-color-spot);
  color: var(--ui-color-text);
  padding: var(--ui-space-3);
}
`;

export const fixture = {
  id: 'ui-kit-converging',
  profiles: ['base@1.0.0', 'ui-kit@1.2.1'],
  files: {
    'design/pack.json': packJson(),
    'design/tokens.css': TOKENS,
    [`${V}/pack.json`]: VPACK,
    [`${V}/tokens.css`]: VTOKENS,
    [`${V}/base.css`]: VBASE,
    [`${V}/SHA256SUMS`]: sums(vendorFiles),
    'src/app.css': APP,
    'src/index.njk': '<link rel="stylesheet" href="app.css">\n<p class="mark">Hello</p>\n',
  },
  inject: (dir, h) => {
    const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    const keep = (rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), 'utf8') : null);
    const bites = (msg, re, edits) => {
      const before = Object.keys(edits).map((rel) => [rel, keep(rel)]);
      for (const [rel, text] of Object.entries(edits)) w(rel, text);
      h.git('add', '-A');
      const r = h.check();
      h.step(r.code === 1 && re.test(r.out), msg, r.out);
      for (const [rel, text] of before) { if (text === null) fs.rmSync(path.join(dir, rel)); else w(rel, text); }
      h.git('add', '-A');
    };
    bites('ui-kit: an edited vendored file fails UK1 naming it', new RegExp(`FAIL \\[ui-kit/UK1\\] ${V.replace(/\./g, '\\.')}/tokens\\.css: does not match SHA256SUMS`), { [`${V}/tokens.css`]: VTOKENS.replace('#ffffff', '#fefefe') });
    bites('ui-kit: a pin that disagrees with the vendored folder fails UK1', /FAIL \[ui-kit\/UK1\] design\/pack\.json: "vendor" is design\/vendor\/broadsheet\/1\.0\.0; it must end in \/broadsheet\/1\.1\.0/, { 'design/pack.json': packJson({ version: '1.1.0' }) });
    bites('ui-kit: a spot below 3:1 in dark fails UK3 naming design/tokens.css', /FAIL \[ui-kit\/UK3\] design\/tokens\.css:\d+: --ui-color-spot on --ui-color-background is 1\.\d\d:1 in theme "dark"/, { 'design/tokens.css': TOKENS.replace(/#6fb3f5/g, '#151515') });
    bites('ui-kit: own tokens reassigning --ui-color-text fail UK8', /FAIL \[ui-kit\/UK8\] design\/tokens\.css:\d+: --ui-color-text reassigns a broadsheet role/, { 'design/tokens.css': `${TOKENS}\n:root {\n  --ui-color-text: #000000;\n}\n` });
    bites('ui-kit: a source reading --bk-grey-700 fails UK8 naming src/app.css', /FAIL \[ui-kit\/UK8\] src\/app\.css:\d+: reads the private --bk-grey-700/, { 'src/app.css': `${APP}.x { color: var(--bk-grey-700); }\n` });
  },
};
