// rust-base: released files' key properties (pins exact, gate commands, no autofix in CI, levels as argv).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { KIT_ROOT } from './helpers.mjs';

const dir = path.join(KIT_ROOT, 'profiles', 'rust-base', '1.0.0');
const std = path.join(dir, '.standards', 'rust-base');
const frag = JSON.parse(fs.readFileSync(path.join(std, 'check.json'), 'utf8'));
const cmd = (id) => frag.commands.find((c) => c.id === id);

test('rust-base 1.0.0: exact toolchain pin, nothing floating', () => {
  assert.equal(frag.profile, 'rust-base');
  assert.equal(frag.version, '1.0.0');
  assert.deepEqual(frag.tools, { rust: '1.99.1' });
  for (const v of Object.values(frag.tools)) assert.match(v, /^\d+\.\d+\.\d+$/);
});

test('rust-base gate: rustfmt --check then clippy, both through the pinned-toolchain runner, no shell', () => {
  assert.deepEqual(frag.commands.map((c) => c.id), ['rustfmt', 'clippy']);
  for (const c of frag.commands) assert.deepEqual(c.run.slice(0, 3), ['node', '.standards/rust-base/tool.mjs', 'cargo']);
  const fmt = cmd('rustfmt').run;
  assert.ok(fmt.includes('--check') && fmt.includes('--all'));
  assert.equal(fmt[fmt.indexOf('--config-path') + 1], '.standards/rust-base/rustfmt.toml');
  const clippy = cmd('clippy').run;
  for (const a of ['clippy', '--locked', '--workspace', '--all-targets', '--all-features']) assert.ok(clippy.includes(a), a);
  const after = clippy.slice(clippy.indexOf('--') + 1).join(' ');
  assert.equal(after, '-D warnings -D clippy::allow_attributes -D clippy::allow_attributes_without_reason');
});

test('rust-base: CI never autofixes and never rewrites the follower (no --fix, no fmt without --check)', () => {
  const all = JSON.stringify(frag.commands);
  assert.doesNotMatch(all, /--fix|--allow-dirty|--allow-staged/);
  assert.ok(cmd('rustfmt').run.includes('--check'));
});

test('rust-base: tool.mjs is zero-dependency, shell-free, and pins via +<toolchain>', () => {
  const src = fs.readFileSync(path.join(std, 'tool.mjs'), 'utf8');
  assert.doesNotMatch(src, /shell:\s*true|from '(?!node:)/);
  assert.match(src, /\+\$\{name\}/);
  assert.match(src, /toolchain', 'install'/);
});

test('rust-base: rustfmt.toml uses stable options only; RULES.md documents the reasoned-expect policy', () => {
  const t = fs.readFileSync(path.join(std, 'rustfmt.toml'), 'utf8');
  assert.match(t, /^newline_style = "Unix"$/m);
  assert.doesNotMatch(t, /unstable_features|^(imports_granularity|group_imports|wrap_comments)/m);
  const r = fs.readFileSync(path.join(std, 'RULES.md'), 'utf8');
  assert.match(r, /allow_attributes_without_reason/);
  assert.match(r, /#\[expect\(lint, reason/);
});
