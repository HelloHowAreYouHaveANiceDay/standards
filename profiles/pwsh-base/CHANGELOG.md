# pwsh-base

PowerShell scripts and modules: PSScriptAnalyzer (default rules + formatting rules, all severities) pinned exactly,
installed into the standards cache by a vendored runner, plus a required reason on every `SuppressMessage`. Needs
PowerShell 7 (`pwsh`) and git on the runner. Pairs with base.

## 1.0.0

- First release (prior art: PSScriptAnalyzer's own settings docs and `Invoke-Formatter` rule set; GitHub-hosted
  ubuntu/windows runners preinstall PowerShell 7.6). Pin: PSScriptAnalyzer 1.25.0.
