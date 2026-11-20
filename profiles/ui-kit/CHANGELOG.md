# ui-kit

The org UI design standard: one shared token contract (role names, WCAG AA floors for contrast, focus, motion and touch
targets, a 4px grid) and a naming standard, applied to every property's own brand pack (spec: wiki
`projects/spec--ui-design-standard.md`). `lint.mjs` rules UK1-UK8 read the follower's `design/pack.json`. Pairs with base.

## 1.1.1

- `ui-gen.mjs` `<title>` used a non-ASCII middle dot; it now emits `&middot;`. Every vendored ui-kit file is pure ASCII (kit test `profile-ui-kit-ascii`), because followers run ASCII-only tests over the repo.
- `scripts/rename-tokens.mjs` (kit script, not vendored) accepts `"unprefixed"` / `"unprefixedKeep"` tables for own-pack followers whose names predate prefixes (`--ink`, `--bg`): exact-name renames, and any other declared unprefixed name is refused.

## 1.1.0

- New `ui-gen.mjs`: zero-dep generator for the `ui.<domain>` page (`dist-ui/`): colour swatches with per-theme contrast of the contract pairs, type/space/radius/size/shadow tokens, focus and reduced-motion demo, base elements, extension roles, Voice and Look from `DESIGN.md`, optional Storybook link, theme toggle when the pack declares dark.
- New `contrast.mjs`: the colour parser, ratio and `pairResults()`/`inkResults()` shared by `lint.mjs` (UK3) and `ui-gen.mjs`, so the page cannot show a pass the lint fails. `lint.mjs` behaviour is unchanged except UK1 now rejects a non-https `"storybook"` in `pack.json`; it also exports `subst`, `isExtensionName` and an `out.model` hand-off.
- `docs/ui-kit.md` section "Publishing ui.<domain>" (Cloudflare Workers static assets recipe, docs only).

## 1.0.0

- First release. `contract.json` (required `--ui-*` roles, contrast pairs, floors), zero-dep `lint.mjs`:
  UK1 pack manifest and vendored-pack checksums (FAIL), UK2 required roles per theme / 4px space / touch 44px / focus
  ring 2px (FAIL), UK3 AA contrast pairs per theme (FAIL), UK4 ink and type-size budgets (WARN), UK5 colour literals
  outside the pack (WARN), UK6 `:focus-visible` reading `--ui-color-focus` (FAIL; `outline: none` without one WARN),
  UK7 motion with no reduced-motion guard (FAIL), UK8 naming: `--ui-<category>-<role>[-<variant>][-<state>]`, declared
  extensions, private `--<prefix>-*` only in token files, `--_*` locals (FAIL).
- `templates/pack/` (neutral grey pack: `pack.json`, `tokens.css`, `base.css`, `DESIGN.md`) that the adopting card copies
  to `design/`; the profile never writes `design/` itself.
- Kit script `scripts/rename-tokens.mjs`: applies a per-pack old->new table in one pass and refuses unmapped names.
- UK4 and UK5 are WARN here and flip to FAIL in 2.0.0 once wave 1 is clean.
