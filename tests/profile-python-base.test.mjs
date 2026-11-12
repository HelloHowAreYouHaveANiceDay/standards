// python-base 1.0.0: key properties of the released files (pins exact, gate commands, no autofix in CI, archive readers).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir } from './helpers.mjs';

const DIR = path.join(KIT_ROOT, 'profiles', 'python-base', '1.0.0');
const SD = path.join(DIR, '.standards', 'python-base');
const cj = JSON.parse(fs.readFileSync(path.join(SD, 'check.json'), 'utf8'));
const tool = await import(pathToFileURL(path.join(SD, 'tool.mjs')).href);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('ruff is pinned exactly; every platform archive has a sha256 and a versioned release file name', () => {
  assert.match(cj.tools.ruff, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(cj.tools), ['ruff']);
  const triples = ['x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu', 'x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc', 'x86_64-apple-darwin', 'aarch64-apple-darwin'];
  assert.deepEqual(Object.keys(cj.archives).sort(), triples.sort());
  for (const [t, a] of Object.entries(cj.archives)) {
    assert.match(a.sha256, /^[0-9a-f]{64}$/, t);
    assert.equal(a.file, `ruff-${t}.${t.includes('windows') ? 'zip' : 'tar.gz'}`);
  }
});

test('gate: config, ruff check --no-fix, ruff format --check; nothing autofixes; no shell, no npx/uvx/pip', () => {
  assert.deepEqual(cj.commands.map((c) => c.id), ['config', 'ruff-check', 'ruff-format']);
  for (const c of cj.commands) {
    assert.equal(c.run[0], 'node');
    assert.equal(c.run[1], '.standards/python-base/tool.mjs');
    assert.ok(!c.run.includes('--fix') && !c.run.includes('--unsafe-fixes') && !c.run.includes('--add-noqa'), c.id);
  }
  const byId = Object.fromEntries(cj.commands.map((c) => [c.id, c.run]));
  assert.ok(byId['ruff-check'].includes('--no-fix') && byId['ruff-check'].includes('check'));
  assert.ok(byId['ruff-format'].includes('--check') && byId['ruff-format'].includes('format'));
  assert.ok(cj.commands.every((c) => c.tool === 'config' || c.tool.includes(cj.tools.ruff)), 'tool labels carry the pin');
});

