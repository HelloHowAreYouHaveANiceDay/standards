#!/usr/bin/env node
// secret-scan (shipped with ci-local; `ci.mjs init` copies it to ci/scripts/secret-scan.mjs). Zero dependencies.
// Scans git-tracked text files for credential shapes. Prints file:line and the rule id, NEVER the matched text.
// Exit 0 clean, 1 findings. Allow a line with `secret-scan:allow` in a comment on it.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const RULES = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['stripe-live-key', /\b[sr]k_live_[0-9A-Za-z]{20,}\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/],
];
const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (top.status !== 0) { console.error('secret-scan: not a git checkout'); process.exit(3); }
const root = top.stdout.trim();
const ls = spawnSync('git', ['ls-files', '-z'], { encoding: 'buffer', cwd: root, maxBuffer: 256 * 1024 * 1024 });
const files = ls.stdout.toString('utf8').split('\0').filter(Boolean);
let found = 0;
for (const f of files) {
  let buf;
  try { buf = fs.readFileSync(`${root}/${f}`); } catch { continue; }
  if (buf.length > 2_000_000 || buf.includes(0)) continue;
  buf.toString('utf8').split('\n').forEach((line, i) => {
    if (line.includes('secret-scan:allow')) return;
    for (const [id, re] of RULES) if (re.test(line)) { found++; console.log(`${f}:${i + 1}: ${id}`); }
  });
}
console.log(found ? `secret-scan: ${found} finding(s)` : `secret-scan: clean (${files.length} files)`);
process.exit(found ? 1 : 0);
