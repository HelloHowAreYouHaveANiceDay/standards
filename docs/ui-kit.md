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

## 6. Sources

WCAG 2.2 (1.4.1, 1.4.3, 1.4.11, 2.3.3, 2.4.7, 2.4.13, 2.5.5, 2.5.8); Broadsheet design decisions D2-D7; naming shapes follow
Carbon (`text-secondary`, `background-hover`), Polaris (`bg-surface-secondary-hover`) and SLDS 2 (`on-surface-2`); DTCG name
rule for the character set.
