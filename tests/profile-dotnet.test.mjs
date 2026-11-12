// dotnet-base + dotnet-addin: key properties of the released files (pins, gate commands, no autofix in CI, no shell).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir } from './helpers.mjs';

const BASE = path.join(KIT_ROOT, 'profiles/dotnet-base/1.0.0');
const ADDIN = path.join(KIT_ROOT, 'profiles/dotnet-addin/1.0.0');
const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');
const cj = JSON.parse(read(BASE, '.standards/dotnet-base/check.json'));
const dn = await import(pathToFileURL(path.join(BASE, '.standards/dotnet-base/dotnet.mjs')).href);

test('dotnet-base: SDK floor and AnalysisLevel pinned exactly; no tool is downloaded', () => {
  assert.deepEqual(Object.keys(cj.tools).sort(), ['AnalysisLevel', 'dotnet-sdk-min']);
  assert.match(cj.tools['dotnet-sdk-min'], /^\d+\.\d+\.\d+$/);
  assert.match(cj.tools.AnalysisLevel, /^\d+\.\d+-recommended$/);
  assert.ok(read(BASE, '.standards/dotnet-base/dotnet.props').includes(`<AnalysisLevel>${cj.tools.AnalysisLevel}</AnalysisLevel>`));
});

test('dotnet-base: gate order wiring -> suppressions -> format -> build, via the runner, never fixing', () => {
  assert.deepEqual(cj.commands.map((c) => c.id), ['wiring', 'suppressions', 'format', 'build']);
  for (const c of cj.commands) assert.deepEqual(c.run.slice(0, 2), ['node', '.standards/dotnet-base/dotnet.mjs']);
  const src = read(BASE, '.standards/dotnet-base/dotnet.mjs');
  assert.ok(src.includes('--verify-no-changes'));
  assert.ok(!/execSync|shell:\s*true|-warnaserror|--fix/.test(src.replace(/never -warnaserror/g, '')), 'no shell, no CLI -warnaserror, no fix');
});

test('dotnet-base: props gate the build, audit warnings are not failures, IDE0005/IDE0079 on', () => {
  const p = read(BASE, '.standards/dotnet-base/dotnet.props');
  for (const s of ['<Nullable>enable', '<TreatWarningsAsErrors>true', '<EnforceCodeStyleInBuild>true', '<GenerateDocumentationFile>true', 'NU1900']) assert.ok(p.includes(s), s);
  const g = read(BASE, '.standards/dotnet-base/dotnet.globalconfig');
  assert.match(g, /^is_global = true$/m);
  assert.match(g, /IDE0005\.severity = warning/);
  assert.match(g, /IDE0079\.severity = warning/);
});

test('dotnet-addin: relaxes only APIs missing on net48, requires dotnet-base, no commands of its own', () => {
  const a = JSON.parse(read(ADDIN, '.standards/dotnet-addin/check.json'));
  assert.deepEqual(a.commands, []);
  const g = read(ADDIN, '.standards/dotnet-addin/addin.globalconfig');
  assert.match(g, /^is_global = true$/m);
  const rules = [...g.matchAll(/dotnet_diagnostic\.(\w+)\.severity = none/g)].map((m) => m[1]).sort();
  assert.deepEqual(rules, ['CA1837', 'CA1845', 'CA1846', 'CA2249']);
  const p = read(BASE, '.standards/dotnet-base/dotnet.props');
  assert.match(p, /dotnet-addin\/\*\.globalconfig/);
  assert.match(p, /StartsWith\('net4'\)/);
});

test('dotnet runner: version compare and wiring problems', () => {
  assert.ok(dn.cmpVer('10.0.203', '10.0.100') > 0 && dn.cmpVer('9.0.300', '10.0.100') < 0 && dn.cmpVer('10.0.100', '10.0.100') === 0);
  const root = tmpdir('dotnet-wiring-');
  const w = (f, b) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), b); };
  const files = ['src/A.csproj', 'Directory.Build.props'];
  w('src/A.csproj', '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup><NoWarn>CA1707</NoWarn></PropertyGroup>\n</Project>\n');
  w('Directory.Build.props', '<Project />\n');
  const bad = dn.wiringProblems(root, files, '10.0.203').map(([w2, m]) => `${w2} ${m}`).join('\n');
  assert.match(bad, /global\.json missing/);
  assert.match(bad, /Directory\.Build\.props does not <Import>/);
  assert.match(bad, /src\/A\.csproj:2 NoWarn needs an XML comment/);
  w('global.json', '{"sdk":{"version":"10.0.203","rollForward":"latestFeature"}}');
  w('Directory.Build.props', '<Project><Import Project="$(MSBuildThisFileDirectory).standards/dotnet-base/dotnet.props" /></Project>\n');
  w('src/A.csproj', '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup><TreatWarningsAsErrors>false</TreatWarningsAsErrors></PropertyGroup>\n</Project>\n');
  assert.match(dn.wiringProblems(root, files, '10.0.203').map((x) => x.join(' ')).join('\n'), /A\.csproj:2 TreatWarningsAsErrors=false/);
  w('src/A.csproj', '<Project Sdk="Microsoft.NET.Sdk" />\n');
  assert.deepEqual(dn.wiringProblems(root, files, '10.0.203'), []);
  assert.equal(dn.wiringProblems(root, files, '9.0.300').length, 1);
});

test('dotnet runner: suppressions need a rule id and a reason', () => {
  const root = tmpdir('dotnet-supp-');
  fs.writeFileSync(path.join(root, 'a.cs'), [
    '#pragma warning disable CA1822', '#pragma warning disable CA1822 // reason here',
    '[SuppressMessage("Design", "CA1051")]', '[SuppressMessage("Design", "CA1051", Justification = "wire format")]', '',
  ].join('\n'));
  const p = dn.suppressionProblems(root, ['a.cs']).map(([w]) => w);
  assert.deepEqual(p, ['a.cs:1', 'a.cs:3']);
});
