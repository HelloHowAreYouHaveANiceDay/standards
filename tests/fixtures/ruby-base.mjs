// ruby-base fixture: a clean Ruby follower passes with the real pinned RuboCop + rubocop-sketchup (gems installed into
// the standards cache by the vendored runner, using the Ruby on PATH); each injected defect fails naming its file.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const GREETER = `module Fixture
  # Builds greetings.
  class Greeter
    def initialize(name)
      @name = name
    end

    def greet
      "Hello, #{@name}"
    end
  end
end
`;

export const fixture = {
  id: 'ruby-base',
  profiles: ['base@1.0.0', 'ruby-base@1.0.0'],
  files: {
    '.gitignore': '.rubocop_cache/\n',
    '.rubocop.yml': 'inherit_from: .standards/ruby-base/rubocop.yml\n',
    'src/greeter.rb': GREETER,
  },
  prepare: () => {
    const r = spawnSync(process.env.RUBY || 'ruby', ['-e', 'exit(RUBY_VERSION >= "3.2" ? 0 : 1)'], { windowsHide: true });
    if (r.error || r.status !== 0) { console.log('ruby-base fixture: no Ruby >= 3.2 on PATH, skipped'); return false; }
    return true;
  },
  inject: (dir, h) => {
    // the policy step reads `git ls-files`, so every injected file is staged while it is checked
    const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); h.git('add', '-A'); };
    const rm = (rel) => { fs.rmSync(path.join(dir, rel)); h.git('add', '-A'); };
    const cases = [
      ['src/unused.rb', 'def run\n  x = 1\n  2\nend\n', (o) => /src[\\/]unused\.rb:2:\d+: W: .*Lint\/UselessAssignment/.test(o), 'an unused local variable fails RuboCop naming src/unused.rb:2'],
      ['src/ugly.rb', 'x = {  :a=>1 }\nputs x\n', (o) => /src[\\/]ugly\.rb:1:\d+: C: .*Layout\//.test(o), 'badly formatted code fails a Layout cop naming src/ugly.rb'],
      ['src/api.rb', 'def run\n  Sketchup.active_model.start_operation("x")\nend\n', (o) => /src[\\/]api\.rb:2:\d+: .*Sketchup/.test(o), 'a SketchUp API misuse fails a rubocop-sketchup cop naming src/api.rb:2'],
      ['src/bare.rb', 'x = 1 # rubocop:disable Lint/UselessAssignment\nputs 1\n', (o) => /FAIL \[ruby-base\/policy\] src\/bare\.rb:1: rubocop:disable needs a reason/.test(o), 'a rubocop:disable without a reason fails the policy step naming src/bare.rb:1'],
      ['src/stale.rb', 'y = 2 # rubocop:disable Style/GlobalVars -- not needed\nputs y\n', (o) => /src[\\/]stale\.rb:1:\d+: .*Lint\/RedundantCopDisableDirective/.test(o), 'a rubocop:disable that suppresses nothing fails RedundantCopDisableDirective naming src/stale.rb'],
      ['src/todo.rb', 'puts 1 # rubocop:todo Style/Foo\n', (o) => /src\/todo\.rb:1: rubocop:todo is not allowed/.test(o), 'a rubocop:todo fails the policy step naming src/todo.rb'],
    ];
    for (const [rel, body, ok, msg] of cases) {
      put(rel, body);
      const r = h.check();
      h.step(r.code === 1 && ok(r.out), msg, `exit ${r.code}\n${r.out}`);
      rm(rel);
    }
    put('src/reasoned.rb', '$count = 0 # rubocop:disable Style/GlobalVars -- legacy counter read by the host\n');
    let r = h.check();
    h.step(r.code === 0, 'a reasoned rubocop:disable that suppresses a real finding passes', r.out);
    rm('src/reasoned.rb');

    const orig = fs.readFileSync(path.join(dir, '.rubocop.yml'));
    fs.writeFileSync(path.join(dir, '.rubocop.yml'), 'AllCops:\n  TargetRubyVersion: 3.2\n');
    r = h.check();
    h.step(r.code === 1 && /FAIL \[ruby-base\/policy\] \.rubocop\.yml: does not inherit/.test(r.out), 'a .rubocop.yml that does not inherit the vendored config fails naming .rubocop.yml', r.out);
    fs.writeFileSync(path.join(dir, '.rubocop.yml'), orig);

    put('.rubocop_todo.yml', '# generated\n');
    r = h.check();
    h.step(r.code === 1 && /FAIL \[ruby-base\/policy\] \.rubocop_todo\.yml: not allowed/.test(r.out), 'a .rubocop_todo.yml fails the policy step', r.out);
    rm('.rubocop_todo.yml');

    r = h.check();
    h.step(r.code === 0, 'check.mjs passes again after the injections are removed', r.out);
  },
};
