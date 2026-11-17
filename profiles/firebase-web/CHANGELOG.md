# firebase-web

Firebase web apps (Firestore/Auth/Storage/Hosting): one zero-dependency, offline lint (rules tracked, not open, loaded by a
rules test; no committed keys or .env; modular SDK; pinned CLI; firebase / rules-unit-testing majors agree) plus
RULES.md. Language-agnostic: pairs with base and any language profile.

## 2.0.0

- Lint F4-F11 (spec `spec--firebase-standard`): F4 storage writes check size and contentType (FAIL); F5 Firestore
  create/update field allowlist (WARN, `// standards: schema -- <reason>`); F6 write allowed on `request.auth != null`
  alone (FAIL); F7 `functions.config()` / secret-named `process.env` reads (FAIL); F8 App Check on onCall / onRequest
  (WARN, `// standards: no-app-check -- <reason>`); F9 function without `maxInstances` (FAIL); F10 hosting without an
  enforced CSP or HSTS (WARN); F11 onRequest `cors: true` / `'*'` (FAIL).
- `lint.mjs` takes an optional root argument and prints WARN lines without failing the gate. F1-F3 behave as in 1.0.0.
- F5 and F8 flip to FAIL in 2.1.0 once the followers are clean.

## 1.0.0

- First release.
