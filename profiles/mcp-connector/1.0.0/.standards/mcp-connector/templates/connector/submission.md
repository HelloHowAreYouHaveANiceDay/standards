# Directory submission packet

<!-- Follower-owned working checklist. Not checked by the gate (M8 skips this file). Fill it when you start a
submission; re-read GUIDELINES.md and the directory's own rules first. -->

## Generic

- [ ] Business verified with each directory (legal entity name: {{LEGAL_NAME}})
- [ ] Brand assets: logo, icon, screenshots at the sizes the directory asks for
- [ ] URLs live: endpoint {{ENDPOINT}}, docs {{DOCS_URL}}, privacy {{PRIVACY_URL}}, terms {{TERMS_URL}}
- [ ] Support contact: {{SUPPORT_EMAIL}}
- [ ] Security contact: {{SECURITY_EMAIL}}
- [ ] Maintainer (a named person who answers reviewer questions): {{MAINTAINER}}
- [ ] Test path: how a reviewer exercises every tool ({{TEST_ACCOUNT_OR_NO_SIGN_IN}}; sample inputs)
- [ ] Refund route (paid tools): {{REFUND_POLICY_URL}}
- [ ] `node .standards/mcp-connector/connector.mjs` passes
- [ ] `node .standards/mcp-connector/connector.mjs --live <endpoint> --call <tool> '<json args>'` passes against production

## Claude

- [ ] Submitted from a paid Claude plan account, in the organization that should own the listing
- [ ] Submitted as an MCP connector (not only inside a plugin bundle)
- [ ] Every tool has a title and annotations; read and write tools are separate
- [ ] Public documentation is live by the publish date
- [ ] Every tool tried in MCP Inspector and as a custom connector in Claude
- [ ] Test credentials supplied (fully populated account) or "none needed" stated

## ChatGPT

- [ ] Checkout and payment behavior reviewed against the current OpenAI documentation (not re-checked when this
  template was written)
- [ ] Each tool tried in ChatGPT developer mode

## Muse

- [ ] Each tool classified read, write or sensitive write, in the portal and in the docs
- [ ] Transaction tools: price, seller, currency, fees, refund terms shown before approval; idempotency key; test mode
  explained ({{TEST_MODE}})
- [ ] Dedicated test account with representative data, kept accessible during review
- [ ] Endpoint, authentication setup and scopes documented; test or production environment identified
- [ ] Privacy policy states collection, retention, no training, deletion route
