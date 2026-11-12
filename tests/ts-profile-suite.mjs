// Shared assertions for the npm-tool TypeScript profiles (ts-base, react-ts): key properties of the released files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir } from './helpers.mjs';

export async function suite(name, { extraPins, tsconfigs, forbidden }) {
  const SD = path.join(KIT_ROOT, 'profiles', name, '1.0.0', '.standards', name);
  const cj = JSON.parse(fs.readFileSync(path.join(SD, 'check.json'), 'utf8'));
  const tool = await import(pathToFileURL(path.join(SD, 'tool.mjs')).href);
  const eslintSrc = fs.readFileSync(path.join(SD, 'eslint.base.mjs'), 'utf8');

  test(`${name}: every tool is pinned exactly (no ranges), with the expected set`, () => {
    for (const [n, v] of Object.entries(cj.tools)) assert.match(v, /^\d+\.\d+\.\d+$/, n);
    const base = ['eslint', 'typescript', 'typescript-eslint', '@eslint/js', 'eslint-config-prettier', '@eslint-community/eslint-plugin-eslint-comments', 'prettier'];
    assert.deepEqual(Object.keys(cj.tools).sort(), [...base, ...extraPins].sort());
    assert.match(cj.tools.typescript, /^6\./, 'TS 6 until typescript-eslint supports TS 7');
  });

  test(`${name}: gate = pins, tsc --build, eslint --max-warnings 0, prettier --check; no shell, no npx, no autofix`, () => {
    assert.deepEqual(cj.commands.map((c) => c.id), ['pins', 'typecheck', 'eslint', 'prettier']);
    for (const c of cj.commands) {
      assert.equal(c.run[0], 'node');
      assert.equal(c.run[1], `.standards/${name}/tool.mjs`);
      for (const bad of ['--fix', '--write', '-w', '--fix-type', '--fix-dry-run']) assert.ok(!c.run.includes(bad), `${c.id}: ${bad}`);
    }
    const by = Object.fromEntries(cj.commands.map((c) => [c.id, c.run]));
    assert.ok(by.typecheck.includes('typescript:tsc') && by.typecheck.includes('--build'));
    assert.ok(by.eslint.includes('--max-warnings') && by.eslint[by.eslint.indexOf('--max-warnings') + 1] === '0');
    assert.ok(by.prettier.includes('--check'));
    assert.ok(by.prettier.includes('!.standards/**'));
    assert.ok(cj.commands.slice(1).every((c) => c.tool.includes(cj.tools[c.tool.split(' ')[0] === 'tsc' ? 'typescript' : c.tool.split(' ')[0]])), 'tool labels carry the pin');
  });

  test(`${name}: eslint config: type-aware, unused/reasonless suppressions error, @ts-ignore banned`, () => {
    for (const s of ['recommendedTypeChecked', 'projectService: true', "reportUnusedDisableDirectives: 'error'", "reportUnusedInlineConfigs: 'error'", 'require-description', 'ban-ts-comment', 'skipFormatting']) {
      assert.ok(eslintSrc.includes(s), s);
    }
    for (const s of forbidden) assert.ok(!eslintSrc.includes(s), `must not contain ${s}`);
    assert.ok(!/fixable|--fix/.test(eslintSrc));
  });

  test(`${name}: vendored tsconfigs are strict and leave follower-owned keys to the follower`, () => {
    for (const f of tsconfigs) {
      const t = JSON.parse(fs.readFileSync(path.join(SD, f), 'utf8')).compilerOptions;
      for (const k of ['strict', 'verbatimModuleSyntax', 'noUncheckedIndexedAccess', 'noUnusedLocals', 'noEmit']) assert.equal(t[k], true, `${f}: ${k}`);
      assert.equal(t.types, undefined, `${f}: types is follower-owned`);
      assert.equal(t.tsBuildInfoFile, undefined, `${f}: tsBuildInfoFile is follower-owned`);
    }
  });

  test(`${name}: pinned prettier config ships at the repo root (byte-identical across TS profiles)`, () => {
    const p = path.join(KIT_ROOT, 'profiles', name, '1.0.0', '.prettierrc.json');
    assert.ok(fs.existsSync(p));
    const other = ['ts-base', 'react-ts', 'vue-ts'].filter((n) => n !== name).map((n) => path.join(KIT_ROOT, 'profiles', n, '1.0.0', '.prettierrc.json')).filter(fs.existsSync);
    for (const o of other) assert.deepEqual(fs.readFileSync(o), fs.readFileSync(p), o);
  });

  test(`${name}: pins step reports spec drift, missing and mismatched installs`, () => {
    const d = tmpdir('tsp-');
    const dev = { ...cj.tools };
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ devDependencies: dev }));
    let p = tool.pinProblems(d, cj.tools);
    assert.equal(p.length, Object.keys(cj.tools).length, 'all not installed');
    assert.match(p[0], /not installed \(fix: npm ci\)/);
    dev.eslint = '^10.0.0';
    delete dev.prettier;
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ devDependencies: dev }));
    p = tool.pinProblems(d, cj.tools);
    assert.ok(p.some((l) => /eslint is "\^10\.0\.0", the profile pins exactly "10\.14\.0"/.test(l)));
    assert.ok(p.some((l) => /prettier is not a devDependency/.test(l)));
    fs.mkdirSync(path.join(d, 'node_modules', 'prettier'), { recursive: true });
    fs.writeFileSync(path.join(d, 'node_modules', 'prettier', 'package.json'), JSON.stringify({ version: '3.0.0' }));
    assert.ok(tool.pinProblems(d, cj.tools).some((l) => /installed 3\.0\.0 != pin 3\.10\.0/.test(l)));
    fs.writeFileSync(path.join(d, 'package.json'), 'nope');
    assert.deepEqual(tool.pinProblems(d, cj.tools), ['package.json: unreadable']);
  });
}
