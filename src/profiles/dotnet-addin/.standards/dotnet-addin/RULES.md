# dotnet-addin rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Pairs with `dotnet-base` (required; it carries the gate). For add-ins that multi-target `net48` (Revit 2024 and older)
next to current .NET. `addin.globalconfig` is picked up by `dotnet-base`'s `dotnet.props` and applies ONLY to
`net4*` / `netstandard*` target frameworks, so the modern targets keep the full rule set.

Relaxed (severity none) because the suggested API does not exist on .NET Framework:
- CA2249 `string.Contains(string, StringComparison)`; CA1845 / CA1846 span-based Concat / AsSpan;
  CA1837 `Environment.ProcessId`.

Not relaxed: nullable, unused usings, culture-sensitive APIs (CA1305/CA1310), everything else. Revit/Rhino API
references are the follower's concern (the gate builds what the repo builds). Add further relaxations only with a
measured hit and a new profile version.
