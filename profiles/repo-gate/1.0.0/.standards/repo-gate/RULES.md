# repo-gate rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

The baseline rule every repo the factory works on carries outside `sandbox` (factory spec section 9): the code host
gates, the factory only reads. Two halves:

- `CODEOWNERS.block`: the sensitive-paths block. Every line must sit in the repo's CODEOWNERS (any of
  `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS`), owned as written. A repo may add its own lines (e.g.
  `firebase.json`, `/functions/`); a later line that re-assigns a block pattern to someone else breaks the block.
- `ruleset.json`: the GitHub ruleset `sensitive-paths-gate` on the default branch. An existing ruleset is tightened to
  it, never loosened: its own bypass actors, extra rules and required checks stay.

Gates:

- In follower CI (`node .standards/check.mjs`): `gate.mjs --offline` checks the CODEOWNERS block. Offline, no token.
- Live (Hermes, the factory's `system check`): `node .standards/repo-gate/gate.mjs --repo <owner/name>
  --required <ci.required_checks + extra_checks> --factory-account <login>` reads the rules with `gh api` (GET only)
  and fails on any item below. An unreadable fact fails (exit 2); it is never a pass.

## Items
| item | rule |
|---|---|
| 1 | Active ruleset rules `pull_request` and `non_fast_forward` apply to the default branch, so the factory account can neither push directly nor force-push; their only bypass actor is the admin role; classic protection, if any, does not allow force pushes |
| 2 | CODEOWNERS carries every `CODEOWNERS.block` line, and a `pull_request` rule requires code-owner review |
| 3 | Every `pull_request` rule dismisses stale approvals on a new push (and classic protection, if it has reviews) |
| 4 | Up-to-date branches are not required (`strict_required_status_checks_policy` false; classic `strict` false) |
| 5 | Every `--required` context is a required status check (ruleset or classic); `/.github/` is CODEOWNERS-gated |
| 6 | The factory account's permission on the repo is not admin |

Archived repos fail (item 0): they cannot carry a rule; drop them from the factory config.
