// rust-unsafe: released files' key properties (rubric pinned by hash, six lints present, dated nightly, no installers).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { KIT_ROOT, sha256 } from './helpers.mjs';

const dir = path.join(KIT_ROOT, 'profiles', 'rust-unsafe', '1.0.1');
const std = path.join(dir, '.standards', 'rust-unsafe');
const frag = JSON.parse(fs.readFileSync(path.join(std, 'check.json'), 'utf8'));
const src = fs.readFileSync(path.join(std, 'unsafe.mjs'), 'utf8');

test('rust-unsafe 1.0.1: one gate command, dated nightly pin', () => {
  assert.equal(frag.profile, 'rust-unsafe');
  assert.equal(frag.version, '1.0.1');
  assert.match(frag.tools.nightly, /^nightly-\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(frag.commands.map((c) => [c.id, c.run]), [['unsafe', ['node', '.standards/rust-unsafe/unsafe.mjs', 'check']]]);
});

test('rust-unsafe: vendored rubric is byte-identical to the pinned upstream commit', () => {
  const rubric = fs.readFileSync(path.join(std, 'unsafe_rust_review.md'));
  assert.equal(sha256(rubric), '27e8df5bc9bc6f43e11747e67e695bf8ee8c4f59d6412270784d72382a4d3026');
  assert.match(rubric.toString('utf8'), /\[rej\.miri-passes\]/);
  const lic = fs.readFileSync(path.join(std, 'LICENSE-unsafe_rust_review.md'), 'utf8');
  assert.match(lic, /Apache License/);
  const rules = fs.readFileSync(path.join(std, 'RULES.md'), 'utf8');
  assert.ok(rules.includes('34b87c594bf7386290a1e3698d5b8e06b6b9edd7') && rules.includes('27e8df5bc9bc6f43e11747e67e695bf8ee8c4f59d6412270784d72382a4d3026'));
});

test('rust-unsafe: the six D1 lints and -F unsafe_code (not -D) are in the checker', () => {
  for (const l of ['clippy::undocumented_unsafe_blocks', 'clippy::missing_safety_doc', 'unsafe_op_in_unsafe_fn',
    'clippy::multiple_unsafe_ops_per_block', 'clippy::unnecessary_safety_comment', 'clippy::unnecessary_safety_doc']) {
    assert.ok(src.includes(`'${l}'`), l);
  }
  assert.match(src, /'-F', 'unsafe_code'/);
  assert.doesNotMatch(src, /'-D', 'unsafe_code'/);
  assert.match(src, /'-A', 'warnings'/);
});

test('rust-unsafe: --no-deps precedes `--` in the shared clippy args (both run A and run B)', () => {
  assert.match(src, /'--no-deps', '--',/);
  assert.equal((src.match(/function clippyArgs/g) || []).length, 1);
  assert.equal((src.match(/clippyArgs\(pkgArgs/g) || []).length >= 2, true);
});

test('rust-unsafe: zero-dependency, shell-free, no toolchain installer for the stable pin (reuses rust-base)', () => {
  assert.doesNotMatch(src, /shell:\s*true|from '(?!node:)/);
  assert.match(src, /rust-base/);
  // The only installer call is the Miri nightly (miri + rust-src), never the stable pin.
  const installs = src.match(/'toolchain', 'install'/g) || [];
  assert.equal(installs.length, 1);
  assert.match(src, /'-c', 'miri', '-c', 'rust-src'/);
  assert.equal(fs.existsSync(path.join(std, 'tool.mjs')), false);
});
