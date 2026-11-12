# firebase-web rules (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit)

Firebase web apps (Firestore / Auth / Storage / Hosting). Gate: `node .standards/firebase-web/lint.mjs`, run by
`node .standards/check.mjs`; offline, no credentials. It fails on: rules/index files firebase.json declares but git
does not track; open rules (`if true`, condition-less `allow`, test-mode expiry) without a reasoned marker; a rules
file no rules test loads; committed service-account keys or `.env` files; `firebase/compat` imports; global
`firebase-tools` installs in workflows; `firebase` vs `@firebase/rules-unit-testing` major mismatch.

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
