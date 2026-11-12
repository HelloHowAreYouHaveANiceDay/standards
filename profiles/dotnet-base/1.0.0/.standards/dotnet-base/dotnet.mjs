#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile dotnet-base); do not edit -- re-run sync.
// Zero dependencies, no shell. Drives the .NET SDK that is already installed (GitHub-hosted runners ship it):
//
//   node .standards/dotnet-base/dotnet.mjs wiring       # global.json pin, props imported by every csproj, no gate overrides in project files
//   node .standards/dotnet-base/dotnet.mjs suppressions # every #pragma warning disable / SuppressMessage carries a reason
//   node .standards/dotnet-base/dotnet.mjs format       # dotnet format whitespace --folder --verify-no-changes (never writes)
//   node .standards/dotnet-base/dotnet.mjs build        # dotnet build of every tracked .sln/.slnx (else every .csproj);
//                                                       # warnings-as-errors come from dotnet.props, not from the command line
//
// Findings print as `file:line: ...` (build and format print the compiler's `file(line,col): error ...`).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PROFILE = path.basename(HERE);
const TAG = PROFILE;
const PROPS_REL = `.standards/${PROFILE}/dotnet.props`;
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const FRAGMENT = readJson(path.join(HERE, 'check.json'));
const posix = (p) => p.split(path.sep).join('/');
const fail = (where, what) => console.log(`standards: FAIL [${TAG}] ${where}: ${what}`);

function tracked(root = ROOT) {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status === 0) return r.stdout.split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f)));
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      if (['.git', 'bin', 'obj', 'node_modules'].includes(e.name)) continue;
      const rel = d ? `${d}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel); else out.push(rel);
    }
  };
  walk('');
  return out;
}
const isStandards = (f) => f.startsWith('.standards/');

export function sdkMin() { return FRAGMENT.tools['dotnet-sdk-min']; }
const verOf = (v) => v.split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
export function cmpVer(a, b) {
  const x = verOf(a); const y = verOf(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

export function wiringProblems(root = ROOT, files = tracked(root), resolved = null) {
  const out = [];
  const gj = path.join(root, 'global.json');
  if (!fs.existsSync(gj)) out.push(['global.json', `missing: the repo pins its SDK (add {"sdk":{"version":"<x.y.z>","rollForward":"latestFeature"}} with x.y.z >= ${sdkMin()})`]);
  else {
    let sdk = null;
    try { sdk = readJson(gj).sdk; } catch { out.push(['global.json', 'unreadable JSON']); }
    if (sdk !== null) {
      const v = sdk && sdk.version;
      if (!v || !/^\d+\.\d+\.\d+$/.test(v)) out.push(['global.json', `sdk.version is ${JSON.stringify(v)}, pin an exact x.y.z`]);
      else if (cmpVer(v, sdkMin()) < 0) out.push(['global.json', `sdk.version ${v} is older than ${sdkMin()}, which the pinned AnalysisLevel needs`]);
    }
  }
  if (resolved !== null && cmpVer(resolved, sdkMin()) < 0) out.push(['dotnet', `SDK ${resolved} is older than ${sdkMin()}`]);
  const props = new Set(files.filter((f) => /(^|\/)Directory\.Build\.props$/i.test(f)));
  const csprojs = files.filter((f) => /\.csproj$/i.test(f) && !isStandards(f));
  for (const cp of csprojs) {
    let dir = path.posix.dirname(cp);
    let found = null;
    for (;;) {
      const cand = dir === '.' ? 'Directory.Build.props' : `${dir}/Directory.Build.props`;
      if ([...props].some((p) => p.toLowerCase() === cand.toLowerCase())) { found = [...props].find((p) => p.toLowerCase() === cand.toLowerCase()); break; }
      if (dir === '.') break;
      dir = path.posix.dirname(dir);
    }
    if (!found) { out.push([cp, `no Directory.Build.props above it importing ${PROPS_REL}`]); continue; }
    const text = fs.readFileSync(path.join(root, found), 'utf8');
    if (!text.includes(PROPS_REL)) out.push([found, `does not <Import> ${PROPS_REL} (nearest Directory.Build.props of ${cp}; MSBuild reads only the nearest one)`]);
  }
  // Project files may not switch the gate off.
  for (const f of files.filter((x) => /\.(csproj|props|targets)$/i.test(x) && !isStandards(x))) {
    const lines = fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => {
      const n = i + 1;
      if (/<TreatWarningsAsErrors>\s*false/i.test(l)) out.push([`${f}:${n}`, 'TreatWarningsAsErrors=false switches the gate off (raise a .editorconfig severity override with a reason instead)']);
      if (/<Nullable>\s*disable/i.test(l)) out.push([`${f}:${n}`, 'Nullable=disable switches nullable analysis off (use #nullable disable with a reason, per file)']);
      if (/<WarningsNotAsErrors>/i.test(l)) out.push([`${f}:${n}`, 'WarningsNotAsErrors weakens the gate (use a .editorconfig severity override with a reason)']);
      if (/<NoWarn>/i.test(l) && !/<!--/.test(l) && !/<!--|-->/.test(lines[i - 1] || '')) out.push([`${f}:${n}`, 'NoWarn needs an XML comment with the reason on this or the previous line']);
    });
  }
  return out;
}

const PRAGMA = /#pragma\s+warning\s+disable\b/;
export function suppressionProblems(root = ROOT, files = tracked(root)) {
  const out = [];
  for (const f of files.filter((x) => /\.cs$/i.test(x) && !isStandards(x))) {
    const lines = fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => {
      const n = i + 1;
      if (PRAGMA.test(l)) {
        if (!/\bCS?\d+|\bCA\d+|\bIDE\d+|\b[A-Z]{2,}\d+/.test(l)) out.push([`${f}:${n}`, '#pragma warning disable names no rule id']);
        const reason = /\/\/\s*\S{3,}/.test(l.split(/disable\b/)[1] || '') ;
        if (!reason) out.push([`${f}:${n}`, '#pragma warning disable has no reason (append `// why`)']);
      }
      if (/\bSuppressMessage\s*\(/.test(l)) {
        // The attribute may span a few lines; look ahead until the closing parenthesis.
        let span = l; let j = i;
        while (!/\)\s*\]/.test(span) && j < lines.length - 1 && j < i + 6) span += lines[++j];
        if (!/Justification\s*=\s*"[^"]{3,}/.test(span)) out.push([`${f}:${n}`, 'SuppressMessage has no Justification = "..."']);
      }
    });
  }
  return out;
}

