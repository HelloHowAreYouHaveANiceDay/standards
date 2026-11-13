# cost-table

The portfolio price list (spec `_design-sdlc-docs/SPEC-v4.md`, "Appetite and the cost table"): model rows
($/Mtok input, output, cache read, cache write, each with `source` URL and `checked` date), subscription shadow
multipliers and runner rows. Data plus `table.mjs` (validate, exact-id lookup that throws on an unknown model, list
cost). Vendored by dim-factory as its pricing source, not by every repo.

## 1.0.0

- First release. Anthropic and OpenAI rows from the vendors' price pages (2026-11-13); cache write = 5-minute write
  (Anthropic) / 30-minute write (OpenAI). `claude-haiku-5-5` carries its over-100k-token tier. Subscription
  multipliers are provisional 1.0 (list cost). Runner rows are 0 / not measured (round 1).
