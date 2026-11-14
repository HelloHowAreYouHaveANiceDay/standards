---
doc: agents
repo: <name>
---

# <repo> -- agent instructions

## Setup and commands
- <one line each: install, build, test, run>

## Conventions
- <one line each: repo-specific rules>

<!-- kit:sdlc-docs begin -->
<!-- Managed by the standards kit (sdlc-docs). Do not edit; append notes below the end marker. -->
## Docs of record
- README.md: what this is and how to run it.
- docs/specs/NNNN-slug.md: high-level specs (draft | approved | done).
- docs/decisions/NNNN-slug.md: decisions made after a spec was approved. Append-only.
- Current state: spec front matter + git log/tags + Linear. There is no STATUS.md.

## Rules
- Tasks are Linear DIM issues. Each cites `Spec: docs/specs/NNNN-slug.md@vN (AC ids)`.
- Read the issue body, then this file, then the cited spec's TL;DR, Decided, your ACs and Risks/Out.
  Binding: Decided, ACs, Out (Out items are hard no-gos). How it works is guidance: deviate with a reason logged in the PR body.
- HOW is yours: split/merge/reorder scopes, refactor, deviate from How it works -> decide and log one line with the reason in the PR body.
- WHAT is not: changing or cutting a [must] AC, a Decided item or an Out item -> mark the issue
  human-blocked; do not guess.
- Discovered work -> a new issue citing the same spec.
- Never set a spec to approved, never change appetite, never edit an approved spec's body.
- A docs/decisions/ file only for a choice that outlives the PR or cuts a [nice] AC (never copy a spec's Decided list); routine choices are one line in the PR body.
- New spec/ADR ids: next free number at PR time; rename on conflict.
<!-- kit:sdlc-docs end -->

## Notes from workers
<!-- One line each: friction you hit and the fix. -->
