# sdlc-docs

The SDLC document standard (spec `_design-sdlc-docs/SPEC-v4.md`, section 3) as a kit profile: templates for README.md,
AGENTS.md (with the `kit:sdlc-docs` block), the CLAUDE.md shim, a spec and an ADR, plus one zero-dependency checker,
`docs.mjs`, with five rules (R1 files, R2 front matter, R3 status, R4 ids, R5 approved specs). Pairs with base.
`docs.mjs --scaffold` copies templates that are absent and never overwrites; it only refreshes the AGENTS.md kit block.

## 1.0.0

- First release. Rules R1-R5 as in the spec; stricter readings where the spec is ambiguous: `0000-*` templates never
  count as specs, a missing or non-blank "What you need to decide now" fails an approved/done spec, appetite must be
  positive, ADR date must be YYYY-MM-DD, any non-draft status is held to the approved rules.

## 1.1.0

- SDLC spec v5 (S12). AGENTS.md kit block: binding = Decided, ACs, Out; How it works is guidance (deviate with a reason in the PR body); no spike label; ADRs only for choices that outlive the PR or cut a [nice] AC. Spec template: How it works marked "guidance -- not binding", [must]/[nice] tiering guidance, tuning numbers as "configurable, default X". Checker (docs.mjs) unchanged; AGENTS.md kit block is refreshed by `--scaffold`/sync bump.
