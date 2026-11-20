# UI design standard (`ui-kit`)

Applies to every STG property with a UI. One shared contract and naming scheme; each property keeps its own look
(its **pack**) unless it is listed as converging on the Broadsheet pack. Enforced offline by the `ui-kit` profile
(`.standards/ui-kit/lint.mjs`, rules UK1-UK8, see its RULES.md). Spec: wiki `projects/spec--ui-design-standard.md`.
This page is the review rubric for what the lint cannot check.

## 1. What a property has

```
design/
  pack.json        manifest: pack, prefix, version, themes, extensions, budgets, sources   (lint input)
  DESIGN.md        the pack's look, voice, budgets (own pack); absent for a converging repo
  tokens.css       own pack: public --ui-* assigned from private --<prefix>-*
                   converging repo: ONLY --ui-color-spot and declared extensions
  base.css         optional: focus, reduced-motion, element defaults
  vendor/<pack>/<version>/   converging repo: the pinned shared pack + SHA256SUMS
```

A profile never writes `design/`. A new pack starts from `.standards/ui-kit/templates/pack/` (a neutral grey pack that
passes the lint as copied once the prefix is set), so a property is conformant on day one and gets its look later.
Framework CSS that needs the tokens imports `design/tokens.css`; no copy.

## 2. Naming

`--ui-<category>-<role>[-<variant>][-<state>]` is the only thing app code reads. `--<prefix>-*` is private to the pack's
own token files; `--_*` is component-local. No aliases and no mapping file: when a name changes, the follower renames in
the same PR with `scripts/rename-tokens.mjs` (one commit, separate from any look change). Renaming a public name is a
major version of the pack. Full grammar: RULES.md.

## 3. Principles (every property, every pack)

| # | Principle | Checked by |
|---|---|---|
| P1 | **Roles, not values.** App code reads `--ui-*`; it writes no colour, font stack or size literal, reads no private name, redefines no `--ui-*` name. | UK5, UK6, UK8 |
| P2 | **Meaning is never hue alone.** State and status carry a word, an edge or a pattern (WCAG 1.4.1). | review |
| P3 | **Weight never carries state.** | review |
| P4 | **AA contrast floors.** Text and `text-muted` 4.5:1 on every surface role; `on-*` text 4.5:1 on its fill; borders, focus and `primary`/`spot` marks 3:1. AAA is a Broadsheet pack rule, not the org floor. | UK3 |
| P5 | **Visible focus.** `:focus-visible` uses `--ui-color-focus`, at least 2px, offset; `outline: none` only beside a replacement. | UK6 |
| P6 | **Motion is optional.** Behind `prefers-reduced-motion: no-preference`, or with a `reduce` override. | UK7 |
| P7 | **Budgets are declared and kept** (ink count, type sizes); the numbers are the pack's own. | UK4 |
| P8 | **One spacing grid**, 4px unit. | UK2 |
| P9 | **Touch targets** >= 24px (AA) and >= 44px under a coarse pointer. | UK2 (token), review |
| P10 | **One icon family per pack**; icon-only controls have an accessible name. | review |
| P11 | **Every mark earns its place.** | review |
| P12 | **Dark is a second assignment of the same names**, never component branches; it passes P4 again. Dark is optional per pack. | UK2, UK3 |

A pack may vary values, faces, radius, density, elevation, voice and declared extension roles. It may not vary the public
names and their meanings, the floors in P4-P6 and P9, or the 4px unit.

## 4. Review checklist (PRs that touch `design/` or UI code)

1. Do new colours/sizes appear only as `--ui-*` reads, with any raw literal carrying `ui-kit: raw-color -- <reason>`? (UK5)
2. Status, risk and state: is there a word, edge or pattern as well as a colour? (P2)
3. Does selected/active state change weight? It must not. (P3)
4. Tap targets under `pointer: coarse`: every control reaches `--ui-size-touch-min`. (P9)
5. Icon-only buttons: accessible name present; one icon family. (P10)
6. New extension role: declared in `pack.json` and described in `DESIGN.md` `## Extensions`; any `-ink`/`-text` reaches 4.5:1.
7. Does a dark theme exist? Then every colour role is assigned again and the lint passes there. (P12)
8. A converging repo changed only its spot and extensions, and did not edit `design/vendor/`.
9. Rename PRs: the codemod ran in its own commit, and smoke scripts and tests that match the old literals were updated.

## 5. Which properties converge

Each property has its own pack unless it is listed as converging on Broadsheet (bimisland home): the bim family
(pdfmarkuptool, bimisland, bim-cli, bimpdf-site), the pdf tools (pdfdifftool, pdfflattener, pdffillandsign) and
timeandmaterials. The portfolio list lives in the spec (section H); a pack is published for a second property only when a
second property adopts it. Who writes a new look: one design card per property, when it is next worked on.

## 6. Publishing ui.<domain>

