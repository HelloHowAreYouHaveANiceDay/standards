# ruby-base

Ruby (e.g. SketchUp extensions): RuboCop 1.92.2 + rubocop-sketchup 2.2.0 for lint and Layout formatting, the whole gem
closure exact-pinned and installed into the standards cache by a zero-dependency node runner (uses the Ruby already on
PATH; no Bundler or Gemfile). Follower `.rubocop.yml` inherits the vendored one. Pairs with base.

## 1.0.0

- First release (prior art: rubocop-sketchup README, RuboCop docs "Configuration"). Pins: rubocop 1.92.2,
  rubocop-sketchup 2.2.0 + dependency closure. Gate: `policy` (follower config inherits the vendored one; every
  `rubocop:disable` carries a reason; no `rubocop:todo`), `rubocop` (no autocorrect). TargetRubyVersion 3.2
  (SketchUp 2024-2026). No type checker (open fork).
