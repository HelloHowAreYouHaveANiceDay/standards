// react-ts 1.0.0: key properties of the released files (see ts-profile-suite.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { KIT_ROOT } from './helpers.mjs';
import { suite } from './ts-profile-suite.mjs';

await suite('react-ts', {
  extraPins: ['eslint-plugin-react-hooks', 'eslint-plugin-react-refresh'],
  tsconfigs: ['tsconfig.app.json', 'tsconfig.node.json'],
  forbidden: ['vue-eslint-parser'],
});

test('react-ts: react rules are create-vite\'s (hooks recommended + refresh vite preset); app config is DOM + react-jsx', () => {
  const sd = path.join(KIT_ROOT, 'profiles', 'react-ts', '1.0.0', '.standards', 'react-ts');
  const src = fs.readFileSync(path.join(sd, 'eslint.base.mjs'), 'utf8');
  assert.ok(src.includes('reactHooks.configs.flat.recommended') && src.includes('reactRefresh.configs.vite()'));
  const app = JSON.parse(fs.readFileSync(path.join(sd, 'tsconfig.app.json'), 'utf8')).compilerOptions;
  assert.equal(app.jsx, 'react-jsx');
  assert.ok(app.lib.includes('DOM'));
  const node = JSON.parse(fs.readFileSync(path.join(sd, 'tsconfig.node.json'), 'utf8')).compilerOptions;
  assert.ok(!node.lib.includes('DOM') && node.jsx === undefined);
});
