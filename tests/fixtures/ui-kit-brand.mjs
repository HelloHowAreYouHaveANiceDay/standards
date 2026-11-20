// ui-kit 1.2.0 brand fixture, own pack: a clean cmfz-shaped follower WITH a brand book (design/brand/ masters, rasters, a
// `brand` block, served copies) that passes lint.mjs UK9-UK12, plus injected defects. Each defect is proved by check.mjs
// exiting 1 naming the file (the missing-block case: exit 0 and a WARN naming design/pack.json). Offline, zero-dep.
import fs from 'node:fs';
import path from 'node:path';
import { png, ico } from '../../src/profiles/ui-kit/.standards/ui-kit/placeholder-rasters.mjs';

const NAVY = [0x0f, 0x3a, 0x5f];
const PACK = {
  pack: 'checkmyfloodzone',
  prefix: 'cmfz',
  version: '1.0.0',
  themes: { light: [':root'] },
  extensions: [],
  budgets: { inks: 20, sizes: 8 },
  tokens: ['design/tokens.css'],
  base: ['design/base.css'],
  sources: ['src/**/*.{css,html,vue}'],
  brand: {
    name: 'checkmyfloodzone',
    wordmark: { font: '--ui-font-sans', weight: 700 },
    clearspace: 0.5,
    min_px: 16,
    colors: ['--ui-color-primary', '--ui-color-text'],
    assets: ['water-line mark'],
    served: { 'public/favicon.svg': 'design/brand/mark.svg', 'public/og-default.png': 'design/brand/og.png' },
  },
};
const packJson = (brand) => `${JSON.stringify({ ...PACK, brand }, null, 2)}\n`;
const noBrand = () => { const { brand, ...rest } = PACK; return `${JSON.stringify(rest, null, 2)}\n`; };
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
const MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n  <circle cx="32" cy="32" r="28" fill="#0f3a5f"/>\n  <rect x="20" y="30" width="24" height="4" fill="#1b2a35"/>\n</svg>\n';
const MONO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n  <circle cx="32" cy="32" r="28" fill="currentColor"/>\n  <rect x="20" y="30" width="24" height="4" fill="none" stroke="currentColor"/>\n</svg>\n';
const OG = png(1200, 630, NAVY);

export const fixture = {
  id: 'ui-kit-brand',
  profiles: ['base@1.0.0', 'ui-kit@1.2.0'],
  files: {
    'design/pack.json': packJson(PACK.brand),
    'design/tokens.css': TOKENS,
    'design/base.css': BASE,
    'design/DESIGN.md': '# Design: checkmyfloodzone\n\n## Logo\n\nA water line through a disc.\n',
    'design/brand/mark.svg': MARK,
    'design/brand/mark-mono.svg': MONO,
    'design/brand/favicon.ico': ico(32, NAVY),
    'design/brand/apple-touch-icon.png': png(180, 180, NAVY),
    'design/brand/icon-192.png': png(192, 192, NAVY),
    'design/brand/icon-512.png': png(512, 512, NAVY),
    'design/brand/og.png': OG,
    'public/favicon.svg': MARK,
    'public/og-default.png': OG,
    'src/app.css': '.btn {\n  background: var(--ui-color-primary);\n  color: var(--ui-color-on-primary);\n}\n',
  },
  inject: (dir, h) => {
    const w = (rel, data) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), data); };
    const keep = (rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel)) : null);
    // edits: rel -> string | Buffer | null (null removes the file). Restores every file afterwards.
    const bites = (msg, re, edits, fails = true) => {
      const before = Object.keys(edits).map((rel) => [rel, keep(rel)]);
      for (const [rel, data] of Object.entries(edits)) { if (data === null) fs.rmSync(path.join(dir, rel)); else w(rel, data); }
      h.git('add', '-A');
      const r = h.check();
      h.step((fails ? r.code === 1 : r.code === 0) && re.test(r.out), msg, r.out);
      for (const [rel, data] of before) { if (data === null) fs.rmSync(path.join(dir, rel), { force: true }); else w(rel, data); }
      h.git('add', '-A');
    };
    bites('ui-kit brand: a missing mark-mono.svg fails UK9 naming design/brand/mark-mono.svg', /FAIL \[ui-kit\/UK9\] design\/brand\/mark-mono\.svg: required brand file is missing/, { 'design/brand/mark-mono.svg': null });
    bites('ui-kit brand: <text> in the mark fails UK10 naming design/brand/mark.svg', /FAIL \[ui-kit\/UK10\] design\/brand\/mark\.svg:4: <text> is not allowed/, { 'design/brand/mark.svg': MARK.replace('</svg>', '<text x="1" y="1">x</text></svg>') });
    bites('ui-kit brand: an off-token fill fails UK10 naming design/brand/mark.svg', /FAIL \[ui-kit\/UK10\] design\/brand\/mark\.svg:2: fill #ff0000 is not the light-theme value of any brand\.colors token/, { 'design/brand/mark.svg': MARK.replace('#0f3a5f', '#ff0000') });
    bites('ui-kit brand: og.png at 1200x628 fails UK11 naming design/brand/og.png', /FAIL \[ui-kit\/UK11\] design\/brand\/og\.png: is 1200x628; it must be 1200x630/, { 'design/brand/og.png': png(1200, 628, NAVY) });
    bites('ui-kit brand: a stale served copy fails UK12 naming public/favicon.svg', /FAIL \[ui-kit\/UK12\] public\/favicon\.svg: differs from its master design\/brand\/mark\.svg/, { 'public/favicon.svg': MARK.replace('r="28"', 'r="27"') });
    bites('ui-kit brand: clearspace 2 fails UK9 naming design/pack.json', /FAIL \[ui-kit\/UK9\] design\/pack\.json: brand\.clearspace must be a number from 0\.25 to 1/, { 'design/pack.json': packJson({ ...PACK.brand, clearspace: 2 }) });
    bites('ui-kit brand: a mono master with a hex fill fails UK10', /FAIL \[ui-kit\/UK10\] design\/brand\/mark-mono\.svg:2: fill is #0f3a5f; a mono master uses only currentColor/, { 'design/brand/mark-mono.svg': MONO.replace('currentColor"/>\n  <rect', '#0f3a5f"/>\n  <rect') });
    bites('ui-kit brand: no brand block only warns UK9 naming design/pack.json and the gate exits 0', /WARN \[ui-kit\/UK9\] design\/pack\.json: no "brand" block/, { 'design/pack.json': noBrand() }, false);
  },
};
