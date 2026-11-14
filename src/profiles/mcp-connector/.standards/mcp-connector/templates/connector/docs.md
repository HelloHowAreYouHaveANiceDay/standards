# {{CONNECTOR_TITLE}} connector

<!-- Fill every {{...}} marker. Name each tool from connector/manifest.json in the tools table. Keep this page factual:
the checker (M8) fails on a leftover marker or a tool this page does not name. -->

## What it does

{{Two or three sentences: what a user can ask, and what comes back.}}

## Endpoint and how to add it

Endpoint: `https://{{DOMAIN}}/mcp` (streamable HTTP, no sign-in).

- Claude: Settings, Connectors, Add custom connector, paste the endpoint.
- ChatGPT: Settings, Connectors, add a custom connector in developer mode, paste the endpoint.

## Tools

| Tool | Class | Input | Output | Errors |
|---|---|---|---|---|
| `{{tool_name}}` | read | `{{query}}`: {{what it is}} | {{fields returned}} | `invalid_input`, `rate_limited` |

Class is read, write or sensitive write. {{State which tools, if any, change data or move money, and what the user is
asked to approve.}}

## Rate limits

{{N calls per hour per client IP, shared by all tools. What a limited caller sees and when to retry.}}

## Data use

{{What the connector receives, why, who it is shared with, how long it is kept. No training. Link to the privacy page.}}

## Support

{{support email}}. {{Response time, if you promise one.}}
