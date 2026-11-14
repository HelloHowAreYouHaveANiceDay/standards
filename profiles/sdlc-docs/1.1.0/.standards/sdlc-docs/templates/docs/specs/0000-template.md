---
id: 0000                  # 4 digits, equals filename prefix; next free id at PR time
title: <short title>
status: draft             # draft | approved | done
approved:                 # chat agent only: <approved_by> YYYY-MM-DD <link to owner's message>
appetite:                 # required once approved: number, USD; owner's number, set by the chat agent at approval
                          # (spend = factory events x cost-table; workers report nothing)
version: v1               # bump on each amendment after approval
reason:                   # when done: shipped | superseded by NNNN | abandoned: <why>
linear_project:           # optional
---

# <title>

<!-- Sections marked (required) are checked. Delete any other section if empty. Cap about 2,500 words. -->

## TL;DR
<!-- (required) 5 bullets, one idea each. -->

## What you need to decide now
<!-- (required) <=3 items: question / Recommendation / If not. Must be empty to approve. -->

## What the user sees
<!-- The finished thing, described as if it already shipped. -->

## Decided
<!-- (required) D1.. one line each: decision + why. Chat-time decisions only; post-approval ones go to docs/decisions/. -->

## How it works (guidance -- not binding)
<!-- Start with "In short:". Guidance: workers may deviate with a reason logged in the PR body. Tuning numbers read "configurable, default X", never as requirements. -->

## Acceptance criteria
<!-- (required) One per line: id + tag + EARS. Tag each [must] or [nice].
     [must] = security, isolation, taint, approvals, data-locality; [nice] = UX polish, convenience. Only Decided, ACs and Out are binding.
     Tuning numbers are config defaults: write "configurable, default X", not a requirement.
     Workers may cut a [nice] AC (ADR in docs/decisions/); changing or cutting a [must] AC is human-blocked.
     Every [must] AC is cited by >=1 issue (slicing worker) and closed (rechecked at the done flip). Unknowns as [NEEDS CLARIFICATION: ...]. -->
- AC1 [must] WHEN <trigger> THE SYSTEM SHALL <response>.
- AC2 [nice] WHEN <trigger> THE SYSTEM SHALL <response>.

## Build order (hints -- the slicing worker defines the scopes)
<!-- (required) Suggested slices only; not a contract. Progress lives in Linear. -->
| # | Slice hint | ACs | Done when |
|---|------------|-----|-----------|

## Metrics

## Risks / Out
<!-- Name known rabbit holes. Out items are hard no-gos for workers. -->

## Moving parts

## Glossary

## Changelog
<!-- After approval only: YYYY-MM-DD vN D-id ACs-affected one-line why. -->
