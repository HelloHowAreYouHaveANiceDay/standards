// next-ts + astro-ts 1.0.0: key properties of the released files (exact pins, gate order, no autofix in CI, no shell).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir } from './helpers.mjs';

const PROFILES = {
  'next-ts': { gate: ['pins', 'typegen', 'typecheck', 'eslint', 'prettier'], peers: ['next', 'react'] },
  'astro-ts': { gate: ['pins', 'astro-check', 'eslint', 'prettier'], peers: ['astro'] },
};

for (const [name, spec] of Object.entries(PROFILES)) {
  const dir = path.join(KIT_ROOT, 'profiles', name, '1.0.0');
  const sd = path.join(dir, '.standards', name);
  const cj = JSON.parse(fs.readFileSync(path.join(sd, 'check.json'), 'utf8'));
  const read = (f) => fs.readFileSync(path.join(sd, f), 'utf8');

  test(`${name}: every tool is pinned to an exact version; peers are the follower's framework packages`, () => {
    for (const [k, v] of Object.entries(cj.tools)) assert.match(v, /^\d+\.\d+\.\d+$/, k);
    assert.match(cj.tools.typescript, /^6\.0\./, 'typescript stays on 6.0.x until typescript-eslint supports TS 7');
    for (const k of ['eslint', 'typescript-eslint', 'prettier', 'eslint-config-prettier', '@eslint-community/eslint-plugin-eslint-comments']) assert.ok(cj.tools[k], k);
    assert.deepEqual(cj.peers, spec.peers);
    for (const p of cj.peers) assert.ok(!(p in cj.tools), `${p} is the follower's`);
  });

  test(`${name}: gate order ${spec.gate.join(' -> ')}, all via the zero-dep runner, no shell/npx, nothing autofixes`, () => {
    assert.deepEqual(cj.commands.map((c) => c.id), spec.gate);
    for (const c of cj.commands) {
      assert.deepEqual(c.run.slice(0, 2), ['node', `.standards/${name}/tool.mjs`]);
      assert.ok(!c.run.some((a) => /^--(fix|write|suppress|prune)/.test(a) || a === '--write'), c.id);
      assert.ok(['pins', 'typegen'].includes(c.id) || /\d+\.\d+\.\d+$/.test(c.tool), `${c.id} label carries the pin`);
    }
    const by = Object.fromEntries(cj.commands.map((c) => [c.id, c.run]));
    assert.ok(by.eslint.includes('--max-warnings') && by.eslint.includes('0'));
    assert.ok(by.prettier.includes('--check'));
    const src = read('tool.mjs');
    assert.ok(!/\bexecSync\b|shell:\s*true|npx/.test(src.replace(/\/\/.*$/gm, '')));
  });

  test(`${name}: eslint base = flat config, reasoned disables, unused disables fail, Prettier owns layout`, () => {
    const es = read('eslint.base.mjs');
    for (const s of ['recommendedTypeChecked', 'require-description', "reportUnusedDisableDirectives: 'error'", 'skipFormatting', "'ts-expect-error': 'allow-with-description'", "'ts-ignore': true"]) assert.ok(es.includes(s), s);
    assert.ok(!es.includes('eslint-plugin-prettier'));
    const ts = JSON.parse(read('tsconfig.base.json'));
    assert.equal(ts.compilerOptions.noUncheckedIndexedAccess, true);
    assert.ok(ts.compilerOptions.strict === true || ts.extends === 'astro/tsconfigs/strict');
  });

  test(`${name}: tool.mjs pin check names the npm fix; peers must be installed`, async () => {
    const tool = await import(pathToFileURL(path.join(sd, 'tool.mjs')).href);
    const d = tmpdir(`${name}-pins-`);
    const write = (o, inst = {}) => {
      fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(o));
      for (const [n, v] of Object.entries(inst)) {
        fs.mkdirSync(path.join(d, 'node_modules', ...n.split('/')), { recursive: true });
        fs.writeFileSync(path.join(d, 'node_modules', ...n.split('/'), 'package.json'), JSON.stringify({ name: n, version: v }));
      }
    };
    write({ devDependencies: { eslint: '^10.0.0' } }, { eslint: '10.14.0' });
    const p = tool.pinProblems(d, { eslint: '10.14.0' }, ['framework']);
    assert.ok(p.some((l) => /eslint is "\^10\.0\.0", the profile pins exactly "10\.14\.0".*npm i -D -E eslint@10\.14\.0/.test(l)), p.join('\n'));
    assert.ok(p.some((l) => /framework is not a dependency/.test(l)));
    assert.ok(p.some((l) => /node_modules\/framework: not installed/.test(l)));
    write({ devDependencies: { eslint: '10.14.0' }, dependencies: { framework: '^1' } }, { eslint: '10.14.0', framework: '1.2.3' });
    assert.deepEqual(tool.pinProblems(d, { eslint: '10.14.0' }, ['framework']), []);
  });
}

test('next-ts: Next 16 shape -- eslint-config-next core-web-vitals, typegen before tsc, no `next lint`', () => {
  const sd = path.join(KIT_ROOT, 'profiles/next-ts/1.0.0/.standards/next-ts');
  const cj = JSON.parse(fs.readFileSync(path.join(sd, 'check.json'), 'utf8'));
  assert.match(cj.tools['eslint-config-next'], /^16\./);
  assert.ok(fs.readFileSync(path.join(sd, 'eslint.base.mjs'), 'utf8').includes('eslint-config-next/core-web-vitals'));
  assert.deepEqual(cj.commands.find((c) => c.id === 'typegen').run.slice(3), ['next', 'typegen']);
  assert.ok(!JSON.stringify(cj.commands).includes('next lint'));
  assert.ok(JSON.parse(fs.readFileSync(path.join(sd, 'tsconfig.base.json'), 'utf8')).compilerOptions.plugins.some((p) => p.name === 'next'));
});

test('astro-ts: astro check + prettier-plugin-astro + jsx-a11y; tsconfig extends astro/tsconfigs/strict', () => {
  const dir = path.join(KIT_ROOT, 'profiles/astro-ts/1.0.0');
  const sd = path.join(dir, '.standards/astro-ts');
  const cj = JSON.parse(fs.readFileSync(path.join(sd, 'check.json'), 'utf8'));
  for (const k of ['@astrojs/check', 'eslint-plugin-astro', 'prettier-plugin-astro', 'eslint-plugin-jsx-a11y-x']) assert.ok(cj.tools[k], k);
  assert.deepEqual(cj.commands.find((c) => c.id === 'astro-check').run.slice(3), ['@astrojs/check:astro-check', '--minimumSeverity', 'hint']);
  const rc = JSON.parse(fs.readFileSync(path.join(dir, '.prettierrc.json'), 'utf8'));
  assert.deepEqual(rc.plugins, ['prettier-plugin-astro']);
  assert.equal(rc.overrides[0].options.parser, 'astro');
  assert.equal(JSON.parse(fs.readFileSync(path.join(sd, 'tsconfig.base.json'), 'utf8')).extends, 'astro/tsconfigs/strict');
  const es = fs.readFileSync(path.join(sd, 'eslint.base.mjs'), 'utf8');
  assert.ok(es.indexOf('standards/astro-typescript') < es.indexOf("astro.configs['flat/recommended']"), 'astro parser config comes after typescript-eslint');
});
