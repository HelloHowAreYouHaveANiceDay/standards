# dotnet-base rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Stack: C# on the .NET SDK. One compiler+analyzers pass (`dotnet build`), one whitespace formatter (`dotnet format
whitespace`). No tool is installed: the SDK pinned by `global.json` is used (GitHub-hosted runners ship 8/9/10; use
`actions/setup-dotnet` with `global-json-file` when the pin is not preinstalled).

Gate: `node .standards/check.mjs` runs `wiring` -> `suppressions` -> `format` -> `build`. CI never fixes anything.
Locally: `dotnet format whitespace . --folder` (rewrites).

## Setup (follower-owned)
- `global.json`: exact `sdk.version` >= `tools.dotnet-sdk-min` in `check.json`, `rollForward: latestFeature` (runner
  images carry no exact patch).
- Every `.csproj` has a `Directory.Build.props` above it containing (MSBuild reads only the NEAREST one):
  `<Import Project="$(MSBuildThisFileDirectory).standards/dotnet-base/dotnet.props" />`
- `dotnet.props` sets Nullable, `AnalysisLevel` 10.0-recommended (a newer SDK adds no rules until the profile bumps it),
  `EnforceCodeStyleInBuild`, and `TreatWarningsAsErrors` (directory-scoped; never pass `-warnaserror`, it also reaches
  ProjectReferences in another repo's SDK). `dotnet.globalconfig` turns on IDE0005 (unused usings) and IDE0079 (unused
  suppressions).
- The gate builds every tracked `.sln`/`.slnx`, else every `.csproj`. Projects that need vendor DLLs (Revit, Rhino) must
  restore/build on the CI runner or be excluded by listing a `.sln` that omits them.

## Overrides (always with a reason)
- Severity: a line in the repo's own `.editorconfig`: `dotnet_diagnostic.CA1707.severity = none` with a comment above it.
- `NoWarn` in a project file needs an XML comment on the same or previous line. `TreatWarningsAsErrors=false`,
  `WarningsNotAsErrors` and `Nullable=disable` in project files fail `wiring`.
- `#pragma warning disable <ID> // why` and `[SuppressMessage(..., Justification = "why")]`; reasonless ones fail
  `suppressions`; stale ones fail the build (IDE0079).
- Whitespace/charset follow the root `.editorconfig` from `base` (utf-8, LF, 2-space; `*.cs` overrides in that file).
