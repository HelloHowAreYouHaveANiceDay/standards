#!/usr/bin/env node
// Release a profile: snapshot src/profiles/<name>/ into the append-only dir profiles/<name>/<x.y.z>/.
//
//   node scripts/release.mjs <name> <x.y.z> [--kit-root <dir>]
//
// Copies every file byte for byte (LF only; CR is refused), stamps "version" into
// .standards/<name>/check.json, writes SHA256SUMS (follower-relative paths, sorted) and
// profiles/<name>/VERSIONS. Refuses an existing version dir (released dirs are immutable) and a
// version without a `## <x.y.z>` heading in profiles/<name>/CHANGELOG.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const cmpSemver = (a, b) => {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, r));
    else out.push(r);
  }
  return out;
}

export function release(kitRoot, name, version) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`bad profile name ${name}`);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`version is not x.y.z: ${version}`);
  const src = path.join(kitRoot, 'src', 'profiles', name);
  const pdir = path.join(kitRoot, 'profiles', name);
  const out = path.join(pdir, version);
  if (fs.existsSync(out)) throw new Error(`profiles/${name}/${version} already exists -- released versions are immutable; release a new version`);
  if (!fs.existsSync(src)) throw new Error(`no src/profiles/${name}`);
  const cl = path.join(pdir, 'CHANGELOG.md');
  if (!fs.existsSync(cl) || !new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(fs.readFileSync(cl, 'utf8'))) {
    throw new Error(`profiles/${name}/CHANGELOG.md has no "## ${version}" heading`);
  }
  const files = {};
  for (const f of walk(src).sort()) {
    let buf = fs.readFileSync(path.join(src, f));
    if (buf.includes(13)) throw new Error(`${f} contains CR bytes; profile files are LF`);
    if (f === `.standards/${name}/check.json`) {
      const j = JSON.parse(buf.toString('utf8'));
      if (j.profile !== name) throw new Error(`${f}: profile is ${j.profile}, expected ${name}`);
      j.version = version;
      buf = Buffer.from(`${JSON.stringify(j, null, 2)}\n`);
    }
    files[f] = buf;
  }
  if (!files[`.standards/${name}/check.json`]) throw new Error(`src/profiles/${name} has no .standards/${name}/check.json`);
  if (files.SHA256SUMS) throw new Error('a profile may not ship a file named SHA256SUMS at its root');
  for (const [f, buf] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f), buf);
  }
  const sums = Object.keys(files).sort().map((f) => `${sha256(files[f])}  ${f}\n`).join('');
  fs.writeFileSync(path.join(out, 'SHA256SUMS'), sums);
  const versions = fs.readdirSync(pdir).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort(cmpSemver);
  fs.writeFileSync(path.join(pdir, 'VERSIONS'), versions.map((v) => `${v}\n`).join(''));
  return { out, files: Object.keys(files) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--kit-root');
  const kitRoot = i >= 0 ? path.resolve(args.splice(i, 2)[1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const [name, version] = args;
  try {
    const r = release(kitRoot, name, version);
    console.log(`release: ${name}@${version} -> ${path.relative(kitRoot, r.out)} (${r.files.length} files)`);
  } catch (e) {
    console.error(`release: ${e.message}`);
    process.exitCode = 1;
  }
}
