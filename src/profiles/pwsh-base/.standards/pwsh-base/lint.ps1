#Requires -Version 5.1
# Vendored by HelloHowAreYouHaveANiceDay/standards (profile pwsh-base); do not edit -- re-run sync.
# Runs the exact-pinned PSScriptAnalyzer over the repo's PowerShell files. Needs only PowerShell and git.
#
#   pwsh -NoProfile -File .standards/pwsh-base/lint.ps1
#
# 1. Installs PSScriptAnalyzer at the version pinned in check.json "tools" into the standards cache
#    ($STANDARDS_CACHE, else %LOCALAPPDATA%\standards\cache, else $XDG_CACHE_HOME|~/.cache/standards) with
#    Save-Module -RequiredVersion, imports it from there by path (no global install), and verifies the version.
# 2. Analyzes every tracked or untracked-not-ignored *.ps1 / *.psm1 / *.psd1 outside .standards/ with the vendored
#    PSScriptAnalyzerSettings.psd1 (default rules + formatting rules, all severities: any finding fails).
# 3. Every [SuppressMessage] must name the rule (first argument) and carry a Justification of 10+ characters
#    (PSScriptAnalyzer cannot enforce this itself).
# Findings print as `<file>:<line>:<col>: <Severity> <Rule>: <message>`. Exit 0 clean, 1 findings, 2 setup failure.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Tag = 'pwsh-base'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Pin = (Get-Content -Raw -Path (Join-Path $PSScriptRoot 'check.json') | ConvertFrom-Json).tools.PSScriptAnalyzer
$MinJustification = 10

function Stop-Setup([string]$What) {
    Write-Output "standards: FAIL [$Tag/setup] $What"
    exit 2
}

function Get-CacheDir {
    if ($env:STANDARDS_CACHE) { return $env:STANDARDS_CACHE }
    if ($env:OS -eq 'Windows_NT') {
        $local = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME 'AppData\Local' }
        return Join-Path (Join-Path $local 'standards') 'cache'
    }
    $xdg = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path $HOME '.cache' }
    return Join-Path $xdg 'standards'
}

function Install-Analyzer([string]$Version) {
    $modules = Join-Path (Get-CacheDir) 'pwsh-modules'
    $target = Join-Path (Join-Path $modules 'PSScriptAnalyzer') $Version
    $manifest = Join-Path $target 'PSScriptAnalyzer.psd1'
    if (Test-Path -LiteralPath $manifest) { return $manifest }
    Write-Host "standards: installing PSScriptAnalyzer $Version into $modules"
    $tmp = Join-Path $modules ".tmp-$PID"
    try {
        New-Item -ItemType Directory -Path $tmp -Force | Out-Null
        Save-Module -Name PSScriptAnalyzer -RequiredVersion $Version -Repository PSGallery -Path $tmp -Force
        $saved = Join-Path (Join-Path $tmp 'PSScriptAnalyzer') $Version
        if (-not (Test-Path -LiteralPath (Join-Path $saved 'PSScriptAnalyzer.psd1'))) {
            Stop-Setup "Save-Module did not produce PSScriptAnalyzer $Version"
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        if (-not (Test-Path -LiteralPath $target)) { Move-Item -LiteralPath $saved -Destination $target }
    } catch {
        Stop-Setup "could not install PSScriptAnalyzer ${Version}: $($_.Exception.Message)"
    } finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
    }
    return $manifest
}

function Get-RelativePath([string]$Path) {
    $full = [System.IO.Path]::GetFullPath($Path)
    $base = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    if ($full.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)) {
        $full = $full.Substring($base.Length).TrimStart('\', '/')
    }
    return $full.Replace('\', '/')
}

# --- tool: pinned, from the cache, verified ---------------------------------------------------------------------
$manifest = Install-Analyzer $Pin
Remove-Module PSScriptAnalyzer -Force -ErrorAction SilentlyContinue
Import-Module -Name $manifest -Force
$loaded = (Get-Module PSScriptAnalyzer).Version.ToString()
if ($loaded -ne $Pin) { Stop-Setup "loaded PSScriptAnalyzer $loaded != pin $Pin" }

# --- files ------------------------------------------------------------------------------------------------------
$listed = & git -C $Root -c core.quotepath=off ls-files --cached --others --exclude-standard -- '*.ps1' '*.psm1' '*.psd1'
if ($LASTEXITCODE -ne 0) { Stop-Setup "git ls-files failed in $Root" }
$files = @($listed | Where-Object { $_ -and -not $_.StartsWith('.standards/') } | Sort-Object -Unique |
        Where-Object { Test-Path -LiteralPath (Join-Path $Root $_) -PathType Leaf })
if ($files.Count -eq 0) {
    Write-Output "standards: [$Tag] no PowerShell files -- skipped"
    exit 0
}

$findings = New-Object System.Collections.Generic.List[object]
function Add-Finding([string]$File, [int]$Line, [int]$Col, [string]$Text) {
    $findings.Add([pscustomobject]@{ File = $File; Line = $Line; Col = $Col; Text = "${File}:${Line}:${Col}: $Text" })
}
$settings = Join-Path $PSScriptRoot 'PSScriptAnalyzerSettings.psd1'
$suppress = [regex]'(^|\.)SuppressMessage(Attribute)?$'

foreach ($rel in $files) {
    $path = Join-Path $Root $rel

    foreach ($d in @(Invoke-ScriptAnalyzer -Path $path -Settings $settings)) {
        $line = if ($d.Line) { $d.Line } else { 1 }
        $col = if ($d.Column) { $d.Column } else { 1 }
        $rule = if ($d.RuleName) { $d.RuleName } else { 'ParseError' }
        Add-Finding $rel $line $col ('{0} {1}: {2}' -f $d.Severity, $rule, $d.Message)
    }

    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    $attrs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AttributeAst] -and $suppress.IsMatch($n.TypeName.Name) }, $true)
    foreach ($a in $attrs) {
        $const = {
            param($e)
            if ($e -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $e.Value.Trim() } else { '' }
        }
        $named = @{}
        foreach ($n in $a.NamedArguments) { $named[$n.ArgumentName] = & $const $n.Argument }
        # PSScriptAnalyzer reads the rule name from the first argument (the attribute's "Category" slot).
        $rule = if ($a.PositionalArguments.Count -ge 1) { & $const $a.PositionalArguments[0] } elseif ($named.ContainsKey('Category')) { $named['Category'] } else { '' }
        $just = if ($named.ContainsKey('Justification')) { $named['Justification'] } else { '' }
        $line = $a.Extent.StartLineNumber
        $col = $a.Extent.StartColumnNumber
        if (-not $rule) {
            Add-Finding $rel $line $col "Error SuppressMessage: name the suppressed rule (SuppressMessage('PSRuleName', '', Justification = '...'))"
        }
        if ($just.Length -lt $MinJustification) {
            Add-Finding $rel $line $col "Error SuppressMessage: Justification = '<why>' is required (a string of $MinJustification+ characters)"
        }
    }
}

if ($findings.Count -gt 0) {
    $findings | Sort-Object File, Line, Col, Text | ForEach-Object { Write-Output $_.Text }
    Write-Output "standards: [$Tag] $($findings.Count) finding(s) in $($files.Count) file(s) checked (PSScriptAnalyzer $Pin)"
    exit 1
}
Write-Output "standards: [$Tag] $($files.Count) file(s) clean (PSScriptAnalyzer $Pin)"
exit 0
