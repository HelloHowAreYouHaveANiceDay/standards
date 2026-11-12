// c-base: key properties of the released files (pins exact, wheels sha-pinned, gate command, no autofix in CI).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT } from './helpers.mjs';

const DIR = path.join(KIT_ROOT, 'profiles/c-base/1.0.0');
const cj = JSON.parse(fs.readFileSync(path.join(DIR, '.standards/c-base/check.json'), 'utf8'));
const tool = await import(pathToFileURL(path.join(DIR, '.standards/c-base/tool.mjs')).href);

test('c-base: clang-format pinned exactly, every platform wheel sha256-pinned from files.pythonhosted.org', () => {
  assert.deepEqual(Object.keys(cj.tools), ['clang-format']);
  assert.match(cj.tools['clang-format'], /^\d+\.\d+\.\d+$/);
  for (const k of ['win-x64', 'win-arm64', 'linux-x64', 'linux-arm64', 'linux-musl-x64', 'macos-x64', 'macos-arm64']) {
    const w = cj.wheels[k];
    assert.ok(w, k);
    assert.match(w.sha256, /^[0-9a-f]{64}$/, k);
    assert.ok(w.url.startsWith('https://files.pythonhosted.org/packages/'), k);
    assert.ok(w.url.endsWith(`/${w.file}`) && w.file.startsWith(`clang_format-${cj.tools['clang-format']}-`), k);
  }
});

test('c-base: one gate command via the zero-dep runner; never fixes', () => {
  assert.deepEqual(cj.commands.map((c) => c.run), [['node', '.standards/c-base/tool.mjs', 'format']]);
  const src = fs.readFileSync(path.join(DIR, '.standards/c-base/tool.mjs'), 'utf8');
  assert.ok(src.includes("'--dry-run', '--Werror', '--style=file'"));
  assert.ok(!/['"]-i['"]|--fix/.test(src.replace(/-i, or/g, '')), 'CI never rewrites files');
  assert.ok(!/\bexecSync\b|shell:\s*true/.test(src), 'no shell');
});

test('c-base: root .clang-format = Google + LF; RULES.md documents the ignore file', () => {
  const cf = fs.readFileSync(path.join(DIR, '.clang-format'), 'utf8');
  assert.match(cf, /^BasedOnStyle: Google$/m);
  assert.match(cf, /^LineEnding: LF$/m);
  assert.match(fs.readFileSync(path.join(DIR, '.standards/c-base/RULES.md'), 'utf8'), /\.clang-format-ignore/);
});

test('c-base tool: platform keys, clang-format-off markers, zip reader', () => {
  assert.equal(tool.platformKey('win32', 'x64'), 'win-x64');
  assert.equal(tool.platformKey('linux', 'x64', true), 'linux-x64');
  assert.equal(tool.platformKey('linux', 'arm64', false), 'linux-musl-arm64');
  assert.equal(tool.platformKey('darwin', 'arm64'), 'macos-arm64');
  assert.deepEqual(tool.markerProblems('// clang-format off: why\nx\n// clang-format on\n'), []);
  assert.deepEqual(tool.markerProblems('/* clang-format off: why */\nx\n/* clang-format on */\n'), []);
  assert.equal(tool.markerProblems('// clang-format off\nx\n// clang-format on\n').length, 1);
  assert.equal(tool.markerProblems('// clang-format off: why\nx\n').length, 1);
  const ign = tool.ignoreMatchers('# why\n\nthird_party/**\n./gen/*.c\n**/vendor/**\n*.pb.h\nvend/\n');
  const ignored = (f) => ign.some((re) => re.test(f));
  for (const f of ['third_party/a/b.c', 'gen/x.c', 'a/b/vendor/x.h', 'vendor/x.h', 'msg.pb.h']) assert.ok(ignored(f), f);
  for (const f of ['src/third_party/a.c', 'gen/sub/x.c', 'src/msg.pb.h', 'vend/x.c', 'src/main.c']) assert.ok(!ignored(f), f);
  assert.ok(tool.EXT.test('a.CPP') && tool.EXT.test('x.h') && !tool.EXT.test('x.rs') && !tool.EXT.test('x.hs'));
  // hand-built zip: one stored entry, one deflated entry
  const entries = [['a/stored.txt', Buffer.from('stored'), 0, Buffer.from('stored')], ['b/data/bin/clang-format', Buffer.from('BINARY'.repeat(50)), 8, zlib.deflateRawSync(Buffer.from('BINARY'.repeat(50)))]];
  const locals = []; const centrals = []; let off = 0;
  for (const [name, , method, comp] of entries) {
    const n = Buffer.from(name);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(method, 8); l.writeUInt32LE(comp.length, 18); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(method, 10); c.writeUInt32LE(comp.length, 20); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locals.push(l, n, comp); centrals.push(c, n); off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  const zip = Buffer.concat([...locals, cd, end]);
  assert.equal(tool.unzip(zip, (n) => n.endsWith('stored.txt')).data.toString(), 'stored');
  assert.equal(tool.unzip(zip, (n) => n.endsWith('data/bin/clang-format')).data.toString(), 'BINARY'.repeat(50));
  assert.equal(tool.unzip(zip, () => false), null);
});
