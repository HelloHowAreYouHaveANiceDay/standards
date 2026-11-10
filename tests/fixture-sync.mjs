#!/usr/bin/env node
// Fixture sync (kit CI): sync every profile into fresh temp follower repos from this clone (file:// kit),
// run the vendored check.mjs there with the real pinned tools, and prove the gates bite:
//   - clean fixture: check.mjs passes;
//   - a new unchecked error on a PR branch: golangci (ratchet vs origin/main) fails, naming file:line;
//   - an unformatted file: gofmt fails, naming the file.
// --out <file> writes "<sha256>  <fixture>/<path>" for every synced file, for the Windows-vs-Linux byte comparison.
//
//   node tests/fixture-sync.mjs [--out synced.txt] [--only base,go-strict]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, SYNC, sha256, walk, node, git, tmpdir } from './helpers.mjs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : null;
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;

const GO_MOD = 'module example.com/fixture\n\ngo 1.23\n';
const MAIN_GO = 'package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tif _, err := fmt.Fprintln(os.Stdout, "ok"); err != nil {\n\t\tos.Exit(1)\n\t}\n}\n';
const BAD_GO = 'package main\n\nimport "os"\n\nfunc init() {\n\tos.Remove("fixture.tmp")\n}\n';
const UNFORMATTED_GO = 'package main\n\nfunc   helper() int { return 1 }\n\nvar _ = helper\n';
const OVERLAY = '# fixture overlay (site-cli drift shape)\nlinters:\n  settings:\n    gosec:\n      excludes:\n        - G124  # cookie flags -- fixture reason\n';

const FIXTURES = [
  { id: 'base', profiles: ['base@1.0.0'], go: false },
  { id: 'go-base', profiles: ['base@1.0.0', 'go-base@1.0.0'], go: true },
  { id: 'go-strict', profiles: ['base@1.0.0', 'go-strict@1.0.0'], go: true },
  { id: 'go-strict-overlay', profiles: ['base@1.0.0', 'go-strict@1.0.0'], go: true, overlay: true },
].filter((f) => !only || only.includes(f.id));

const kitUrl = pathToFileURL(KIT_ROOT).href;
const lines = [];
let failed = 0;
const step = (ok, msg, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) { failed++; if (detail) console.log(detail.split('\n').map((l) => `     | ${l}`).join('\n')); }
};

for (const fx of FIXTURES) {
  const dir = tmpdir(`fixture-${fx.id}-`);
  git(dir, 'init', '-q', '-b', 'main');
  const files = { 'README.md': `# ${fx.id}\n` };
  if (fx.go) Object.assign(files, { 'go.mod': GO_MOD, 'main.go': MAIN_GO });
  if (fx.overlay) files['.golangci.local.yml'] = OVERLAY;
  for (const [f, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), b);
  const s = node([SYNC, 'init', ...fx.profiles, '--kit', kitUrl], { cwd: dir });
  step(s.code === 0, `${fx.id}: sync init ${fx.profiles.join(' ')}`, s.out);
  if (s.code !== 0) continue;
  for (const [rel, buf] of Object.entries(walk(dir)).sort(([a], [b]) => (a < b ? -1 : 1))) lines.push(`${sha256(buf)}  ${fx.id}/${rel}`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'bootstrap standards');
  const bare = path.join(tmpdir(`origin-${fx.id}-`), 'origin.git');
  git(dir, 'clone', '-q', '--bare', dir, bare);
  git(dir, 'remote', 'add', 'origin', bare); // origin/main deliberately not fetched: check.mjs must fetch it
  const clean = node([path.join(dir, '.standards', 'check.mjs')], { cwd: dir });
  step(clean.code === 0, `${fx.id}: check.mjs passes on the clean fixture`, clean.out);
  if (!fx.go) continue;
  git(dir, 'checkout', '-q', '-b', 'pr');
  fs.writeFileSync(path.join(dir, 'bad.go'), BAD_GO);
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'new finding');
  const bad = node([path.join(dir, '.standards', 'check.mjs')], { cwd: dir });
  step(bad.code === 1 && /bad\.go:6:\d+:.*errcheck/.test(bad.out) && /FAIL \[[a-z-]+\/golangci-lint v2\.12\.2\] exit 1/.test(bad.out),
    `${fx.id}: a new unchecked error fails golangci (ratchet vs origin/main) naming bad.go:6`, bad.out);
  fs.rmSync(path.join(dir, 'bad.go'));
  fs.writeFileSync(path.join(dir, 'fmt.go'), UNFORMATTED_GO);
  const fmt = node([path.join(dir, '.standards', 'check.mjs')], { cwd: dir });
  step(fmt.code === 1 && /FAIL \[[a-z-]+\/gofmt\] fmt\.go: not gofmt-formatted/.test(fmt.out), `${fx.id}: an unformatted file fails gofmt naming fmt.go`, fmt.out);
}

if (out) fs.writeFileSync(out, `${lines.join('\n')}\n`);
console.log(failed ? `fixture-sync: ${failed} failure(s)` : `fixture-sync: OK (${FIXTURES.length} fixtures, ${lines.length} synced files hashed)`);
process.exitCode = failed ? 1 : 0;
