# mcp-connector

Directory guidelines, four templates and one zero-dependency checker for a remote MCP connector (a read, write or
sensitive-write tool server that AI assistants such as Claude, ChatGPT and Muse can call). The follower owns
`connector/manifest.json` (tools, annotations, schemas, errors, data use); `connector.mjs` checks it offline with rules
M1-M10 and can run an optional live contract test (L1-L4) against a running `/mcp` endpoint. `--scaffold` copies the
templates when absent and never overwrites. Pairs with base.

## 1.0.0

- First release. Files: GUIDELINES.md (directory rules distilled, each with its source and a "not re-checked" note where
  the source could not be re-read), RULES.md, templates for manifest, docs, privacy section and submission packet, and
  connector.mjs (offline M1-M10, `--scaffold`, `--live` with `--call`). The live check is never part of the gate.
