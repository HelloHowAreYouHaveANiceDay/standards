#!/usr/bin/env node
// Append-only guard: released dirs profiles/<name>/<x.y.z>/ are never modified or deleted.
//
//   node scripts/append-only.mjs [base-ref]     # default origin/main
//
// Runs `git diff --no-renames --name-status --diff-filter=MD <base>...HEAD -- profiles/` and fails on any path
// inside a version dir. Adding a new version dir, or editing profiles/<name>/CHANGELOG.md or VERSIONS, is fine.
import { spawnSync } from 'node:child_process';

const base = process.argv[2] || 'origin/main';
const args = ['-c', 'core.quotepath=off', 'diff', '--no-renames', '--name-status', '--diff-filter=MD', `${base}...HEAD`, '--', 'profiles/'];
const r = spawnSync('git', args, { encoding: 'utf8' });
if (r.status !== 0) {
  console.error(`append-only: git ${args.join(' ')} failed:\n${r.stderr}`);
  process.exit(2);
}
const bad = r.stdout.split('\n').filter(Boolean).filter((l) => /^[MD]\tprofiles\/[^/]+\/\d+\.\d+\.\d+\//.test(l));
if (bad.length) {
  console.error(`append-only: released version dirs are immutable; these changes vs ${base} must be reverted (release a new version instead):`);
  for (const l of bad) console.error(`  ${l}`);
  process.exit(1);
}
console.log(`append-only: OK (no modified or deleted files in released version dirs vs ${base})`);