test('ruff.toml: Ruff defaults plus B I UP, blanket + unused noqa; no per-file-ignores (globs would resolve inside .standards/)', () => {
  const t = fs.readFileSync(path.join(SD, 'ruff.toml'), 'utf8');
  for (const code of ['"E4"', '"E7"', '"E9"', '"F"', '"B"', '"I"', '"UP"', '"PGH004"', '"RUF100"']) assert.ok(t.includes(code), code);
  assert.ok(!/per-file-ignores/.test(t.replace(/#.*$/gm, '')));
  assert.ok(!/^\s*fix\s*=\s*true/m.test(t));
});

test('config step: the follower config must extend the vendored one (ruff.toml, .ruff.toml, pyproject [tool.ruff])', () => {
  const ext = 'extend = ".standards/python-base/ruff.toml"\n';
  const probe = (files) => {
    const d = tmpdir('pb-cfg-');
    for (const [f, b] of Object.entries(files)) fs.writeFileSync(path.join(d, f), b);
    return tool.configProblems(d);
  };
  assert.deepEqual(probe({ 'ruff.toml': `# why\n${ext}\n[lint]\nignore = ["B008"]\n` }), []);
  assert.deepEqual(probe({ '.ruff.toml': ext }), []);
  assert.deepEqual(probe({ 'pyproject.toml': `[project]\nname = "x"\n\n[tool.ruff]\n${ext}line-length = 100\n` }), []);
  assert.match(probe({})[0], /no Ruff config at the repo root/);
  assert.match(probe({ 'ruff.toml': '[lint]\nselect = ["F"]\n' })[0], /ruff\.toml: does not set extend/);
  assert.match(probe({ 'ruff.toml': `[lint]\n${ext}` })[0], /ruff\.toml: does not set extend/, 'extend inside [lint] is not the top-level key');
  assert.match(probe({ 'pyproject.toml': '[tool.ruff]\nline-length = 100\n' })[0], /pyproject\.toml: \[tool\.ruff\] does not set extend/);
  assert.match(probe({ 'pyproject.toml': '[project]\nname = "x"\n' })[0], /no Ruff config/, 'pyproject without [tool.ruff] is no config');
  assert.match(probe({ 'ruff.toml': 'extend = "other.toml"\n' })[0], /does not set extend/);
});

test('archive readers: pinned linux tar.gz and windows zip downloaded from GitHub match their sha256 and unpack to a ruff binary', async (t) => {
  const cache = tmpdir('pb-cache-');
  const old = process.env.STANDARDS_CACHE;
  process.env.STANDARDS_CACHE = cache;
  try {
    for (const triple of ['x86_64-unknown-linux-gnu', 'x86_64-pc-windows-msvc']) {
      const r = await tool.ensureRuff(cj, triple);
      if (r.error && /download of .* failed/.test(r.error)) { t.skip(`offline: ${r.error}`); return; }
      assert.ok(r.bin, `${triple}: ${r.error}`);
      const bin = fs.readFileSync(r.bin);
      assert.ok(bin.length > 5_000_000, `${triple}: binary size ${bin.length}`);
      assert.equal(bin.subarray(0, 4).toString('hex') === '7f454c46' || bin.subarray(0, 2).toString() === 'MZ', true, `${triple}: ELF or PE header`);
      assert.equal(fs.readFileSync(path.join(path.dirname(r.bin), 'binary.sha256'), 'utf8').trim(), sha(bin));
    }
    const bad = structuredClone(cj);
    bad.archives['x86_64-unknown-linux-gnu'].sha256 = '0'.repeat(64);
    fs.rmSync(path.join(cache, 'ruff'), { recursive: true });
    const r = await tool.ensureRuff(bad, 'x86_64-unknown-linux-gnu');
    assert.match(r.error ?? '', /sha256 .* != pinned 0{64} \(refusing to run an unverified binary\)/);
    assert.ok(!fs.existsSync(path.join(cache, 'ruff')), 'nothing cached after a sha256 mismatch');
  } finally {
    if (old === undefined) delete process.env.STANDARDS_CACHE; else process.env.STANDARDS_CACHE = old;
  }
});

test('archive readers: synthetic tar.gz (ustar) and stored zip', () => {
  const payload = Buffer.from('#!ruff\n');
  const hdr = Buffer.alloc(512);
  hdr.write('ruff-x/ruff', 0); hdr.write(payload.length.toString(8).padStart(11, '0'), 124); hdr.write('0', 156);
  const body = Buffer.concat([hdr, Buffer.concat([payload, Buffer.alloc(512 - payload.length)]), Buffer.alloc(1024)]);
  assert.deepEqual(tool.extractFromTarGz(zlib.gzipSync(body), 'ruff'), payload);
  assert.throws(() => tool.extractFromTarGz(zlib.gzipSync(body), 'nope'), /not found/);
  // one stored entry "ruff.exe"
  const name = Buffer.from('ruff.exe');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt32LE(payload.length, 20); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 10);
  const cdOffset = local.length + name.length + payload.length;
  eocd.writeUInt32LE(cdOffset, 16);
  const zip = Buffer.concat([local, name, payload, central, name, eocd]);
  assert.deepEqual(tool.extractFromZip(zip, 'ruff.exe'), payload);
});

test('host triple mapping covers the pinned platforms', () => {
  assert.equal(tool.hostTriple('win32', 'x64'), 'x86_64-pc-windows-msvc');
  assert.equal(tool.hostTriple('linux', 'arm64'), 'aarch64-unknown-linux-gnu');
  assert.equal(tool.hostTriple('darwin', 'arm64'), 'aarch64-apple-darwin');
  assert.equal(tool.hostTriple('freebsd', 'x64'), null);
  assert.ok(os.platform());
});
