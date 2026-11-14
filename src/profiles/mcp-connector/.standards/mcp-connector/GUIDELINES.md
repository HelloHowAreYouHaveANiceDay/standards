# MCP connector guidelines

Distilled from the directory rules below, read on 2026-11-14. Directory rules change; re-read the source before a
submission. Anything not re-read is marked "(not re-checked 2026-11-14)". `connector.mjs` enforces the checkable parts
as rules M1-M10 (see RULES.md).

## 1. Tool classes

Every tool is one of three classes, recorded as `class` in `connector/manifest.json`:

- read: retrieves information without changing data, account state or permissions.
- write: creates, changes or deletes data, changes permissions, or acts on the user's behalf.
- sensitive_write: irreversible or consequential actions, such as a purchase or sending an email.

A tool that combines reads and writes is a write. Never hide a send, share, publish or payment action in a tool described
as a read. Muse approves sensitive writes on every use ("Allow once" or "Deny"), and they cannot be set to Always allow.
Split catch-all tools: Claude rejects a single tool that accepts both safe HTTP methods (GET, HEAD, OPTIONS) and unsafe
ones (POST, PUT, PATCH, DELETE), and documenting the difference in the description does not satisfy it (rule M4).
Sources: Muse connector guidelines 3.2-3.3 (https://platform.muse.ai/docs); Claude connector pre-submission checklist,
"Separate read and write tools" (https://claude.com/docs/connectors/building/review-criteria).

## 2. Annotations

Every tool has a `title` and the applicable hints: `readOnlyHint: true` for read-only tools, `destructiveHint: true` for
tools that modify or delete data. Claude uses them to decide auto-permissions: read-only tools can run without per-call
confirmation, destructive tools always prompt. Set all four hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint`) so clients never guess; the checker requires them (M3).
Source: Claude checklist, "Provide tool annotations".

## 3. Names and descriptions

Tool names are 64 characters or fewer (M2). A description states precisely what the tool does and when to use it, and
matches the tool's behavior. Do not tell the model how to behave: Claude rejects descriptions that instruct it to call
software the user did not request, interfere with other tools, pull instructions from external sources, hide or encode
instructions, override system instructions or promote products. Muse likewise requires factual descriptions (M5).
A tool that takes freeform paths, queries or request bodies must name the API it targets in its description.
Sources: Claude checklist, "Keep tool names short", "Write narrow, accurate descriptions", "Avoid prompt-injection
patterns", "Reference API docs in custom query tools"; Muse 3.2.

## 4. Value beyond a web page

Muse can already browse websites. Its guideline says a read-only connector can qualify when the information is the
outcome, and a wrapper around public pages or a list of links alone is not enough. Return structured content with the
answer, not links to it. Claude also requires that an MCP server call your own first-party APIs (or APIs you legitimately
proxy) and that its domain match your service.
Sources: Muse 1.2; Claude checklist, "API ownership".

## 5. Completing tasks and transactions

Muse expects a connector to complete the tasks it starts inside the chat; sending the user to finish the whole checkout
does not meet its completion requirement. Before a commitment, show the seller, the total and currency, taxes and fees,
payment timing and cancellation terms. Do not call a checkout link, cart or pending request a confirmed booking.
Distinguish quoted, pending, confirmed, failed and cancelled states. Check the original action's status before retrying,
and prevent duplicates and double charges: require an `idempotency_key` on every transaction tool (M7). Support the
confirmations, status checks, changes, cancellations and refunds the service offers, and give users a support route.
Sources: Muse 1.1, section 2 table. Section 4.7 (Transactions) was not re-read in full (not re-checked 2026-11-14).

## 6. Approval scope

Connecting an account does not authorize every action. For an action that needs approval, execute only what the user
approved. If a detail such as the price, recipient or scope changes after approval, request a fresh approval. Do not add
products, tips, subscriptions or fees without authorization.
Source: Muse 3.4.

## 7. Data minimization

Ask for the minimum data each tool needs. Use it only to fulfil the request and to provide, maintain, secure, support and
improve the connector as your privacy policy says. Muse does not permit secondary uses: no selling, no unrelated
advertising, no unrelated profiles, no inferring sensitive characteristics, no model training. Retain data only as long
as necessary and delete it when it is no longer needed or on request. Claude adds: do not collect conversation data
beyond what a tool needs, and do not query Claude's memory, chat history or user files. The privacy policy must say what
is collected, why, who receives it, how long it is kept, that it is not used for training, and how to ask for deletion
(the privacy template and rule M8 cover this).
Sources: Muse 4.2; Claude checklist, "Functional quality". The Muse Connector Platform Terms were not re-read
(not re-checked 2026-11-14).

## 8. Regulated advice

Do not present output as legal, insurance, financial or medical advice unless you are authorized to, and keep a
disclaimer in tool output. Put the words you must not use in `wording.forbidden` so the checker scans every tool title
and description (M10); the disclaimer itself can negate those words, which is why docs and results are not scanned.
Source: Muse Connector Platform Terms (not re-checked 2026-11-14). Muse 4.3 separately requires accurate descriptions of
identity, capabilities, pricing and results.

## 9. Test mode

Reviewers need a dedicated test account and representative data. For transaction tools, explain how to test checkout
without real charges, in `testMode` in the manifest and in the submission packet (M7).
Source: Muse 5.5 (test user credentials and demo); Claude checklist, "Gather what to include with your submission" (test
credentials required).

## 10. Directory notes

- Claude: anyone on a paid Claude plan (Pro, Max, Ultra, Team, Enterprise) can submit through the developer portal at
  claude.ai/directory/manage; submit a remote MCP server as an MCP connector. A submission is scanned automatically and by
  default listed as a Community connector; Anthropic may escalate it to Verified review. Not accepted: connectors that
  transfer money, cryptocurrency or other financial assets, or generate images, video or audio through AI models. Public
  documentation is required by the publish date. Sources: https://claude.com/docs/directory/publish,
  https://claude.com/docs/connectors/building/review-criteria; the Software Directory Policy
  (https://support.claude.com/en/articles/13145358) was not re-read (not re-checked 2026-11-14).
- ChatGPT: the Checkout API reference (https://developers.openai.com/plugins/build/monetization) describes in-chat checkout
  with a `test` payment mode. The claim that approval is limited to physical-goods purchases and that external checkout is
  recommended was not found in the part of the page read (not re-checked 2026-11-14).
- Muse: review has three stages (risk assessment, tool review, end-to-end QA); each tool is classified and approved
  separately, and the portal asks for the endpoint, authentication setup, scopes and credentials, plus documentation with
  inputs, outputs, classifications, side effects, errors and rate limits. Source: Muse 5.4-6.3.

## 11. Transport

Serve streamable HTTP at one endpoint (POST). A stateless server that answers every request with a single
`application/json` body is valid; no SSE and no session id are required. Reject JSON-RPC batches (removed in the
2025-06-18 revision) with -32600. Answer client notifications and responses with HTTP 202 and an empty body. Reject an
unsupported `MCP-Protocol-Version` header with HTTP 400 and list the versions you support; treat a missing header as the
oldest revision. The live check (`--live`, L1-L4) tests this contract.
Source: MCP specification, transports (https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) (not
re-checked 2026-11-14).

Origin: the transport spec says servers MUST validate the `Origin` header and answer 403 if it is invalid (DNS-rebinding
protection). Validate it by default. A public, unauthenticated, cookie-less, read-only server may choose not to, but that
is a deviation from the spec, not compliance: label it as such in your docs, and revisit it when a write tool or
authentication is added.
