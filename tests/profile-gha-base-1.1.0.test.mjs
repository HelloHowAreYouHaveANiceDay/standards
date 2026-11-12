// gha-base 1.1.0: the vendored zizmor pinning policy (spec--ci-standards S2) and when the runner passes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir } from './helpers.mjs';

const STD = path.join(KIT_ROOT, 'profiles/gha-base/1.1.0/.standards/gha-base');
const tool = await import(pathToFileURL(path.join(STD, 'tool.mjs')).href);

test('zizmor.yml: GitHub-owned owners ref-pin, everything else hash-pin; nothing else configured', () => {
  const y = fs.readFileSync(path.join(STD, 'zizmor.yml'), 'utf8');
  const body = y.split('\n').filter((l) => !l.startsWith('#')).join('\n');
  assert.equal(body.trim(), ['rules:', '  unpinned-uses:', '    config:', '      policies:', '        "actions/*": ref-pin', '        "github/*": ref-pin', '        "*": hash-pin'].join('\n'));
  assert.ok(!/artipacked|disable/.test(body), 'artipacked stays on');
});

test('tool versions and the gate commands are unchanged from 1.0.0', () => {
  const a = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'profiles/gha-base/1.0.0/.standards/gha-base/check.json'), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.join(STD, 'check.json'), 'utf8'));
  assert.equal(b.version, '1.1.0');
  assert.deepEqual(b.tools, a.tools);
  assert.deepEqual(b.commands, a.commands);
});

test('zizmorConfigArgs: vendored policy unless the follower owns a config', () => {
  const vendored = [`--config=${path.join(STD, 'zizmor.yml')}`];
  const root = tmpdir('gha-zcfg-');
  assert.deepEqual(tool.zizmorConfigArgs([], root, {}).map((a) => a.replace(/\\/g, '/')), vendored.map((a) => a.replace(/\\/g, '/')));
  assert.deepEqual(tool.zizmorConfigArgs(['--config=x.yml'], root, {}), []);
  assert.deepEqual(tool.zizmorConfigArgs(['--no-config'], root, {}), []);
  assert.deepEqual(tool.zizmorConfigArgs([], root, { ZIZMOR_CONFIG: 'x.yml' }), []);
  for (const f of ['.github/zizmor.yml', '.github/zizmor.yaml', 'zizmor.yml', 'zizmor.yaml']) {
    const r = tmpdir('gha-zcfg-');
    fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true });
    fs.writeFileSync(path.join(r, f), 'rules: {}\n');
    assert.deepEqual(tool.zizmorConfigArgs([], r, {}), [], f);
  }
});
