# pwsh-base rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Stack: PowerShell scripts and modules (`*.ps1`, `*.psm1`, `*.psd1`). One tool: PSScriptAnalyzer, which is both linter
and formatting check. Requires PowerShell 7 (`pwsh`) and git; GitHub-hosted ubuntu-latest and windows-latest ship
`pwsh`. Windows PowerShell 5.1 cannot run the gate (the runner script itself parses on 5.1 and is only started by
`pwsh` in `check.json`).

Gate: `node .standards/check.mjs` runs `pwsh -NoProfile -File .standards/pwsh-base/lint.ps1`, which

1. installs PSScriptAnalyzer at the exact version in `.standards/pwsh-base/check.json` `tools` into the standards cache
   (`Save-Module -RequiredVersion`, imported by path from the cache, never installed globally; first run needs the
   PowerShell Gallery) and fails if the loaded version differs from the pin;
2. analyzes every `*.ps1`/`*.psm1`/`*.psd1` that git tracks or could add (not ignored), except `.standards/`, with
   `.standards/pwsh-base/PSScriptAnalyzerSettings.psd1`: all default rules plus PSPlaceOpenBrace, PSPlaceCloseBrace,
   PSUseConsistentIndentation (4 spaces, as base's `.editorconfig`), PSUseConsistentWhitespace, PSUseCorrectCasing.
   Every severity fails, including Information;
3. fails any `SuppressMessage` without a rule name or without `Justification`.

Findings print as `file:line:col: Severity Rule: message`. Formatting is checked, never auto-fixed in CI. Locally:
`Invoke-Formatter -ScriptDefinition (Get-Content -Raw f.ps1) -Settings .standards/pwsh-base/PSScriptAnalyzerSettings.psd1`
fixes indentation, braces and whitespace (review the diff).

## Code
- Suppress one rule at the narrowest scope, with a reason:
  `[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '', Justification = 'interactive installer prints to the console')]`
  placed on the function (or a `param()` block for a whole script). The first argument is the rule name (PSScriptAnalyzer
  reads it from the "category" slot); the `Justification` must be a real sentence (10+ characters).
- Write-Host is allowed (PSAvoidUsingWriteHost is excluded: it writes to the Information stream since PowerShell 5.0).
- There is no settings overlay: do not edit or shadow the vendored settings. Rule changes belong in a kit release.
- Unused suppressions are not detected by PSScriptAnalyzer; remove a suppression when the code it covered is gone.
- UTF-8 without BOM is the base default; PSScriptAnalyzer's PSUseBOMForUnicodeEncodedFile applies to files with
  non-ASCII characters: write them in ASCII (`\u` escapes / `[char]0x2014`) or suppress with a reason.

## Existing debt (adoption only)
PSScriptAnalyzer has no ratchet. Fix findings in the bootstrap PR; a rule that cannot be fixed is suppressed at its
narrowest scope with a reason.
