# ruby-base rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Stack: Ruby, e.g. SketchUp extensions. One tool for lint and format: RuboCop with `rubocop-sketchup`, exact-pinned
(with its whole gem dependency closure) in `.standards/ruby-base/check.json`.
Gate: `node .standards/check.mjs` runs, in order: `policy` -> `rubocop` (lint + Layout, `--cache false`).
CI never fixes. Locally: `node .standards/ruby-base/tool.mjs run rubocop -a` (safe autocorrect with the pinned
RuboCop).

## Setup (one follower-owned file)
- Root `.rubocop.yml`:
  ```yaml
  inherit_from: .standards/ruby-base/rubocop.yml
  AllCops:
    SketchUp:
      SourcePath: extension   # where the extension sources live (default: src)
  ```
  The `policy` step fails when the root `.rubocop.yml` is missing or does not inherit the vendored one.
- Ruby is NOT installed by the profile: it needs a Ruby >= 3.3 on PATH (preinstalled on GitHub-hosted
  `ubuntu-latest` and `windows-latest`; elsewhere `ruby/setup-ruby`). `RUBY=<path>` overrides. Ruby 3.2 also works
  but compiles `prism` from source (needs a C compiler). RuboCop's own Ruby is independent of `TargetRubyVersion`.
- The gems are installed with `gem install` into the standards cache (`$STANDARDS_CACHE`, else
  `%LOCALAPPDATA%\standards\cache` / `~/.cache/standards`), keyed by pins + Ruby ABI + platform; no Bundler, no
  Gemfile, nothing global. Drop `rubocop*` from the follower's own Gemfile unless pinned identically.
- `TargetRubyVersion: 3.2` = the Ruby embedded in SketchUp 2024-2026. Override in `.rubocop.yml` if you target older.

## Rules
RuboCop defaults with `NewCops: enable` (safe because the version is pinned) and `rubocop-sketchup` departments
Bugs, Deprecations, Performance, Suggestions on. Requirements (Extension Warehouse submission rules) are off: turn
them on in `.rubocop.yml` if you ship there. Switched off as taste / thresholds, not defects: `Metrics`,
`Style/Documentation`, `Style/FrozenStringLiteralComment`, `Naming/MethodParameterName`,
`Lint/AmbiguousOperatorPrecedence`. `Layout/EndOfLine` is `lf` on every OS.

## Overrides (native RuboCop, in the follower's `.rubocop.yml`, below `inherit_from`)
- Change a cop: `Style/SomeCop: Enabled: false` or its parameters, with a comment saying why. Exclude paths with
  `Exclude:` on the cop (paths resolve from the root `.rubocop.yml`).
- Suppress one line: `# rubocop:disable Cop/Name -- reason`. The `policy` step fails a disable without ` -- reason`,
  `Lint/RedundantCopDisableDirective` fails a disable that suppresses nothing.
- `rubocop:todo` and `.rubocop_todo.yml` are refused by `policy`.

## Existing debt (adoption only)
- RuboCop has no ratchet: fix every finding in the bootstrap PR (`run rubocop -a`, then `-A` reviewed, then by hand).
- Type checking (Sorbet / Steep) is not part of this profile.
