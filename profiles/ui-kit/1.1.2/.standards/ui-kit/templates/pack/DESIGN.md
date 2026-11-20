# Design: <property>

Copied from the ui-kit profile's `templates/pack/`. A property is conformant on day one with the neutral grey pack and
gets its look later: replace the primitives in `tokens.css`, keep the public `--ui-*` assignments, and write the
sections below. The lint (`node .standards/ui-kit/lint.mjs`) reads `pack.json`, `tokens.css` and `base.css`.

## Look

What the property looks like and why: palette, faces, radius, density, elevation. One short paragraph per choice.

## Voice

How the product writes: tone, person, words it uses and avoids. A few real examples.

## Budgets

The numbers in `pack.json` `budgets`: how many distinct colours (`inks`) and font sizes (`sizes`) the pack allows
itself, and the reason for each.

## Extensions

Domain roles beyond the contract, one line each, matching `extensions` in `pack.json`
(for example `risk` -> `--ui-color-risk-1` .. `--ui-color-risk-5` and `--ui-color-risk-1-ink`). An extension ending
`-ink` or `-text` must reach 4.5:1 on the background.
