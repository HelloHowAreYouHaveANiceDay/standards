// Fixture: react-ts (React + Vite + TypeScript, solution-style tsconfig). Real pinned npm tools; each defect must fail naming its file.
import fs from 'node:fs';
import path from 'node:path';
import { KIT_ROOT } from '../helpers.mjs';

const PINS = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'profiles/react-ts/1.0.0/.standards/react-ts/check.json'), 'utf8')).tools;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const files = {
  '.gitignore': 'node_modules/\n',
  'package.json': `${JSON.stringify({ name: 'fixture', private: true, type: 'module', dependencies: { react: '19.2.0', 'react-dom': '19.2.0' }, devDependencies: { ...PINS, '@types/react': '19.2.2', '@types/react-dom': '19.2.2' } }, null, 2)}\n`,
  'tsconfig.json': '{\n  "files": [],\n  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]\n}\n',
  'tsconfig.app.json': '{\n  "extends": "./.standards/react-ts/tsconfig.app.json",\n  "compilerOptions": {\n    "types": [],\n    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo"\n  },\n  "include": ["src"]\n}\n',
  'tsconfig.node.json': '{\n  "extends": "./.standards/react-ts/tsconfig.node.json",\n  "compilerOptions": {\n    "types": [],\n    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo"\n  },\n  "include": ["vite.config.ts"]\n}\n',
  'eslint.config.mjs': "import standards from './.standards/react-ts/eslint.base.mjs'\n\nexport default standards()\n",
  'vite.config.ts': 'export default { plugins: [] }\n',
  'src/Counter.tsx': "import { useState } from 'react'\n\nexport function Counter({ label }: { label: string }) {\n  const [n, setN] = useState(0)\n  return (\n    <button onClick={() => setN(n + 1)}>\n      {label} {n}\n    </button>\n  )\n}\n",
  'src/main.tsx': "import { createRoot } from 'react-dom/client'\nimport { Counter } from './Counter.tsx'\n\nconst el = document.getElementById('root')\nif (el) createRoot(el).render(<Counter label=\"clicks\" />)\n",
};

export const fixture = {
  id: 'react-ts',
  profiles: ['base@1.0.0', 'react-ts@1.0.0'],
  files,
  prepare: (dir, h) => {
    const i = h.npm(['install', '--no-audit', '--no-fund', '--ignore-scripts']);
    h.step(i.code === 0, 'npm install (pinned tools)', i.out);
    return i.code === 0;
  },
  inject: (dir, h) => {
    const cases = [
      ['src/Save.tsx', "export async function save(): Promise<void> {}\n\nexport function go(): void {\n  save()\n}\n",
        (o) => /src[\\/]Save\.tsx[\s\S]*no-floating-promises/.test(o) && /FAIL \[react-ts\/eslint 10\.14\.0\]/.test(o), 'a floating promise fails eslint (type-aware) naming src/Save.tsx'],
      ['src/Cond.tsx', "import { useState } from 'react'\n\nexport function Cond({ on }: { on: boolean }) {\n  if (!on) return null\n  const [n] = useState(0)\n  return <p>{n}</p>\n}\n",
        (o) => /src[\\/]Cond\.tsx[\s\S]*rules-of-hooks/.test(o), 'a conditional hook fails react-hooks/rules-of-hooks naming src/Cond.tsx'],
      ['src/Mixed.tsx', "export function helper() {\n  return 3\n}\n\nexport function Mixed() {\n  return <p>{helper()}</p>\n}\n",
        (o) => /src[\\/]Mixed\.tsx[\s\S]*only-export-components/.test(o), 'a component file exporting a function fails react-refresh (warnings are errors)'],
      ['src/bad.ts', "export const n: number = 'not a number'\n",
        (o) => /src\/bad\.ts\(1,14\): error TS2322/.test(o) && /FAIL \[react-ts\/tsc 6\.0\.3\]/.test(o), 'a type error fails tsc --build naming src/bad.ts'],
      ['src/ugly.ts', 'export const  x = { a:1 }\n',
        (o) => /src[\\/]ugly\.ts/.test(strip(o)) && /FAIL \[react-ts\/prettier 3\.10\.0\]/.test(o), 'an unformatted file fails prettier --check naming src/ugly.ts'],
      ['src/dis.ts', 'export const y = 1 // eslint-disable-line no-console\n',
        (o) => /src[\\/]dis\.ts[\s\S]*(Unused eslint-disable|require-description)/.test(o), 'an unused / reasonless eslint-disable fails'],
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
    p.devDependencies['eslint-plugin-react-hooks'] = '^7.1.1';
    fs.writeFileSync(pj, `${JSON.stringify(p, null, 2)}\n`);
    const r = h.check();
    h.step(r.code === 1 && /FAIL \[react-ts\/pins\] package\.json: eslint-plugin-react-hooks is "\^7\.1\.1", the profile pins exactly "7\.1\.1"/.test(r.out), 'a drifted pin fails the pins step', r.out);
    fs.writeFileSync(pj, orig);
    const again = h.check();
    h.step(again.code === 0, 'check.mjs passes again after the injections are removed', again.out);
  },
};
