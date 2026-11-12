// pwsh-base 1.0.0: key properties of the released files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realProfileFiles } from './helpers.mjs';

const files = realProfileFiles('pwsh-base', '1.0.0');
const text = (f) => files[f].toString('utf8');
const fragment = JSON.parse(text('.standards/pwsh-base/check.json'));

test('ships exactly the runner, settings, rules doc and fragment under .standards/pwsh-base/', () => {
  assert.deepEqual(Object.keys(files).sort(), [
    '.standards/pwsh-base/PSScriptAnalyzerSettings.psd1',
    '.standards/pwsh-base/RULES.md',
    '.standards/pwsh-base/check.json',
    '.standards/pwsh-base/lint.ps1',
  ]);
});

test('PSScriptAnalyzer is pinned exactly; no ranges', () => {
  assert.deepEqual(fragment.tools, { PSScriptAnalyzer: '1.25.0' });
  assert.match(fragment.tools.PSScriptAnalyzer, /^\d+\.\d+\.\d+$/);
  assert.equal(fragment.version, '1.0.0');
  assert.ok(fragment.commands[0].tool.includes(fragment.tools.PSScriptAnalyzer));
});

test('the gate is one pwsh command running the vendored runner, from the repo root, no shell strings', () => {
  assert.equal(fragment.commands.length, 1);
  const run = fragment.commands[0].run;
  assert.equal(run[0], 'pwsh');
  assert.ok(run.includes('-NoProfile') && run.includes('-File'));
  assert.equal(run.at(-1), '.standards/pwsh-base/lint.ps1');
  assert.ok(!run.includes('-Command'));
});

test('runner installs the pin into the cache by version, verifies it, never autofixes', () => {
  const ps = text('.standards/pwsh-base/lint.ps1');
  assert.match(ps, /Save-Module -Name PSScriptAnalyzer -RequiredVersion \$Version/);
  assert.match(ps, /loaded PSScriptAnalyzer \$loaded != pin \$Pin/);
  assert.match(ps, /STANDARDS_CACHE/);
  assert.match(ps, /Justification/);
  assert.doesNotMatch(ps, /-Fix\b|Invoke-Formatter|Install-Module/);
  assert.match(ps, /exit 1/);
});

test('settings: default rules + formatting rules on, every severity, 4-space indentation', () => {
  const s = text('.standards/pwsh-base/PSScriptAnalyzerSettings.psd1');
  assert.match(s, /IncludeDefaultRules\s*=\s*\$true/);
  assert.match(s, /Severity\s*=\s*@\('Error', 'Warning', 'Information'\)/);
  for (const r of ['PSPlaceOpenBrace', 'PSPlaceCloseBrace', 'PSUseConsistentIndentation', 'PSUseConsistentWhitespace', 'PSUseCorrectCasing']) {
    assert.match(s, new RegExp(`${r}\\s*=\\s*@\\{\\s*\\n\\s*Enable\\s*=\\s*\\$true`), r);
  }
  assert.match(s, /IndentationSize\s*=\s*4/);
  assert.match(s, /ExcludeRules\s*=\s*@\('PSAvoidUsingWriteHost'\)/);
});
