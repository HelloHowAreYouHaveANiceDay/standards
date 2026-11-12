// Fixture: ts-base (plain TypeScript: Node CLI/library). Real pinned npm tools; each defect must fail naming its file.
import fs from 'node:fs';
import path from 'node:path';
import { KIT_ROOT } from '../helpers.mjs';

const PINS = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'profiles/ts-base/1.0.0/.standards/ts-base/check.json'), 'utf8')).tools;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const files = {
  '.gitignore': 'node_modules/\n',
  'package.json': `${JSON.stringify({ name: 'fixture', private: true, type: 'module', devDependencies: { ...PINS, '@tsconfig/node24': '24.0.6', '@types/node': '24.10.1' } }, null, 2)}\n`,
  'tsconfig.json': '{\n  "extends": ["@tsconfig/node24/tsconfig.json", "./.standards/ts-base/tsconfig.json"],\n  "compilerOptions": { "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.tsbuildinfo" },\n  "include": ["src"]\n}\n',
  'eslint.config.mjs': "import standards from './.standards/ts-base/eslint.base.mjs'\n\nexport default standards()\n",
  'src/lib.ts': "export function first(xs: string[]): string {\n  return xs[0] ?? ''\n}\n\nexport async function load(name: string): Promise<string> {\n  return Promise.resolve(name)\n}\n",
  'src/main.ts': "import process from 'node:process'\nimport { first, load } from './lib.js'\n\nprocess.stdout.write(`${first(process.argv.slice(2))} ${await load('ok')}\\n`)\n",
};

export const fixture = {
  id: 'ts-base',
  profiles: ['base@1.0.0', 'ts-base@1.0.0'],
  files,
  prepare: (dir, h) => {
    const i = h.npm(['install', '--no-audit', '--no-fund', '--ignore-scripts']);
    h.step(i.code === 0, 'npm install (pinned tools)', i.out);
    return i.code === 0;
  },
  inject: (dir, h) => {
    const cases = [
      ['src/save.ts', "export async function save(): Promise<void> {}\n\nexport function go(): void {\n  save()\n}\n",
        (o) => /src[\\/]save\.ts[\s\S]*no-floating-promises/.test(o) && /FAIL \[ts-base\/eslint 10\.14\.0\]/.test(o), 'a floating promise fails eslint (type-aware) naming src/save.ts'],
      ['src/bad.ts', "export const n: number = 'not a number'\n",
        (o) => /src\/bad\.ts\(1,14\): error TS2322/.test(o) && /FAIL \[ts-base\/tsc 6\.0\.3\]/.test(o), 'a type error fails tsc --build naming src/bad.ts'],
      ['src/ugly.ts', 'export const  x = { a:1 }\n',
        (o) => /src\/ugly\.ts/.test(strip(o)) && /FAIL \[ts-base\/prettier 3\.10\.0\]/.test(o), 'an unformatted file fails prettier --check naming src/ugly.ts'],
      ['src/dis.ts', 'export const y = 1 // eslint-disable-line no-console\n',
        (o) => /src[\\/]dis\.ts[\s\S]*(Unused eslint-disable|require-description)/.test(o), 'an unused / reasonless eslint-disable fails'],
      ['src/ignore.ts', "// @ts-ignore\nexport const z: number = 'x'\n",
        (o) => /src[\\/]ignore\.ts[\s\S]*ban-ts-comment/.test(o), 'a @ts-ignore fails ban-ts-comment'],
    ];
    for (const [rel, body, ok, msg] of cases) {
      fs.writeFileSync(path.join(dir, rel), body);
      const r = h.check();
      h.step(r.code === 1 && ok(r.out), msg, `exit ${r.code}\n${r.out}`);
      fs.rmSync(path.join(dir, rel));
    }
    const pj = path.join(dir, 'package.json');
    const orig = fs.readFileSync(pj);
    const p = JSON.parse(orig);
    p.devDependencies.eslint = '^10.0.0';
    fs.writeFileSync(pj, `${JSON.stringify(p, null, 2)}\n`);
    const r = h.check();
    h.step(r.code === 1 && /FAIL \[ts-base\/pins\] package\.json: eslint is "\^10\.0\.0", the profile pins exactly "10\.14\.0"/.test(r.out), 'a drifted pin fails the pins step', r.out);
    fs.writeFileSync(pj, orig);
    const again = h.check();
    h.step(again.code === 0, 'check.mjs passes again after the injections are removed', again.out);
  },
};
