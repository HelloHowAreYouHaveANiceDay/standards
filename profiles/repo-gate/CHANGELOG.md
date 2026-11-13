# repo-gate

The factory baseline rule (spec section 9) as data: the sensitive-paths CODEOWNERS block, the `sensitive-paths-gate`
ruleset, and `gate.mjs`, which verifies a repo against both (`--offline`: the CODEOWNERS block in follower CI; `--repo`:
the live rules via `gh api`, what the factory's `system check` and Hermes run). Not a language profile: pairs with base.

## 1.0.0

- First release (factory slice 15). Block = the 2026-10-29 sensitive-paths policy (`/.github/`, `/.github/CODEOWNERS`,
  `wrangler.toml`, `auth/`, `*secret*`, `migrations/`). Ruleset = deletion + non_fast_forward + pull_request with
  code-owner review, stale approvals dismissed, no approval count, admin-role bypass. Items 1-6 as in RULES.md.
