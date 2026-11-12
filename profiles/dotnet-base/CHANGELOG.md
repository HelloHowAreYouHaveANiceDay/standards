# dotnet-base

C# gate on the repo's own pinned .NET SDK: a vendored `dotnet.props` (Nullable, AnalysisLevel 10.0-recommended,
EnforceCodeStyleInBuild, directory-scoped TreatWarningsAsErrors, IDE0005/IDE0079 on), a zero-dependency runner that
checks the wiring (global.json pin, props imported by every csproj, no gate overrides in project files), suppression
reasons, `dotnet format whitespace --verify-no-changes` and `dotnet build`. Pairs with base.

## 1.0.0

- First release (prior art: .NET SDK AnalysisLevel/EnforceCodeStyleInBuild docs, dotnet/runtime Directory.Build.props).
  Pin: SDK >= 10.0.100 (global.json exact, `rollForward: latestFeature`). No tool is downloaded.
