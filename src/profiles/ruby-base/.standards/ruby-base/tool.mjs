#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile ruby-base); do not edit -- re-run sync.
// Zero dependencies. Installs the exact-pinned RuboCop gem set into the standards cache (no Bundler, no Gemfile,
// no global setup, no shell) and runs it with the Ruby already on PATH (preinstalled on GitHub-hosted runners).
//
//   node .standards/ruby-base/tool.mjs run rubocop [args]   # install pins if missing, then run RuboCop
//   node .standards/ruby-base/tool.mjs policy               # .rubocop.yml inherits the base; suppressions carry a reason
//
// Pins live in .standards/ruby-base/check.json "tools" (the full dependency closure, so nothing floats).
// RUBY=<path to ruby> overrides the `ruby` on PATH. STANDARDS_CACHE overrides the cache dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TAG = 'ruby-base';
const BASE_CONFIG = '.standards/ruby-base/rubocop.yml';
const RUBY_FILES = ['*.rb', '*.rake', '*.gemspec', 'Rakefile', 'Gemfile', '*/Rakefile', '*/Gemfile'];

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const out = (s) => console.log(s);
const fail = (what, step = '') => out(`standards: FAIL [${TAG}${step ? `/${step}` : ''}] ${what}`);

function cacheDir() {
  if (process.env.STANDARDS_CACHE) return process.env.STANDARDS_CACHE;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'standards', 'cache');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'standards');
}

const rubyBin = () => process.env.RUBY || 'ruby';

function rubyInfo() {
  const r = spawnSync(rubyBin(), ['-e', 'puts RUBY_VERSION, RbConfig::CONFIG["ruby_version"], RUBY_PLATFORM'], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) return { error: `could not run \`${rubyBin()}\` (${r.error ? r.error.code || r.error.message : (r.stderr || '').trim()}); install Ruby >= 3.3 (GitHub runners have it; or ruby/setup-ruby)` };
  const [version, abi, platform] = r.stdout.trim().split(/\r?\n/);
  return { version, abi, platform };
}

// Environment for ruby/gem: our gem home only plus Ruby's own default/bundled gems; nothing from the caller's setup.
function gemEnv(home) {
  const env = { ...process.env, GEM_HOME: home };
  for (const k of ['GEM_PATH', 'BUNDLE_GEMFILE', 'BUNDLE_PATH', 'RUBYOPT', 'RUBYLIB']) delete env[k];
  return env;
}

export function installedProblems(home, tools) {
  const specs = path.join(home, 'specifications');
  const have = fs.existsSync(specs) ? fs.readdirSync(specs) : [];
  const problems = [];
  for (const [name, ver] of Object.entries(tools)) {
    const re = new RegExp(`^${name.replace(/[-.]/g, '\\$&')}-${ver.replace(/\./g, '\\.')}(-[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*)?\\.gemspec$`);
    if (!have.some((f) => re.test(f))) problems.push(`${name} ${ver} is not installed in ${home}`);
  }
  return problems;
}

function ensureGems(tools) {
  const ri = rubyInfo();
  if (ri.error) return { error: ri.error };
  const key = crypto.createHash('sha256').update(JSON.stringify([Object.entries(tools).sort(), ri.abi, ri.platform])).digest('hex').slice(0, 12);
  const home = path.join(cacheDir(), 'ruby-gems', `${ri.abi}-${key}`);
  if (fs.existsSync(path.join(home, '.ok')) && installedProblems(home, tools).length === 0) return { home, ruby: ri.version };
  fs.mkdirSync(home, { recursive: true });
  out(`standards: [${TAG}] installing ${Object.keys(tools).length} pinned gems for ruby ${ri.version} into ${home}`);
  const specs = Object.entries(tools).map(([n, v]) => `${n}:${v}`);
  const r = spawnSync(rubyBin(), ['-S', 'gem', 'install', '--no-document', '--no-user-install', '--conservative', ...specs], { env: gemEnv(home), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (r.error || r.status !== 0) return { error: `gem install failed (${r.error ? r.error.message : `exit ${r.status}`}):\n${(r.stdout || '') + (r.stderr || '')}` };
  const p = installedProblems(home, tools);
  if (p.length) return { error: p.join('\n') };
  fs.writeFileSync(path.join(home, '.ok'), `${ri.version}\n`);
  return { home, ruby: ri.version };
}

function runRubocop(args) {
  const tools = readJson(path.join(HERE, 'check.json')).tools;
  const g = ensureGems(tools);
  if (g.error) { fail(g.error); return 1; }
  const exe = path.join(g.home, 'gems', `rubocop-${tools.rubocop}`, 'exe', 'rubocop');
  const r = spawnSync(rubyBin(), [exe, ...args], { cwd: ROOT, env: gemEnv(g.home), stdio: 'inherit', windowsHide: true });
  if (r.error) { fail(`could not start rubocop: ${r.error.message}`); return 1; }
  return r.status ?? 1;
}

function trackedRubyFiles() {
  const r = spawnSync('git', ['ls-files', '-z', '--', ...RUBY_FILES], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) return { error: 'git ls-files failed (the follower must be a git checkout)' };
  return { files: r.stdout.split('\0').filter(Boolean) };
}

// `# rubocop:disable Cop/Name -- reason` is the only accepted form (RuboCop's own directive-comment syntax);
// `rubocop:todo` and .rubocop_todo.yml are refused: debt is fixed in the bootstrap PR, not parked.
export function policyProblems(root, files) {
  const problems = [];
  const cfg = path.join(root, '.rubocop.yml');
  if (!fs.existsSync(cfg)) problems.push(`.rubocop.yml: missing (create it with \`inherit_from: ${BASE_CONFIG}\`)`);
  else if (!fs.readFileSync(cfg, 'utf8').split(/\r?\n/).some((l) => !l.trim().startsWith('#') && l.includes(BASE_CONFIG))) problems.push(`.rubocop.yml: does not inherit ${BASE_CONFIG} (add \`inherit_from: ${BASE_CONFIG}\`)`);
  if (fs.existsSync(path.join(root, '.rubocop_todo.yml'))) problems.push('.rubocop_todo.yml: not allowed (fix the findings; use `# rubocop:disable Cop -- reason` for a justified exception)');
  for (const f of files) {
    const lines = fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = /#\s*rubocop\s*:\s*(disable|todo|enable)\b(.*)$/.exec(line);
      if (!m) return;
      if (m[1] === 'todo') problems.push(`${f}:${i + 1}: rubocop:todo is not allowed (fix it, or rubocop:disable Cop -- reason)`);
      else if (m[1] === 'disable' && !/\s--\s+\S/.test(m[2])) problems.push(`${f}:${i + 1}: rubocop:disable needs a reason (\`# rubocop:disable Cop/Name -- why\`)`);
    });
  }
  return problems;
}

export function main(argv = process.argv.slice(2)) {
  const [cmd, target, ...rest] = argv;
  if (cmd === 'run' && target === 'rubocop') return runRubocop(rest);
  if (cmd === 'policy') {
    const t = trackedRubyFiles();
    if (t.error) { fail(t.error, 'policy'); return 1; }
    const p = policyProblems(ROOT, t.files);
    for (const l of p) fail(l, 'policy');
    if (!p.length) out(`standards: [${TAG}/policy] .rubocop.yml inherits the base; ${t.files.length} Ruby files, every suppression has a reason`);
    return p.length ? 1 : 0;
  }
  out('usage: tool.mjs run rubocop [args...] | policy');
  return 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main();