function dotnet(args, opts = {}) {
  return spawnSync('dotnet', args, { cwd: ROOT, stdio: 'inherit', windowsHide: true, env: { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' }, ...opts });
}

export function resolvedSdk() {
  const r = spawnSync('dotnet', ['--version'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (r.error) return { error: `could not start dotnet: ${r.error.code || r.error.message} (install the .NET SDK from global.json; on GitHub runners use actions/setup-dotnet with global-json-file)` };
  if (r.status !== 0) return { error: `dotnet --version failed (global.json asks for an SDK that is not installed?):\n${(r.stdout + r.stderr).trim()}` };
  return { version: r.stdout.trim() };
}

function targets(files) {
  const slns = files.filter((f) => /\.(sln|slnx)$/i.test(f));
  if (slns.length) return slns;
  return files.filter((f) => /\.csproj$/i.test(f) && !isStandards(f));
}

export function main(argv = process.argv.slice(2)) {
  const [cmd] = argv;
  if (cmd === 'wiring') {
    const sdk = resolvedSdk();
    if (sdk.error) { fail('dotnet', sdk.error); return 1; }
    const p = wiringProblems(ROOT, tracked(), sdk.version);
    for (const [where, what] of p) fail(where, what);
    if (!p.length) console.log(`standards: [${TAG}/wiring] SDK ${sdk.version} (>= ${sdkMin()}); dotnet.props imported by every csproj`);
    return p.length ? 1 : 0;
  }
  if (cmd === 'suppressions') {
    const p = suppressionProblems();
    for (const [where, what] of p) fail(where, what);
    if (!p.length) console.log(`standards: [${TAG}/suppressions] every suppression carries a reason`);
    return p.length ? 1 : 0;
  }
  if (cmd === 'format') {
    const files = tracked();
    if (!files.some((f) => /\.cs$/i.test(f))) { console.log(`standards: [${TAG}/format] no .cs files -- skipped`); return 0; }
    // --folder reads the files directly: no restore, no MSBuild project load (works without Revit/Rhino DLLs).
    const r = dotnet(['format', 'whitespace', '.', '--folder', '--verify-no-changes', '--exclude', '**/bin/**', '**/obj/**', '.standards/**']);
    if (r.error) { fail('dotnet', `could not start: ${r.error.code}`); return 1; }
    return r.status ?? 1;
  }
  if (cmd === 'build') {
    const t = targets(tracked());
    if (!t.length) { console.log(`standards: [${TAG}/build] no .sln or .csproj -- skipped`); return 0; }
    let worst = 0;
    for (const target of t) {
      console.log(`standards: [${TAG}/build] dotnet build ${target}`);
      const r = dotnet(['build', target, '--nologo', '-v:q', '-clp:NoSummary;ForceNoAlign']);
      if (r.error) { fail('dotnet', `could not start: ${r.error.code}`); return 1; }
      if (r.status !== 0) worst = r.status ?? 1; // keep going: one run lists every target's findings
    }
    return worst;
  }
  console.log('usage: dotnet.mjs wiring | suppressions | format | build');
  return 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main();
