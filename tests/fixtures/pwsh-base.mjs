// pwsh-base fixture: real pinned PSScriptAnalyzer (installed into the standards cache by the profile's lint.ps1),
// run by `pwsh`. Skipped (with a message) where pwsh is missing; GitHub-hosted runners ship it.
import fs from 'node:fs';
import path from 'node:path';

const CLEAN = [
  '[CmdletBinding()]',
  'param(',
  "    [string]$Name = 'world'",
  ')',
  '',
  'function Get-Greeting {',
  '    [CmdletBinding()]',
  '    [OutputType([string])]',
  '    param([string]$Who)',
  '    return "hello $Who"',
  '}',
  '',
  'Write-Output (Get-Greeting -Who $Name)',
  '',
].join('\n');

const IEX = 'function Invoke-Thing {\n    [CmdletBinding()]\n    param([string]$Code)\n    Invoke-Expression $Code\n}\n';
const UGLY = 'function Get-Two {\n  [CmdletBinding()]\n  param()\n  return 2\n}\n';
const SUPPRESS = (extra) => `function Invoke-Thing {\n    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingInvokeExpression', ''${extra})]\n    [CmdletBinding()]\n    param([string]$Code)\n    Invoke-Expression $Code\n}\n`;

export const fixture = {
  id: 'pwsh-base',
  profiles: ['base@1.0.0', 'pwsh-base@1.0.0'],
  files: { 'scripts/hello.ps1': CLEAN },
  prepare: (dir, h) => {
    const r = h.run('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']);
    if (r.code !== 0) { console.log('skip pwsh-base: pwsh is not installed'); return false; }
    return true;
  },
  inject: (dir, h) => {
    const write = (rel, body) => fs.writeFileSync(path.join(dir, rel), body);
    const drop = (rel) => fs.rmSync(path.join(dir, rel));
    const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

    write('scripts/bad.ps1', IEX);
    let r = h.check();
    h.step(r.code === 1 && /scripts\/bad\.ps1:4:5: Warning PSAvoidUsingInvokeExpression/.test(strip(r.out)) && /FAIL \[pwsh-base\/PSScriptAnalyzer 1\.25\.0\]/.test(r.out),
      'Invoke-Expression fails PSScriptAnalyzer naming scripts/bad.ps1:4', r.out);
    drop('scripts/bad.ps1');

    write('scripts/ugly.ps1', UGLY);
    r = h.check();
    h.step(r.code === 1 && /scripts\/ugly\.ps1:2:1: Warning PSUseConsistentIndentation/.test(r.out), 'two-space indentation fails the formatting check naming scripts/ugly.ps1', r.out);
    drop('scripts/ugly.ps1');

    write('scripts/supp.ps1', SUPPRESS(''));
    r = h.check();
    h.step(r.code === 1 && /scripts\/supp\.ps1:2:5: Error SuppressMessage: Justification/.test(r.out),
      'a SuppressMessage without Justification fails naming scripts/supp.ps1', r.out);
    write('scripts/supp.ps1', SUPPRESS(", Justification = 'fixture evaluates a trusted snippet'"));
    r = h.check();
    h.step(r.code === 0, 'a reasoned SuppressMessage suppresses the rule and passes', r.out);
    drop('scripts/supp.ps1');

    write('scripts/broken.ps1', 'function Broken {\n    if ($true {\n}\n');
    r = h.check();
    h.step(r.code === 1 && /scripts\/broken\.ps1:\d+:\d+: /.test(r.out), 'a parse error fails naming scripts/broken.ps1', r.out);
    drop('scripts/broken.ps1');

    r = h.check();
    h.step(r.code === 0, 'check.mjs passes again after the injections are removed', r.out);
  },
};
