@{
    # Vendored by HelloHowAreYouHaveANiceDay/standards (profile pwsh-base); do not edit -- re-run sync.
    # PSScriptAnalyzer settings: every default rule, every severity, plus the formatting rules (formatting is
    # checked here, never auto-fixed in CI). Indentation matches base's .editorconfig ([*.ps1] indent_size = 4).
    IncludeDefaultRules = $true
    Severity            = @('Error', 'Warning', 'Information')

    # Write-Host writes to the Information stream since PowerShell 5.0 (it can be captured and redirected), so the
    # rule's rationale is obsolete; installers and CLI scripts print to the console on purpose.
    ExcludeRules        = @('PSAvoidUsingWriteHost')

    Rules               = @{
        PSPlaceOpenBrace           = @{
            Enable             = $true
            OnSameLine         = $true
            NewLineAfter       = $true
            IgnoreOneLineBlock = $true
        }

        PSPlaceCloseBrace          = @{
            Enable             = $true
            NewLineAfter       = $false
            IgnoreOneLineBlock = $true
            NoEmptyLineBefore  = $false
        }

        PSUseConsistentIndentation = @{
            Enable              = $true
            Kind                = 'space'
            IndentationSize     = 4
            PipelineIndentation = 'IncreaseIndentationForFirstPipeline'
        }

        PSUseConsistentWhitespace  = @{
            Enable                                  = $true
            CheckInnerBrace                         = $true
            CheckOpenBrace                          = $true
            CheckOpenParen                          = $true
            CheckOperator                           = $true
            CheckPipe                               = $true
            CheckPipeForRedundantWhitespace         = $false
            CheckSeparator                          = $true
            CheckParameter                          = $false
            IgnoreAssignmentOperatorInsideHashTable = $true
        }

        PSUseCorrectCasing         = @{
            Enable = $true
        }
    }
}
