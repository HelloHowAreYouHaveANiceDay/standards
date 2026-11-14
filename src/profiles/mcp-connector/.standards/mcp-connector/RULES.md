# mcp-connector rules (vendored from the standards kit; do not edit)

Gate: `node .standards/mcp-connector/connector.mjs` (run by `node .standards/check.mjs`). Offline, no network.
Each finding prints as `<file>: M<n> <what>`. Read GUIDELINES.md next to this file for the reasons.
Scaffold the follower-owned files with `node .standards/mcp-connector/connector.mjs --scaffold`; fill the `{{...}}` markers by hand.

| Id | Level | Rule |
|---|---|---|
| M1 | MUST | `connector/manifest.json` exists, parses, `schemaVersion` is 1, and has name, title, endpoint (https), auth (none or oauth), protocolVersions (non-empty, YYYY-MM-DD), directories, links.docs, links.privacy, links.support, data.collected, data.retention, data.training (boolean), tools (non-empty). |
| M2 | MUST | Each tool: name matches `^[a-z][a-z0-9_]{0,63}$` and is unique; title non-empty; description 20-1024 characters. |
| M3 | MUST | Class and annotations agree: read needs readOnlyHint true and destructiveHint false; write needs readOnlyHint false; sensitive_write needs readOnlyHint false and destructiveHint true. All four hints are booleans. |
| M4 | MUST | No read/write catch-all: a read tool has `transaction: false` and no input property named `method`, `http_method` or `verb` (unless it is an enum of GET, HEAD, OPTIONS). Split the tool instead. |
| M5 | MUST | Titles and descriptions contain no model-instruction pattern (`ignore previous`, `system prompt`, `always call`, `do not tell the user`, `<important>`). Reword: describe what the tool does, not how the model should behave. |
| M6 | MUST | inputSchema and outputSchema have `type: "object"`; inputSchema sets `additionalProperties: false`; every input property has a description. |
| M7 | MUST | A tool with `transaction: true` is `sensitive_write`, requires an `idempotency_key` string input, and the manifest has a non-empty `testMode`. |
| M8 | MUST | `connector/docs.md` and `connector/privacy.md` exist; no `{{` placeholder is left in them or the manifest; docs.md names every tool; privacy.md mentions retention and training. |
| M9 | MUST | Each tool lists at least one error; codes match `^[a-z][a-z0-9_]*$` and are unique per tool; `rateLimit` is non-empty. |
| M10 | MUST | No word from `wording.forbidden` appears (whole word, case-insensitive) in any tool title or description. Docs are not scanned: disclaimers legitimately negate these words. |

## Live, not gated

`connector.mjs --live <url> [--call <tool> '<json args>']` runs a contract test against a running endpoint. It is never part of the gate.

| Id | Rule |
|---|---|
| L1 | `initialize` with the manifest's first protocol version returns a protocolVersion that is in the manifest list and `capabilities.tools`; `notifications/initialized` gets HTTP 202. |
| L2 | `tools/list` returns exactly the manifest's tool names, with equal title, annotations and inputSchema per tool. |
| L3 | An unknown method returns JSON-RPC error -32601. |
| L4 | `--call` returns a result with a `content` array and, when the manifest tool's outputSchema has properties, a `structuredContent` holding every `required` key. |
