# firebase-web rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Firebase web apps (Firestore / Auth / Storage / Hosting). Gate: `node .standards/firebase-web/lint.mjs`, run by
`node .standards/check.mjs`; offline, no credentials. It fails on: rules/index files firebase.json declares but git
does not track; open rules (`if true`, condition-less `allow`, test-mode expiry) without a reasoned marker; a rules
file no rules test loads; committed service-account keys or `.env` files; `firebase/compat` imports; global
`firebase-tools` installs in workflows; `firebase` vs `@firebase/rules-unit-testing` major mismatch; and (2.0.0)
the F4-F11 rules below. Pattern checks, not proofs. Standard text, sources and the review rubric:
`docs/firebase.md` in the standards kit (Firebase security checklist, https://firebase.google.com/support/guides/security-checklist).

## Lint rules F4-F11 (2.0.0)
| Rule | Level | Fires when |
|---|---|---|
| F4 | FAIL | a Storage `allow write/create/update` lacks a `request.resource.size` or `request.resource.contentType` check |
| F5 | WARN | a Firestore `allow create/update/write` has no `keys().hasOnly/hasAll` or `affectedKeys().hasOnly` and no marker |
| F6 | FAIL | a write allow whose whole condition is `request.auth != null` (or a helper that is only that) |
| F7 | FAIL | functions source reads `functions.config()` or `process.env.*(SECRET\|KEY\|TOKEN\|PASSWORD)`; use `defineSecret` |
| F8 | WARN | an `onCall` without `enforceAppCheck: true`; an `onRequest` with no App Check token verify |
| F9 | FAIL | a function with no `maxInstances` (own options or `setGlobalOptions`) |
| F10 | WARN | `firebase.json` hosting has no enforced `Content-Security-Policy` (Report-Only alone warns) or no HSTS |
| F11 | FAIL | an `onRequest` with `cors: true` or `'*'` |

Reasoned markers (a `//` comment, `-- <reason>` required, on the line or the comment block above): `standards: public`
(F1), `standards: schema` (F5), `standards: no-app-check` (F8). F5 and F8 become FAIL in 2.1.0.

## Rules and tests
- Rules are default-deny. An intentionally public rule gets `// standards: public -- <reason>` on the line above.
- Every rules file in firebase.json is loaded by a test (`@firebase/rules-unit-testing` `initializeTestEnvironment`)
  that asserts at least one allow and one deny. Starting the emulator does not fail on a broken rules file; loading
  it in a test does. A `*.rules` change ships with a test in the same PR.
- Tests and emulators use a `demo-*` project ID, never the real one. Seed with `withSecurityRulesDisabled`; assert
  with `assertSucceeds` / `assertFails`.
- Indexes live in `firestore.indexes.json`; an index created in the console is exported to the file the same day.

## CLI, CI, deploy
- `firebase-tools` is an exact devDependency run as `npx firebase`; CI uses that version (Node >= 20, Java 21 for the
  emulators, cache `~/.cache/firebase/emulators`).
- Production deploys only from main after the test job, with explicit `--only` and `--non-interactive`, never
  `--force`; rules and indexes before hosting. PR previews deploy hosting only and use the production backend unless
  the repo says otherwise in AGENTS.md.

## Client
- Modular SDK only; one `src/lib/firebase.ts` initialises app/auth/db/storage. Emulators connect only behind an
  explicit env flag.
- Web config comes from `VITE_FIREBASE_*` (it is not secret); service-account JSON, tokens and `.env` never enter git
  (`.env.template` does).
- Hosting: `index.html` and the service worker `no-cache`; hashed `/assets/**`
  `public, max-age=31536000, immutable`.
