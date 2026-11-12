# dotnet-addin

Relaxations for add-ins that multi-target net48 (Revit/Rhino): four analyzer rules whose fix needs an API absent from
.NET Framework are off for `net4*`/`netstandard*` targets only. Requires dotnet-base.

## 1.0.0

- First release. Relaxed: CA2249, CA1845, CA1846, CA1837 (measured on revit-cli, net48 target).