Every property gets `ui.<its domain>`: a static page of its own pack, not a Storybook. Generate it with the kit's
zero-dep `.standards/ui-kit/ui-gen.mjs` (ui-kit 1.1.0), which reads `design/pack.json`, the token files and
`design/DESIGN.md`:

```
node .standards/ui-kit/ui-gen.mjs            # writes dist-ui/{index.html,pack.css,ui.css}
node .standards/ui-kit/ui-gen.mjs . --out build/ui
```

The page shows every `--ui-color-*` role as a swatch with the contrast of each contract pair in every declared theme
(computed by the same `contrast.mjs` function lint rule UK3 uses, so the page cannot show a pass the lint fails), the
type, space, radius, size and shadow tokens, a focus-ring demo and the reduced-motion note, the base elements styled by
the pack's own `base.css`, the extension roles, `## Voice` and `## Look` from `DESIGN.md`, a link to the optional
`"storybook"` URL in `pack.json` (an `https` URL; real Storybook stays only where a component library exists), and a
light/dark toggle when a non-light theme is selected by `[data-theme="..."]`. The layout is identical for every
property; only the pack's values differ. No external font or script is loaded. The one inline script is the toggle. The
generator exits 1 while the pack fails lint (the page is still written, with FAIL rows), so run it after
`node .standards/check.mjs`.

**Deploy recipe: Cloudflare Workers static assets** (the shape of bimisland `apps/ui`). The profile writes none of
these files; the follower adds them in its own PR.

`ui/wrangler.toml`:

```toml
name = "<property>-ui"
compatibility_date = "2025-01-01"

[assets]
directory = "../dist-ui"

# [build] runs before every deploy, dry-run and dev session
[build]
command = "node ../.standards/ui-kit/ui-gen.mjs .. --out dist-ui"
```

- Attach `ui.<domain>` once through the Cloudflare API (a custom domain on the worker), not as a `[[routes]]
  custom_domain` block: that block re-registers on every deploy and needs Zone:Edit, which a CI deploy token lacks.
- `workers_dev = true` serves a preview on `<name>.<account>.workers.dev` until the domain is attached.
- CI runs `wrangler deploy` on pushes to main that touch `design/**` (and the `ui/` folder); a PR runs
  `wrangler deploy --dry-run` so a broken pack fails before merge.
- Check the live page after deploy: fetch `https://ui.<domain>/` and assert it contains the pack name and version.
- A converging property publishes its page from its own `design/` (the vendored Broadsheet plus its spot), so the page
  shows Broadsheet with that property's spot colour. Broadsheet's own page is served from bimisland `apps/ui`.

## 6b. Brand and logo (ui-kit 1.2.0, UK9-UK12)

Brand is a layer on the same pack, not a separate profile. Every property keeps its own brand; the org sets the rules
below and one brand-book shape (RULES.md "Brand"; wiki `projects/spec--brand-standard.md`). `ui-gen.mjs` renders the
property's `brand.html` from the real files, and that page is what the owner reviews.

### Org misuse list (R7), rendered on every brand page

Never: stretch or squash the mark; rotate or tilt it; outline it; add shadows, glows or gradients; place it inside
another shape; use a colour outside the pack tokens; put it on a busy or low-contrast background; redraw or retype it;
set it inside a sentence. A property lists only its own extra don'ts under `## Logo` in DESIGN.md.

### Review rubric (not lintable)

Every new or changed mark, spot colour or name needs libo or pyline's approval on the generated brand page. An Opus
design card proposes two directions (each as `design/brand/` files plus `brand.html`, screenshots in the PR); the owner
picks one; a Sonnet card applies it. Judge it by:

1. Does the mark read at 16px?
2. Does it work in one colour?
3. Is it unique within the category? Search competitors' marks; uniqueness matters more than fame.
4. Is it built from a stated grid or simple shapes?
5. Is it free of look-alikes to a well-known mark?
6. Does it match the property's voice (plain, warm, quiet; the name cased exactly as in `brand.name`)?

Codifying an existing mark (moving files into `design/brand/` and recolouring to token values with no visible change)
needs no review; its PR carries before/after screenshots of the header and favicon. Images use the property's own
screenshots, data and diagrams, never a third party's mark; the og image is 1200x630 with the mark or lockup and the page
title in pack colours. Each property names 1-3 distinctive assets in `brand.assets` and keeps them; changing one needs an
evidence-based reason and an owner decision.

## 7. Sources

WCAG 2.2 (1.4.1, 1.4.3, 1.4.11, 2.3.3, 2.4.7, 2.4.13, 2.5.5, 2.5.8); Broadsheet design decisions D2-D7; naming shapes follow
Carbon (`text-secondary`, `background-hover`), Polaris (`bg-surface-secondary-hover`) and SLDS 2 (`on-surface-2`); DTCG name
rule for the character set.
