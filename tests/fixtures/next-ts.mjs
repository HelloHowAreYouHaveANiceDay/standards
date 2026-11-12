// next-ts fixture: a clean Next.js (app router) + TS follower passes with the real pinned npm tools; each injected
// defect fails naming its file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PINS = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'src', 'profiles', 'next-ts', '.standards', 'next-ts', 'check.json'), 'utf8')).tools;

const pkg = {
  name: 'fixture',
  private: true,
  type: 'module',
  dependencies: { next: '16.4.6', react: '19.3.1', 'react-dom': '19.3.1' },
  devDependencies: { ...PINS, '@types/node': '24.10.1', '@types/react': '19.3.0', '@types/react-dom': '19.3.0' },
};

const FLOATING = "export async function save(): Promise<void> {}\n\nexport function go(): void {\n  void save\n  save()\n}\n";

export const fixture = {
  id: 'next-ts',
  profiles: ['base@1.0.0', 'next-ts@1.0.0'],
  files: {
    '.gitignore': 'node_modules/\n.next/\nnext-env.d.ts\ntsconfig.tsbuildinfo\n',
    'package.json': `${JSON.stringify(pkg, null, 2)}\n`,
    'tsconfig.json': '{\n  "extends": "./.standards/next-ts/tsconfig.base.json",\n  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],\n  "exclude": ["node_modules"]\n}\n',
    'eslint.config.mjs': "import standards from './.standards/next-ts/eslint.base.mjs'\n\nexport default standards()\n",
    'next.config.mjs': '/** @type {import(\'next\').NextConfig} */\nconst nextConfig = {}\n\nexport default nextConfig\n',
    'app/layout.tsx': "import type { ReactNode } from 'react'\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return (\n    <html lang=\"en\">\n      <body>{children}</body>\n    </html>\n  )\n}\n",
    'app/page.tsx': "export default function Page() {\n  return <main>ok</main>\n}\n",
  },
  prepare: (dir, h) => {
    const i = h.npm(['install', '--no-audit', '--no-fund', '--ignore-scripts']);
    h.step(i.code === 0, 'npm install (pinned tools + next/react)', i.out);
    return i.code === 0;
  },
  inject: (dir, h) => {
    const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const cases = [
      ['app/save.ts', FLOATING, (o) => /app[\\/]save\.ts[\s\S]*no-floating-promises/.test(o) && /FAIL \[next-ts\/eslint 10\.14\.0\]/.test(o), 'a floating promise fails eslint (type-aware) naming app/save.ts'],
      ['app/bad.ts', "export const n: number = 'not a number'\n", (o) => /app\/bad\.ts\(1,14\): error TS2322/.test(o) && /FAIL \[next-ts\/tsc 6\.0\.3\]/.test(o), 'a type error fails tsc naming app/bad.ts'],
      ['app/ugly.ts', 'export const  x = { a:1 }\n', (o) => /app\/ugly\.ts/.test(o) && /FAIL \[next-ts\/prettier 3\.10\.0\]/.test(o), 'an unformatted file fails prettier --check naming app/ugly.ts'],
      ['app/img.tsx', "export function Img() {\n  return <img src=\"/a.png\" />\n}\n", (o) => /app[\\/]img\.tsx[\s\S]*(no-img-element|alt-text)/.test(o), 'a bare <img> fails the Next/a11y rules naming app/img.tsx'],
      ['app/dis.ts', 'export const y = 1 // eslint-disable-line no-console\n', (o) => /app[\\/]dis\.ts[\s\S]*(Unused eslint-disable|require-description)/.test(o), 'an unused / reasonless eslint-disable fails naming app/dis.ts'],
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
    h.step(r.code === 1 && /FAIL \[next-ts\/pins\] package\.json: eslint is "\^10\.0\.0", the profile pins exactly "10\.14\.0"/.test(r.out), 'a drifted pin fails the pins step', r.out);
    fs.writeFileSync(pj, orig);
    const again = h.check();
    h.step(again.code === 0, 'check.mjs passes again after the injections are removed', again.out);
  },
};
