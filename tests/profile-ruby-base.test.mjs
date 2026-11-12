// ruby-base 1.0.0: key properties of the released files (pins exact, gate commands, no autofix in CI, policy step).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir } from './helpers.mjs';

const DIR = path.join(KIT_ROOT, 'profiles', 'ruby-base', '1.0.0');
const SD = path.join(DIR, '.standards', 'ruby-base');
const cj = JSON.parse(fs.readFileSync(path.join(SD, 'check.json'), 'utf8'));
const tool = await import(pathToFileURL(path.join(SD, 'tool.mjs')).href);

test('every gem is pinned exactly, including the dependency closure; rubocop + rubocop-sketchup are present', () => {
  assert.equal(cj.version, '1.0.0');
  assert.equal(cj.tools.rubocop, '1.92.2');
  assert.equal(cj.tools['rubocop-sketchup'], '2.2.0');
  for (const [name, v] of Object.entries(cj.tools)) assert.match(v, /^\d+(\.\d+){2,3}$/, name);
});

test('gate: policy then rubocop; no shell, no bundler; nothing autocorrects in CI', () => {
  assert.deepEqual(cj.commands.map((c) => c.id), ['policy', 'rubocop']);
  for (const c of cj.commands) {
    assert.equal(c.run[0], 'node');
    assert.equal(c.run[1], '.standards/ruby-base/tool.mjs');
    for (const bad of ['-a', '-A', '--autocorrect', '--autocorrect-all', '--auto-gen-config']) assert.ok(!c.run.includes(bad), `${c.id} ${bad}`);
  }
  const rc = cj.commands.find((c) => c.id === 'rubocop');
  assert.ok(rc.tool.includes(cj.tools.rubocop), 'tool label carries the pin');
  assert.ok(rc.run.includes('--force-exclusion'));
});

test('rubocop.yml: sketchup plugin, Ruby 3.2 target, lf, unused disables fail, no UseGitignore', () => {
  const y = fs.readFileSync(path.join(SD, 'rubocop.yml'), 'utf8');
  assert.match(y, /^plugins:\s*\n\s*- rubocop-sketchup/m);
  assert.match(y, /TargetRubyVersion: 3\.2/);
  assert.match(y, /Layout\/EndOfLine:\s*\n\s*EnforcedStyle: lf/);
  assert.match(y, /Lint\/RedundantCopDisableDirective:\s*\n\s*Enabled: true/);
  assert.ok(!/UseGitignore/.test(y), 'UseGitignore is not an AllCops parameter');
  assert.ok(fs.existsSync(path.join(SD, 'RULES.md')));
});

test('policy: follower config must inherit; disable needs a reason; todo refused', () => {
  const d = tmpdir('rb-pol-');
  fs.writeFileSync(path.join(d, 'a.rb'), 'x = 1 # rubocop:disable Lint/UselessAssignment -- why\ny = 2 # rubocop:disable Lint/UselessAssignment\nz = 3 # rubocop:todo Foo/Bar\n');
  assert.match(tool.policyProblems(d, ['a.rb'])[0], /^\.rubocop\.yml: missing/);
  fs.writeFileSync(path.join(d, '.rubocop.yml'), '# inherit_from: .standards/ruby-base/rubocop.yml\n');
  assert.match(tool.policyProblems(d, [])[0], /does not inherit/, 'a commented-out inherit_from does not count');
  fs.writeFileSync(path.join(d, '.rubocop.yml'), 'inherit_from: .standards/ruby-base/rubocop.yml\n');
  const p = tool.policyProblems(d, ['a.rb']);
  assert.equal(p.length, 2);
  assert.match(p[0], /^a\.rb:2: rubocop:disable needs a reason/);
  assert.match(p[1], /^a\.rb:3: rubocop:todo is not allowed/);
  fs.writeFileSync(path.join(d, '.rubocop_todo.yml'), '');
  assert.match(tool.policyProblems(d, [])[0], /^\.rubocop_todo\.yml: not allowed/);
});

test('installedProblems: reports missing pins, accepts platform-suffixed gemspecs', () => {
  const home = tmpdir('rb-gems-');
  fs.mkdirSync(path.join(home, 'specifications'));
  fs.writeFileSync(path.join(home, 'specifications', 'prism-2.1.0-x64-mingw-ucrt.gemspec'), '');
  fs.writeFileSync(path.join(home, 'specifications', 'rubocop-1.92.2.gemspec'), '');
  assert.deepEqual(tool.installedProblems(home, { prism: '2.1.0', rubocop: '1.92.2' }), []);
  assert.equal(tool.installedProblems(home, { rubocop: '1.92.3' }).length, 1);
  assert.equal(tool.installedProblems(home, { 'rubocop-ast': '1.51.0' }).length, 1, 'rubocop-ast is not rubocop');
});
