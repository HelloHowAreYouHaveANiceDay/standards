// c-base fixture: a clean C/C++ follower (own code formatted, vendored code ignored via .clang-format-ignore),
// then injected defects: each must fail the gate naming the file.
import fs from 'node:fs';
import path from 'node:path';

const MAIN_C = '#include <stdio.h>\n\n#include "util.h"\n\nint main(void) {\n  printf("%d\\n", twice(21));\n  return 0;\n}\n';
const UTIL_H = '#ifndef UTIL_H_\n#define UTIL_H_\n\nint twice(int x);\n\n#endif  // UTIL_H_\n';
const UTIL_CC = '#include "util.h"\n\nint twice(int x) { return 2 * x; }\n';
// Deliberately badly formatted, but vendored: .clang-format-ignore must keep it out of the gate.
const VENDORED = 'int   vendored( void ){return 1;}\n';

const UNFORMATTED_C = 'int  add(int a,int b){return a+b;}\n';
const UNFORMATTED_CPP = 'namespace   demo{\nint   one(){return 1;}\n}\n';
const OFF_NO_REASON = 'int a;\n// clang-format off\nint   b  =  1;\n// clang-format on\n';
const OFF_NEVER_ON = 'int a;\n// clang-format off: aligned table\nint   b  =  1;\n';
const OFF_WITH_REASON = 'int a;\n// clang-format off: aligned table\nint   b  =  1;\n// clang-format on\nint c;\n';

export const fixture = {
  id: 'c-base',
  profiles: ['base@1.0.0', 'c-base@1.0.0'],
  files: {
    '.clang-format-ignore': '# fixture: third-party code, not ours\nthird_party/**\n',
    // vendored AND carries an unreasoned `clang-format off`: ignored files are skipped by the marker check too.
    'third_party/marker.h': '// clang-format off\nint   m;\n',
    'src/main.c': MAIN_C,
    'src/util.h': UTIL_H,
    'src/util.cc': UTIL_CC,
    'third_party/vendored.c': VENDORED,
  },
  inject: (dir, h) => {
    const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const cases = [
      ['src/bad.c', UNFORMATTED_C, (o) => /src[\\/]bad\.c:1:\d+: error: code should be clang-formatted/.test(o) && /FAIL \[c-base\/clang-format 23\.1\.5\]/.test(o), 'an unformatted C file fails clang-format naming src/bad.c:1'],
      ['src/bad.cpp', UNFORMATTED_CPP, (o) => /src[\\/]bad\.cpp:1:\d+: error: code should be clang-formatted/.test(o), 'an unformatted C++ file fails clang-format naming src/bad.cpp:1'],
      ['src/off.c', OFF_NO_REASON, (o) => /^src\/off\.c:2: `clang-format off` needs a reason/m.test(o), 'a reasonless `clang-format off` fails naming src/off.c:2'],
      ['src/never.c', OFF_NEVER_ON, (o) => /^src\/never\.c:2: `clang-format off` is never switched back on/m.test(o), 'a `clang-format off` never switched on fails naming src/never.c:2'],
    ];
    for (const [rel, body, ok, msg] of cases) {
      fs.writeFileSync(path.join(dir, rel), body);
      const r = h.check();
      h.step(r.code === 1 && ok(strip(r.out)), msg, `exit ${r.code}\n${r.out}`);
      fs.rmSync(path.join(dir, rel));
    }
    fs.writeFileSync(path.join(dir, 'src/ok.c'), OFF_WITH_REASON);
    let r = h.check();
    h.step(r.code === 0, 'a reasoned `clang-format off` ... `on` block passes', r.out);
    fs.rmSync(path.join(dir, 'src/ok.c'));
    fs.writeFileSync(path.join(dir, 'src/crlf.c'), 'int x;\r\n');
    r = h.check();
    h.step(r.code === 1 && /src[\\/]crlf\.c:1:/.test(r.out), 'a CRLF file fails clang-format (LineEnding: LF) naming src/crlf.c', r.out);
    fs.rmSync(path.join(dir, 'src/crlf.c'));
    r = h.check();
    h.step(r.code === 0, 'check.mjs passes again after the injections are removed', r.out);
  },
};
