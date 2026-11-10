#!/usr/bin/env node
// Who follows what. Read-only: `gh repo list <owner>`, then `gh api repos/<repo>/contents/.standards.json`
// per repo. The kit stores no follower list; this is the only kit -> follower arrow, and it only reads.
//
//   node who.mjs [--owner HelloHowAreYouHaveANiceDay]
//
// Prints: repo  profile@version  latest-in-kit [(behind)]. "latest" comes from this clone's profiles/<name>/VERSIONS.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.dirname(fileURLToPath(import.meta.url));

function cmpSemver(a, b) {
  const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

export function latestVersions(kitRoot = KIT) {
  const dir = path.join(kitRoot, 'profiles');
  const out = {};
  for (const n of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const f = path.join(dir, n, 'VERSIONS');
    if (!fs.existsSync(f)) continue;
    const vs = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).sort(cmpSemver);
    if (vs.length) out[n] = vs[vs.length - 1];
  }
  return out;
}

export function realGh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const e = new Error(`gh ${args.join(' ')}: ${(stderr || err.message).trim()}`);
      e.notFound = /HTTP 404|Not Found/.test(stderr || '');
      reject(e);
    });
  });
}

export async function collect({ owner, gh = realGh, latest = latestVersions() }) {
  const repos = JSON.parse(await gh(['repo', 'list', owner, '--limit', '1000', '--no-archived', '--json', 'nameWithOwner']))
    .map((r) => r.nameWithOwner).sort();
  const rows = [];
  for (const repo of repos) {
    let body;
    try {
      body = JSON.parse(await gh(['api', `repos/${repo}/contents/.standards.json`]));
    } catch (e) {
      if (e.notFound) continue;
      throw e;
    }
    let manifest;
    try { manifest = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')); } catch {
      rows.push({ repo, profile: '(unreadable .standards.json)', version: '', latest: '' });
      continue;
    }
    for (const [profile, version] of Object.entries(manifest.profiles || {})) {
      rows.push({ repo, profile, version, latest: latest[profile] || '?' });
    }
  }
  return rows;
}

export function formatRows(rows) {
  const cells = rows.map((r) => [r.repo, r.version ? `${r.profile}@${r.version}` : r.profile,
    r.latest && r.latest !== '?' && cmpSemver(r.version, r.latest) < 0 ? `${r.latest} (behind)` : r.latest]);
  const w = [0, 1].map((i) => Math.max(0, ...cells.map((c) => c[i].length)));
  return cells.map((c) => `${c[0].padEnd(w[0])}  ${c[1].padEnd(w[1])}  ${c[2]}`.trimEnd()).join('\n') + (cells.length ? '\n' : '');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--owner');
  const owner = i >= 0 ? args[i + 1] : 'HelloHowAreYouHaveANiceDay';
  collect({ owner }).then((rows) => {
    process.stdout.write(rows.length ? formatRows(rows) : `who: no repo of ${owner} has .standards.json\n`);
  }, (e) => { console.error(`who: ${e.message}`); process.exitCode = 1; });
}
