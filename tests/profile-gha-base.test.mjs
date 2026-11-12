// gha-base 1.0.0: key properties of the released files + the zero-dependency tool runner (archives, sha gate, reasons).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, sha256, tmpdir } from './helpers.mjs';

const DIR = path.join(KIT_ROOT, 'profiles/gha-base/1.0.0');
const STD = path.join(DIR, '.standards/gha-base');
const cj = JSON.parse(fs.readFileSync(path.join(STD, 'check.json'), 'utf8'));
const tool = await import(pathToFileURL(path.join(STD, 'tool.mjs')).href);

test('pins: exact versions, https GitHub release URLs naming the version, sha256 per platform, no floating', () => {
  assert.deepEqual(Object.keys(cj.tools).sort(), ['actionlint', 'shellcheck', 'zizmor']);
  const want = { actionlint: '1.7.12', shellcheck: '0.11.0', zizmor: '1.32.0' };
  for (const [name, t] of Object.entries(cj.tools)) {
    assert.equal(t.version, want[name]);
    assert.match(t.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(Object.keys(t.assets).sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']);
    for (const [plat, a] of Object.entries(t.assets)) {
      assert.match(a.url, new RegExp(`^https://github\\.com/[\\w.-]+/[\\w.-]+/releases/download/v${t.version.replace(/\./g, '\\.')}/`), `${name} ${plat} url`);
      assert.doesNotMatch(a.url, /latest/);
      assert.match(a.sha256, /^[0-9a-f]{64}$/, `${name} ${plat} sha256`);
      assert.equal(a.member.endsWith('.exe'), plat.startsWith('win32'), `${name} ${plat} member`);
    }
  }
});

test('gate: reasons -> actionlint (with the pinned shellcheck) -> zizmor offline; nothing auto-fixes or needs a token', () => {
  assert.deepEqual(cj.commands.map((c) => c.id), ['reasons', 'actionlint', 'zizmor']);
  for (const c of cj.commands) assert.deepEqual(c.run.slice(0, 2), ['node', '.standards/gha-base/tool.mjs']);
  const al = cj.commands[1].run;
  assert.ok(al.includes('-shellcheck={shellcheck}'), 'shellcheck is the pinned binary, not whatever is on PATH');
  assert.ok(al.includes('-pyflakes='), 'pyflakes is off, so results do not depend on the runner');
  assert.ok(al.includes('-oneline'));
  const zi = cj.commands[2].run;
  for (const f of ['--offline', '--persona=regular', '--min-severity=low', '--strict-collection']) assert.ok(zi.includes(f), f);
  for (const c of cj.commands) assert.ok(!c.run.some((a) => /^--?fix/.test(a)), `${c.id} must not autofix in CI`);
  assert.ok(!/GH_TOKEN|GITHUB_TOKEN/.test(fs.readFileSync(path.join(STD, 'tool.mjs'), 'utf8')), 'the runner never reads a token');
});

test('RULES.md documents the overlay files and the reason format', () => {
  const rules = fs.readFileSync(path.join(STD, 'RULES.md'), 'utf8');
  for (const s of ['.github/actionlint.yaml', '.github/zizmor.yml', '# zizmor: ignore[rule]', '# shellcheck disable=SC']) assert.ok(rules.includes(s), s);
});

// --- runner internals, with synthesized archives (no network) ---
const tarEntry = (name, body) => {
  const h = Buffer.alloc(512);
  h.write(name, 0, 'utf8'); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124); h.write('00000000000\0', 136);
  h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return Buffer.concat([h, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
};
const tarGz = (entries) => zlib.gzipSync(Buffer.concat([...entries.map(([n, b]) => tarEntry(n, b)), Buffer.alloc(1024)]));
const zip = (entries) => {
  const locals = []; const central = []; let off = 0;
  for (const [name, body, method] of entries) {
    const data = method === 8 ? zlib.deflateRawSync(body) : body;
    const nb = Buffer.from(name);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(method, 8); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(body.length, 22); l.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(method, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(body.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    locals.push(l, nb, data); central.push(c, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
};

test('tar.gz and zip readers pick the member by basename, wrapped or not, stored or deflated', () => {
  const body = Buffer.from('#!bin\n'.repeat(500));
  assert.deepEqual(tool.tarGzMember(tarGz([['pkg-1/README', Buffer.from('x')], ['pkg-1/shellcheck', body]]), 'shellcheck'), body);
  assert.deepEqual(tool.tarGzMember(tarGz([['zizmor', body]]), 'zizmor'), body);
  assert.throws(() => tool.tarGzMember(tarGz([['a', body]]), 'zizmor'), /not found/);
  assert.deepEqual(tool.zipMember(zip([['LICENSE.txt', Buffer.from('l'), 0], ['actionlint.exe', body, 8]]), 'actionlint.exe'), body);
  assert.deepEqual(tool.zipMember(zip([['docs/x', Buffer.from('l'), 0], ['zizmor.exe', body, 0]]), 'zizmor.exe'), body);
  assert.throws(() => tool.zipMember(zip([['a', body, 0]]), 'zizmor.exe'), /not found/);
});

test('ensureTool: refuses a download whose sha256 differs from the pin; installs and caches when it matches', async () => {
  const exe = process.platform === 'win32' ? 'fake.exe' : 'fake';
  const archive = process.platform === 'win32' ? zip([[exe, Buffer.from('MZ-fake'), 8]]) : tarGz([['fake-1.0/fake', Buffer.from('ELF-fake')]]);
  let hits = 0;
  const srv = http.createServer((req, res) => { hits++; res.end(archive); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/fake${process.platform === 'win32' ? '.zip' : '.tar.gz'}`;
  const key = `${process.platform}-${process.arch}`;
  const pins = (sha) => ({ fake: { version: '1.0.0', assets: { [key]: { url, sha256: sha, member: exe } } } });
  const cache = tmpdir('gha-cache-');
  try {
    await assert.rejects(tool.ensureTool('fake', pins('0'.repeat(64)), cache), /sha256 .* != pinned .*refusing to install/);
    assert.ok(!fs.existsSync(path.join(cache, 'gha-tools')), 'nothing is cached after a mismatch');
    const bin = await tool.ensureTool('fake', pins(sha256(archive)), cache);
    assert.ok(fs.existsSync(bin));
    const before = hits;
    assert.equal(await tool.ensureTool('fake', pins(sha256(archive)), cache), bin);
    assert.equal(hits, before, 'second call is served from the cache');
    await assert.rejects(tool.ensureTool('nope', pins('0'), cache), /not a pinned tool/);
  } finally {
    srv.close();
  }
});

test('reasons: a zizmor ignore or shellcheck disable without a reason is reported with file:line', () => {
  const root = tmpdir('gha-reasons-');
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github/workflows/a.yml'), [
    'jobs:',
    '  x:',
    '    steps:',
    '      - uses: a/b@v1 # zizmor: ignore[unpinned-uses]',
    '      - uses: a/c@v1 # zizmor: ignore[unpinned-uses] vendor tag is signed',
    '      - run: |',
    '          # shellcheck disable=SC2086',
    '          echo $X',
    '          # shellcheck disable=SC2086 # word splitting wanted: flags list',
    '          echo $Y',
    '',
  ].join('\n'));
  assert.deepEqual(tool.suppressionsWithoutReason(root), [
    '.github/workflows/a.yml:4: zizmor ignore without a reason (write "# zizmor: ignore[rule] why")',
    '.github/workflows/a.yml:7: shellcheck disable without a reason (write "# shellcheck disable=SCnnnn # why")',
  ]);
  assert.deepEqual(tool.suppressionsWithoutReason(tmpdir('gha-empty-')), []);
});
