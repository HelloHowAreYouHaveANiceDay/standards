// dotnet-base + dotnet-addin fixture: a clean multi-targeted (net10.0 + net48) C# follower passes with the runner's own
// SDK (no tool download); each injected defect fails naming its file. The addin relaxation is proven both ways:
// Process.GetCurrentProcess().Id (CA1837) passes under net48 and fails under net10.0.
import fs from 'node:fs';
import path from 'node:path';

const PROGRAM = `namespace Fixture;

public static class Program
{
    public static int Main()
    {
        System.Console.WriteLine("ok");
#if NETFRAMEWORK
        // Environment.ProcessId does not exist on net48: dotnet-addin turns CA1837 off for that target only.
        System.Console.WriteLine(System.Diagnostics.Process.GetCurrentProcess().Id);
#endif
        return 0;
    }
}
`;
const csproj = (extra = '') => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFrameworks>net10.0;net48</TargetFrameworks>
${extra}  </PropertyGroup>
</Project>
`;
const NULL_DEREF = 'namespace Fixture;\n\npublic static class Bad\n{\n    public static string? Maybe() => null;\n\n    public static int Len() => Maybe().Length;\n}\n';
const UNUSED_USING = 'using System.Linq;\n\nnamespace Fixture;\n\npublic static class Spare\n{\n    public static int One() => 1;\n}\n';
const UGLY = 'namespace Fixture;\npublic class   Ugly {  public int X  =1; }\n';
const PRAGMA_NO_REASON = 'namespace Fixture;\n\npublic static class Prag\n{\n#pragma warning disable CA1822\n    public static void P() { }\n#pragma warning restore CA1822\n}\n';
const PROCESS_ID_MODERN = 'namespace Fixture;\n\npublic static class Pid\n{\n    public static int Get() => System.Diagnostics.Process.GetCurrentProcess().Id;\n}\n';

export const fixture = {
  id: 'dotnet-base',
  profiles: ['base@1.0.0', 'dotnet-base@1.0.0', 'dotnet-addin@1.0.0'],
  files: {
    'global.json': '{\n  "sdk": { "version": "10.0.100", "rollForward": "latestFeature" }\n}\n',
    'Directory.Build.props': '<Project>\n  <Import Project="$(MSBuildThisFileDirectory).standards/dotnet-base/dotnet.props" />\n</Project>\n',
    'src/Fixture.csproj': csproj(),
    'src/Program.cs': PROGRAM,
  },
  inject: (dir, h) => {
    const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const w = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    const cases = [
      ['src/Bad.cs', NULL_DEREF, (o) => /src[\\/]Bad\.cs\(\d+,\d+\): error CS8602/.test(o), 'a possible null dereference fails the build (CS8602) naming src/Bad.cs'],
      ['src/Spare.cs', UNUSED_USING, (o) => /src[\\/]Spare\.cs\(1,1\): error IDE0005/.test(o), 'an unused using fails the build (IDE0005) naming src/Spare.cs'],
      ['src/Ugly.cs', UGLY, (o) => /src[\\/]Ugly\.cs\(\d+,\d+\): error WHITESPACE/.test(o), 'badly formatted code fails dotnet format whitespace naming src/Ugly.cs'],
      ['src/Prag.cs', PRAGMA_NO_REASON, (o) => /src\/Prag\.cs:5: .*has no reason/.test(o), 'a reasonless #pragma warning disable fails naming src/Prag.cs:5'],
      ['src/Pid.cs', PROCESS_ID_MODERN, (o) => /src[\\/]Pid\.cs\(\d+,\d+\): error CA1837/.test(o), 'CA1837 still fails on net10.0 (dotnet-addin relaxes net4x only)'],
    ];
    for (const [rel, body, ok, msg] of cases) {
      w(rel, body);
      const r = h.check();
      h.step(r.code === 1 && ok(strip(r.out)), msg, `exit ${r.code}\n${r.out}`);
      fs.rmSync(path.join(dir, rel));
    }
    const proj = path.join(dir, 'src/Fixture.csproj');
    fs.writeFileSync(proj, csproj('    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>\n'));
    let r = h.check();
    h.step(r.code === 1 && /src\/Fixture\.csproj:5: .*TreatWarningsAsErrors=false/.test(strip(r.out)), 'TreatWarningsAsErrors=false in a csproj fails wiring naming src/Fixture.csproj:5', r.out);
    fs.writeFileSync(proj, csproj());
    fs.writeFileSync(path.join(dir, 'Directory.Build.props'), '<Project>\n</Project>\n');
    r = h.check();
    h.step(r.code === 1 && /Directory\.Build\.props: .*does not <Import>/.test(strip(r.out)), 'a Directory.Build.props without the import fails wiring naming it', r.out);
    fs.writeFileSync(path.join(dir, 'Directory.Build.props'), '<Project>\n  <Import Project="$(MSBuildThisFileDirectory).standards/dotnet-base/dotnet.props" />\n</Project>\n');
    r = h.check();
    h.step(r.code === 0, 'check.mjs passes again after the injections are removed', r.out);
  },
};
