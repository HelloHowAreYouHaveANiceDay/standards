// astro-ts fixture: a clean Astro + TS follower passes with the real pinned npm tools; each injected defect fails
// naming its file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PINS = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'src', 'profiles', 'astro-ts', '.standards', 'astro-ts', 'check.json'), 'utf8')).tools;

const pkg = {
  name: 'fixture',
  private: true,
  type: 'module',
  dependencies: { astro: '7.4.11' },
  devDependencies: { ...PINS, '@types/node': '24.10.1' },
};

const FLOATING = 'export async function save(): Promise<void> {}\n\nexport function go(): void {\n  save()\n}\n';
const PAGE = '---\nconst title = \'ok\'\n---\n\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>{title}</title>\n  </head>\n  <body>\n    <main>\n      <slot />\n    </main>\n  </body>\n</html>\n';

export const fixture = {
  id: 'astro-ts',
  profiles: ['base@1.0.0', 'astro-ts@1.0.0'],
  files: {
    '.gitignore': 'node_modules/\ndist/\n.astro/\n',
    'package.json': `${JSON.stringify(pkg, null, 2)}\n`,
    'tsconfig.json': '{\n  "extends": "./.standards/astro-ts/tsconfig.base.json",\n  "include": [".astro/types.d.ts", "src/**/*", "*.config.mjs"],\n  "exclude": ["dist"]\n}\n',
    'eslint.config.mjs': "import standards from './.standards/astro-ts/eslint.base.mjs'\n\nexport default standards()\n",
    'astro.config.mjs': "import { defineConfig } from 'astro/config'\n\nexport default defineConfig({})\n",
    'src/pages/index.astro': PAGE,
    'src/lib/first.ts': "export function first(xs: string[]): string {\n  return xs[0] ?? ''\n}\n",
  },
  prepare: (dir, h) => {
    const i = h.npm(['install', '--no-audit', '--no-fund', '--ignore-scripts']);
    h.step(i.code === 0, 'npm install (pinned tools + astro)', i.out);
    return i.code === 0;
  },
  inject: (dir, h) => {
    const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const cases = [
      ['src/lib/save.ts', FLOATING, (o) => /src[\\/]lib[\\/]save\.ts[\s\S]*no-floating-promises/.test(o) && /FAIL \[astro-ts\/eslint 10\.14\.0\]/.test(o), 'a floating promise fails eslint (type-aware) naming src/lib/save.ts'],
      ['src/pages/typed.astro', '---\nconst n: number = \'not a number\'\n---\n\n<p>{n}</p>\n', (o) => /typed\.astro:2:\d+ - error ts\(2322\)|typed\.astro[\s\S]*2322/.test(o) && /FAIL \[astro-ts\/astro check 0\.9\.12\]/.test(o), 'a type error in .astro frontmatter fails astro check naming src/pages/typed.astro'],
      ['src/pages/img.astro', '<img src="/a.png" />\n', (o) => /img\.astro[\s\S]*(alt-text|img-redundant|jsx-a11y)/.test(o) && /FAIL \[astro-ts\/eslint 10\.14\.0\]/.test(o), 'an <img> without alt fails the a11y rules naming src/pages/img.astro'],
      ['src/pages/ugly.astro', '<p   class="x">hi</p>\n', (o) => /ugly\.astro/.test(o) && /FAIL \[astro-ts\/prettier 3\.10\.0\]/.test(o), 'an unformatted .astro fails prettier --check naming src/pages/ugly.astro'],
      ['src/lib/dis.ts', 'export const y = 1 // eslint-disable-line no-console\n', (o) => /src[\\/]lib[\\/]dis\.ts[\s\S]*(Unused eslint-disable|require-description)/.test(o), 'an unused / reasonless eslint-disable fails naming src/lib/dis.ts'],
    ];
    for (const [rel, body, ok, msg] of cases) {
      fs.writeFileSync(path.join(dir, rel), body);
      const r = h.check();
      h.step(r.code === 1 && ok(strip(r.out)), msg, `exit ${r.code}\n${r.out}`);
      fs.rmSync(path.join(dir, rel));
    }
    const pj = path.join(dir, 'package.json');
    const orig = fs.readFileSync(pj);
    const p = JSON.parse(orig); p.devDependencies.eslint = '^10.0.0';
    fs.writeFileSync(pj, `${JSON.stringify(p, null, 2)}\n`);
    const r = h.check();
    h.step(r.code === 1 && /FAIL \[astro-ts\/pins\] package\.json: eslint is "\^10\.0\.0", the profile pins exactly "10\.14\.0"/.test(r.out), 'a drifted pin fails the pins step', r.out);
    fs.writeFileSync(pj, orig);
    const again = h.check();
    h.step(again.code === 0, 'check.mjs passes again after the injections are removed', again.out);
  },
};
