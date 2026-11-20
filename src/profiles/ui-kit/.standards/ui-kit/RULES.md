# ui-kit rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

The org UI standard: one token contract and naming scheme shared by every property, each property keeping its own look
(its "pack"). Gate: `node .standards/ui-kit/lint.mjs`, run by `node .standards/check.mjs`; offline, no network. The
profile writes only `.standards/ui-kit/`; the follower owns `design/`. Starting point for a new pack:
`.standards/ui-kit/templates/pack/` (copy it to `design/`). Review rubric: the kit's `docs/ui-kit.md`.

| Rule | 1.1.0 | Fails when | Source |
|---|---|---|---|
| UK1 | FAIL | `design/pack.json` is missing or malformed; a file it names is missing; an optional `"storybook"` is not an https URL; a vendored pack's files differ from its `SHA256SUMS`, or its `pack.json` name/version differs from the pin | spec N, D |
| UK2 | FAIL | a required role is missing in a declared theme (dark themes assign every colour again), or a colour has alpha or cannot be read; `--ui-space-*` is not a 4px multiple; `--ui-size-touch-min` < 44px; `--ui-size-focus-ring` < 2px | WCAG 2.5.5, 2.4.13; spec B |
| UK3 | FAIL | a contrast pair is under its floor in any declared theme: `text`, `text-muted` vs `background` and `panel` 4.5; `border` vs `background` 3; `on-primary`/`primary` 4.5 and `primary` vs `background` 3; `on-alert`/`alert` 4.5 and `alert` vs `background` 4.5; `spot`, `focus` vs `background` 3; any extension ending `-ink` or `-text` vs `background` 4.5 | WCAG 1.4.3, 1.4.11 |
| UK4 | WARN | distinct colours in a theme exceed `budgets.inks`, or distinct font sizes exceed `budgets.sizes` | spec A (P7) |
| UK5 | WARN | a colour literal (`#hex`, `rgb()`, `hsl()`) in `sources` outside the pack files, without `ui-kit: raw-color -- <reason>` on its line or the line above | spec A (P1) |
| UK6 | FAIL / WARN | FAIL: no `:focus-visible` rule reads `var(--ui-color-focus)`. WARN: `outline: none\|0` in a file with no `:focus-visible` | WCAG 2.4.7 |
| UK7 | FAIL | `transition`, `animation` or `scroll-behavior: smooth` with no `prefers-reduced-motion` anywhere in the pack files and sources | WCAG 2.3.3 |
| UK8 | FAIL | a token name outside the naming shapes below; an undeclared `--ui-*` extension; in `sources`: a read of a private `--<prefix>-*` or of an undeclared `--ui-*`, a declaration or reassignment of a `--ui-*` name, or any declared custom property other than `--_*` | spec N |

UK4 and UK5 are WARN in 1.0.0 and flip to FAIL in 2.0.0 once the first wave of followers is clean. Only names declared in
the repo are checked, so third-party reads (`--tw-*`, Radix, Storybook) pass.

## Naming (UK8)

```
public:   --ui-<category>-<role>[-<variant>][-<state>]    read by app code
private:  --<prefix>-<name>                                read only by the pack's own token files
local:    --_<name>                                        component scratch, never in a token file
```

- Categories (closed list): `color font font-size space size radius shadow`. Adding one is a minor release.
- Order is role, variant, state. Variants: `muted subtle strong` or a step number. States, always last: `hover active
  selected disabled`. `on-<role>` is the text colour on a `<role>` fill.
- Lowercase kebab, segments `[a-z0-9]+`. The prefix is 2-5 letters, set in `pack.json`; `ui` is reserved.
- A pack's domain scale (cmfz `risk`, Broadsheet `series`) is declared by name under `extensions` in `pack.json`:
  `--ui-color-risk-1`, `--ui-color-risk-1-ink`. Undeclared `--ui-*` names fail.

## Required roles (`contract.json`)

`--ui-color-` `background panel text text-muted line border primary on-primary alert on-alert spot focus`;
`--ui-font-sans` (`serif`, `mono` optional); `--ui-space-1` .. `--ui-space-6`; `--ui-size-touch-min`, `--ui-size-focus-ring`.

## pack.json

Own pack: `{pack, prefix, version, themes: {light: [selectors], dark?: [selectors]}, extensions, budgets: {inks, sizes},
tokens: [files], base?: [files], sources: [globs]}`. Converging pack (vendored shared pack, e.g. Broadsheet): `{pack,
version, vendor: "design/vendor/<pack>/<version>", tokens: [own file], extensions, sources}`; themes, prefix and budgets
come from the vendored `pack.json`, and the follower's own tokens set only `--ui-color-spot` and its declared extensions.
The vendored folder carries `SHA256SUMS` over every file but itself.

A theme entry is a selector (`:root`, `:root[data-theme="dark"]`) or an at-rule prelude plus selector
(`@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`). `tokens` files are read in order, later wins.

## Rename codemod (kit script, not vendored)

`node <kit>/scripts/rename-tokens.mjs --table <table.json> [--root <repo>] [--write]` rewrites a pack's old names to the new
ones from a fixed table (`{from: "<old prefix>", map: {old: new}, keep: [...]}`) and refuses, writing nothing, when an old-prefix name
is not in `map` or `keep`. Run it as one commit, separate from any look change.

## ui.<domain> page (`ui-gen.mjs`)

`node .standards/ui-kit/ui-gen.mjs [repo-root] [--out dist-ui]` writes `index.html`, `pack.css` and `ui.css`: swatches with the contrast of each contract pair per theme (the same `contrast.mjs` functions UK3 calls), type/space/radius/size tokens, focus and reduced-motion demo, base elements, extension roles, `## Voice` and `## Look` from `design/DESIGN.md`, the optional `storybook` link and a theme toggle when a non-light theme is selected by `[data-theme="..."]`. Exit 1 while the pack fails lint (page still written). Deploy recipe: the kit's `docs/ui-kit.md` "Publishing ui.<domain>".
