// ui-kit 1.1.1: every file the profile vendors is pure ASCII (followers run ASCII-only tests over the repo).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { KIT_ROOT } from './helpers.mjs';

const DIR = process.env.UI_KIT_SRC ? path.join(KIT_ROOT, 'src/profiles/ui-kit') : path.join(KIT_ROOT, 'profiles/ui-kit/1.1.2');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('ui-kit: every vendored file is pure ASCII', () => {
  const bad = [];
  for (const f of walk(DIR)) {
    const buf = fs.readFileSync(f);
    const i = buf.findIndex((b) => b > 0x7f);
    if (i >= 0) bad.push(`${path.relative(DIR, f)} byte ${i}`);
  }
  assert.deepEqual(bad, []);
});
