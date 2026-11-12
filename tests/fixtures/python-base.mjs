// python-base fixture: a clean Python follower passes with the real pinned Ruff (downloaded + sha256-verified into the
// standards cache); each injected defect fails naming its file.
import fs from 'node:fs';
import path from 'node:path';

const MAIN = `"""Fixture app."""

import sys


def first(items: list[str]) -> str:
    return items[0] if items else ""


if __name__ == "__main__":
    sys.stdout.write(first(sys.argv[1:]) + "\\n")
`;

export const fixture = {
  id: 'python-base',
  profiles: ['base@1.0.0', 'python-base@1.0.0'],
  files: {
    '.gitignore': '.ruff_cache/\n__pycache__/\n',
    'pyproject.toml': '[project]\nname = "fixture"\nversion = "0.0.0"\nrequires-python = ">=3.11"\n',
    'ruff.toml': '# fixture overrides\nextend = ".standards/python-base/ruff.toml"\n',
    'app/main.py': MAIN,
  },
  inject: (dir, h) => {
    const put = (rel, body) => fs.writeFileSync(path.join(dir, rel), body);
    const rm = (rel) => fs.rmSync(path.join(dir, rel));
    const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const cases = [
      ['app/unused.py', 'import os\n', (o) => /app[\\/]unused\.py:1:\d+: F401/.test(o) && /FAIL \[python-base\/ruff 0\.17\.4 check\]/.test(o), 'an unused import fails ruff check naming app/unused.py:1'],
      ['app/mut.py', 'def f(x=[]):\n    return x\n', (o) => /app[\\/]mut\.py:1:\d+: B006/.test(o), 'a mutable default argument (bugbear) fails naming app/mut.py'],
      ['app/old.py', 'from typing import Optional\n\n\ndef f(x: Optional[int]) -> int:\n    return x or 0\n', (o) => /app[\\/]old\.py:\d+:\d+: (UP045|UP007)/.test(o), 'a legacy Optional[...] (pyupgrade) fails naming app/old.py'],
      ['app/blanket.py', 'import json  # noqa\n\njson.dumps({})\n', (o) => /app[\\/]blanket\.py:1:\d+: PGH004/.test(o), 'a blanket `# noqa` fails PGH004 naming app/blanket.py'],
      ['app/stale.py', 'x = 1  # noqa: F401\n', (o) => /app[\\/]stale\.py:1:\d+: RUF100/.test(o), 'an unused `# noqa: F401` fails RUF100 naming app/stale.py'],
      ['app/ugly.py', 'x = {  "a":1 }\n', (o) => /FAIL \[python-base\/ruff 0\.17\.4 format\]/.test(o) && /app[\\/]ugly\.py/.test(strip(o)), 'an unformatted file fails ruff format --check naming app/ugly.py'],
    ];
    for (const [rel, body, ok, msg] of cases) {
      put(rel, body);
      const r = h.check();
      h.step(r.code === 1 && ok(strip(r.out)), msg, `exit ${r.code}\n${r.out}`);
      rm(rel);
    }
    put('app/reasoned.py', 'import json  # noqa: F401\n');
    const ok = h.check();
    h.step(ok.code === 0, 'a `# noqa: F401` that suppresses a real finding passes', ok.out);
    rm('app/reasoned.py');

    const orig = fs.readFileSync(path.join(dir, 'ruff.toml'));
    put('ruff.toml', '# forgot to extend the profile\n[lint]\nselect = ["F"]\n');
    let r = h.check();
    h.step(r.code === 1 && /FAIL \[python-base\/config\] ruff\.toml: does not set extend = "\.standards\/python-base\/ruff\.toml"/.test(r.out), 'a ruff.toml that does not extend the vendored config fails', r.out);
    rm('ruff.toml');
    r = h.check();
    h.step(r.code === 1 && /FAIL \[python-base\/config\] .*pyproject\.toml|FAIL \[python-base\/config\] no Ruff config/.test(r.out), 'a missing ruff.toml fails the config step', r.out);
    fs.writeFileSync(path.join(dir, 'ruff.toml'), orig);

    put('app/ruff.toml', '[lint]\nselect = ["F"]\n');
    r = h.check();
    h.step(r.code === 1 && /FAIL \[python-base\/config\] app\/ruff\.toml: nested Ruff config without `extend`/.test(r.out), 'a nested ruff.toml that does not extend fails, naming app/ruff.toml', r.out);
    put('app/ruff.toml', 'extend = "../ruff.toml"\n');
    r = h.check();
    h.step(r.code === 0, 'a nested ruff.toml that extends the root one passes', r.out);
    rm('app/ruff.toml');

    r = h.check();
    h.step(r.code === 0, 'check.mjs passes again after the injections are removed', r.out);
  },
};
