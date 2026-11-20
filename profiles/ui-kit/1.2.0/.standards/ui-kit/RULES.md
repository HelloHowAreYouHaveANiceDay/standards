# ui-kit rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

The org UI standard: one token contract and naming scheme shared by every property, each property keeping its own look
(its "pack"). Gate: `node .standards/ui-kit/lint.mjs`, run by `node .standards/check.mjs`; offline, no network. The
profile writes only `.standards/ui-kit/`; the follower owns `design/`. Starting point for a new pack:
`.standards/ui-kit/templates/pack/` (copy it to `design/`). Review rubric: the kit's `docs/ui-kit.md`.

| Rule | 1.2.0 | Fails when | Source |
|---|---|---|---|
| UK1 | FAIL | `design/pack.json` is missing or malformed; a file it names is missing; an optional `"storybook"` is not an https URL; a vendored pack's files differ from its `SHA256SUMS`, or its `pack.json` name/version differs from the pin | spec N, D |
| UK2 | FAIL | a required role is missing in a declared theme (dark themes assign every colour again), or a colour has alpha or cannot be read; `--ui-space-*` is not a 4px multiple; `--ui-size-touch-min` < 44px; `--ui-size-focus-ring` < 2px | WCAG 2.5.5, 2.4.13; spec B |
| UK3 | FAIL | a contrast pair is under its floor in any declared theme: `text`, `text-muted` vs `background` and `panel` 4.5; `border` vs `background` 3; `on-primary`/`primary` 4.5 and `primary` vs `background` 3; `on-alert`/`alert` 4.5 and `alert` vs `background` 4.5; `spot`, `focus` vs `background` 3; any extension ending `-ink` or `-text` vs `background` 4.5 | WCAG 1.4.3, 1.4.11 |
| UK4 | WARN | distinct colours in a theme exceed `budgets.inks`, or distinct font sizes exceed `budgets.sizes` | spec A (P7) |
| UK5 | WARN | a colour literal (`#hex`, `rgb()`, `hsl()`) in `sources` outside the pack files, without `ui-kit: raw-color -- <reason>` on its line or the line above | spec A (P1) |
| UK6 | FAIL / WARN | FAIL: no `:focus-visible` rule reads `var(--ui-color-focus)`. WARN: `outline: none\|0` in a file with no `:focus-visible` | WCAG 2.4.7 |
| UK7 | FAIL | `transition`, `animation` or `scroll-behavior: smooth` with no `prefers-reduced-motion` anywhere in the pack files and sources | WCAG 2.3.3 |
| UK8 | FAIL | a token name outside the naming shapes below; an undeclared `--ui-*` extension; in `sources`: a read of a private `--<prefix>-*` or of an undeclared `--ui-*`, a declaration or reassignment of a `--ui-*` name, or any declared custom property other than `--_*` | spec N |
| UK9 | WARN when no `brand` block; FAIL when present but wrong | the `brand` block is malformed (no `name`, `clearspace` outside 0.25-1, `min_px` under 16, a `colors` entry the pack does not declare, a `served` target outside `design/brand/`), or a required file is missing (`mark.svg`, `mark-mono.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `og.png`, and `logo-mono.svg` when `logo.svg` exists) | brand spec R2, R4, R5 |
| UK10 | FAIL | an SVG master is not well-formed XML, has no root `<svg viewBox>`, or has `<script>`, `on*=`, `<foreignObject>`, `<image>`, `<text>` or an external `href`/`url(http`; a `fill`/`stroke`/`stop-color` in `mark.svg`/`logo.svg` is not `none`, `currentColor` or a hex equal to a `brand.colors` token (light theme); a `-mono` file uses anything but `currentColor`/`none` | brand spec R3, R6 |
| UK11 | FAIL | from the PNG/ICO headers: `apple-touch-icon.png` is not 180x180, `icon-192.png` not 192x192, `icon-512.png` not 512x512, `og.png` not 1200x630, `favicon.ico` has no 32x32 entry, or a file is not the format its extension says | brand spec R10 |
| UK12 | FAIL | a `brand.served` path is missing or not byte-equal (sha256) to its `design/brand/` master | brand spec R12 |

UK4 and UK5 are WARN in 1.0.0 and flip to FAIL in 2.0.0 once the first wave of followers is clean. Only names declared in
the repo are checked, so third-party reads (`--tw-*`, Radix, Storybook) pass. A missing `brand` block (UK9) is WARN until
2.0.0 too, so a follower does not go red on a minor bump.

## Brand (UK9-UK12)

A property's brand book is data in its repo: logo files with fixed names in `design/brand/` plus a `brand` block in
`design/pack.json` (own and converging packs alike). Nothing is configurable but the block.

```
design/brand/
  mark.svg  mark-mono.svg                          required (mono = currentColor only)
  logo.svg  logo-mono.svg                          optional lockup; if logo.svg exists, logo-mono.svg is required
  favicon.ico (has 32x32)  apple-touch-icon.png (180x180)  icon-192.png  icon-512.png  og.png (1200x630)   required
```

```json
"brand": {
  "name": "checkmyfloodzone",
  "wordmark": { "font": "--ui-font-sans", "weight": 700 },
  "clearspace": 0.5,
  "min_px": 16,
  "colors": ["--ui-color-primary", "--ui-color-text"],
  "assets": ["water-line mark", "risk scale colours"],
  "served": { "public/favicon.svg": "design/brand/mark.svg", "public/og-default.png": "design/brand/og.png" }
}
```

- `name` is the display name, used with exactly this casing. `clearspace` is a fraction of the mark height (0.25-1,
  default 0.5). `min_px` is the mark height in px (at least 16, default 16). `wordmark` names the font token for the text
  lockup, used only when there is no `logo.svg`. `assets` are the 1-3 distinctive assets the property keeps.
- `colors` lists tokens the pack declares. Fills and strokes in `mark.svg`/`logo.svg` must equal their light-theme
  values, so a token change fails UK10 until the logo changes with it.
- `served` maps each path the site serves to its master in `design/brand/`; UK12 compares sha256, so the master is the
  only copy anyone edits.
- Not checked: taste, uniqueness, og byte size, per-theme logo contrast (the generated brand page shows it).
- A profile never vendors binary files. `node .standards/ui-kit/placeholder-rasters.mjs [out-dir]` writes a neutral
  placeholder `favicon.ico`, touch icon, 192/512 icons and `og.png` for a new property; replace them with renders of the
  real mark. The template's `brand/` folder has the placeholder `mark.svg` and `mark-mono.svg`.

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

Optional keys (1.1.2): `exclude: [globs]` removes files from `sources` before UK5/UK8 read them (default `**/*.test.*`,
`**/*.spec.*`, `**/__fixtures__/**`; setting it replaces the default). `hostSet: [role, ...]` lists kebab role names
(`"size-range-steps"` = `--ui-size-range-steps`) that the pack documents as set by the host in source files; UK8 lets
`sources` declare or `setProperty()` only those `--ui-*` names, still never any other public name.

A theme entry is a selector (`:root`, `:root[data-theme="dark"]`) or an at-rule prelude plus selector
(`@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`). `tokens` files are read in order, later wins.

## Rename codemod (kit script, not vendored)

`node <kit>/scripts/rename-tokens.mjs --table <table.json> [--root <repo>] [--write]` rewrites a pack's old names to the new
ones from a fixed table (`{from: "<old prefix>", map: {old: new}, keep: [...]}`) and refuses, writing nothing, when an old-prefix name
is not in `map` or `keep`. Run it as one commit, separate from any look change.

## ui.<domain> page (`ui-gen.mjs`)

`node .standards/ui-kit/ui-gen.mjs [repo-root] [--out dist-ui]` writes `index.html`, `pack.css` and `ui.css`: swatches with the contrast of each contract pair per theme (the same `contrast.mjs` functions UK3 calls), type/space/radius/size tokens, focus and reduced-motion demo, base elements, extension roles, `## Voice` and `## Look` from `design/DESIGN.md`, the optional `storybook` link and a theme toggle when a non-light theme is selected by `[data-theme="..."]`. With a `brand` block (1.2.0) it also writes `brand.html` (logo on every theme with the variant chosen and its contrast, clear space, minimum size, colour, the misuse grid rendered from the real mark, icons, og, `## Logo`/`## Imagery`/`## Assets` from DESIGN.md), copies `design/brand/*` to `<out>/brand/`, and links it from `index.html`. Output is pure ASCII. Exit 1 while the pack fails lint, UK9-UK12 included (pages still written). Deploy recipe: the kit's `docs/ui-kit.md` "Publishing ui.<domain>".
