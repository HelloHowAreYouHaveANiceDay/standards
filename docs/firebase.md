# Firebase standard (firebase-web@2.0.0)

Applies to every Firebase web app (Firestore, Auth, Storage, Hosting, Functions). One profile covers design and security.
Anchor: Google's Firebase security checklist [1]; Trail of Bits' Firebase patterns [13], OWASP ASVS V3 [14] and the GCP
security pillar [12] fill gaps. Every rule cites its source. Spec: wiki `projects/spec--firebase-standard.md` (approved).

Three kinds of check, as in `docs/stripe.md`:

1. Offline lint, `node .standards/firebase-web/lint.mjs` (run by `node .standards/check.mjs`). Rules F1-F11. Exact
   rule text: `profiles/firebase-web/2.0.0/.standards/firebase-web/RULES.md`. Pattern checks, not proofs.
2. Live audit, `node scripts/firebase-audit.mjs <project>`. Rules A1-A7. Read-only, run by an operator.
3. Review rubric R1-R6 and an incident runbook (below).

## 1. Lint rules (offline)

| Rule | Level | Fails when | Source |
|---|---|---|---|
| F1 | FAIL | open rule (`if true`, condition-less allow, test-mode expiry) without `standards: public -- <reason>` | [1][2] |
| F2 | FAIL | a rules file no test loads, or the test lacks one allow and one deny assertion | [1] |
| F3 | FAIL | committed service-account key or `.env`; `firebase/compat`; unpinned CLI | [1] |
| F4 | FAIL | a storage `allow write/create/update` whose condition lacks `request.resource.size` or `request.resource.contentType` | [1][8] |
| F5 | WARN | a Firestore `allow create/update` with no `keys().hasOnly`/`hasAll`/`diff(...).affectedKeys().hasOnly` and no `standards: schema -- <reason>` | [6] |
| F6 | FAIL | a write allow whose whole condition is `request.auth != null` (or a helper that is only that). Sign-up is assumed open | [1][13] |
| F7 | FAIL | functions source reads `functions.config()` or `process.env.*(SECRET\|KEY\|TOKEN\|PASSWORD)`; secrets use `defineSecret` | [1][9] |
| F8 | WARN | an `onCall` without `enforceAppCheck: true`; an `onRequest` with no App Check verify and no `standards: no-app-check -- <reason>` | [3][4] |
| F9 | FAIL | a function with no `maxInstances` (own options or `setGlobalOptions`) | [1] |
| F10 | WARN | hosting has no enforced `Content-Security-Policy` (Report-Only alone warns) or no HSTS | [14] |
| F11 | FAIL | an `onRequest` with `cors: true` or `'*'` | [13] |

F1-F3 are the 1.0.0 rules. F5 and F8 are WARN in 2.0.0 and become FAIL in 2.1.0, once both followers are clean.
Suppressions are comment markers with a reason: `standards: <kind> -- <reason>`.

## 2. Live audit (`scripts/firebase-audit.mjs`)

```
node scripts/firebase-audit.mjs <project> [--repo <dir>] [--site-url <url>] [--json]
```

Run it at adoption and after console changes, with read-only credentials. Never in CI: findings describe a project, not
a commit. App-specific inventory stays in each app (for example pdfmarkuptool's `scripts/check-firebase-state.sh`).

| Rule | Checks | Source |
|---|---|---|
| A1 | Firestore PITR enabled (`GET firestore/v1/projects/P/databases/(default)`) | [10] |
| A2 | A daily backup schedule with retention of at least 7 days (`.../backupSchedules`) | [10] |
| A3 | Deployed Firestore and Storage rules equal the repo's (Firebase Rules API releases, compared after CRLF and trim normalisation; paths from the repo's `firebase.json`) | [2] |
| A4 | Email enumeration protection on: `accounts:createAuthUri` with an allowed Referer answers without `registered` | [1][11] |
| A5 | Web API key referrer-restricted: the same call with no Referer gets 403 | [1] |
| A6 | App Check enforcement state per service (WARN when unenforced; FAIL from 2.1.0) | [1][3] |
| A7 | No service account holds `roles/owner` or `roles/editor` (`projects:getIamPolicy`) | [12] |

States: `PASS`, `FAIL`, `WARN`, `DEFERRED`, `SKIP`. A rule the credentials cannot reach prints `SKIP` with the reason and
is never reported as PASS (D4). Exit 0 with no FAIL, 1 with any FAIL, 2 on usage errors.

Read-only: every request is a GET except two POSTs that only read (`accounts:createAuthUri`, and
`projects:getIamPolicy`, which the API defines as POST). The audit never creates, updates or deletes anything.
The web API key for A4/A5 comes from Hosting's public `/__/firebase/init.json`; if the site does not serve it, pass
`--site-url`. A4/A5 need no Google credentials.

Credentials, first hit wins: `GOOGLE_OAUTH_ACCESS_TOKEN`; Application Default Credentials (file named by
`GOOGLE_APPLICATION_CREDENTIALS`, or gcloud's well-known file; `authorized_user` and `service_account` types);
`gcloud auth application-default print-access-token`. Give the operator account read-only roles (Firebase Viewer plus
Security Reviewer cover A1-A3, A6, A7).

### Deferring backups (spec D6)

PITR and backups cost money. Until an app has paying customers, the owner accepts the risk that data corrupted more than
an hour back is unrecoverable [10]. A follower records that in its `.standards.json`, a top-level key beside `kit` and
`profiles`:

```json
{ "kit": "...", "profiles": { "firebase-web": "2.0.0" }, "firebase-web": { "backups": "deferred" } }
```

With `"backups": "deferred"`, A1 and A2 print `DEFERRED` (with the reason) instead of `FAIL`. Any other value, or no key,
means required. `sync.mjs` and `standards.mjs` keep unknown top-level manifest keys across `init`, `bump` and `upgrade`,
so the setting survives. Remove the key when the app has paying customers; the rule is deferred, not dropped.

## 3. Review rubric (human or agent review of a PR)

- **R1** Rules are a schema: a new path ships its rule and its emulator test first [1].
- **R2** Roles live in custom claims set only by the Admin SDK; rules read them from the token [7].
- **R3** Cross-document invariants (membership, counters, money) are written by functions in a transaction. Kit judgement.
- **R4** Functions validate input at entry and refuse unknown fields; no endpoint answers "does this user exist" [13].
- **R5** Costly or unauthenticated endpoints are rate-limited or batched (Pub/Sub plus a scheduled function) [1].
- **R6** Data model: no sequential IDs, cursors not offsets, index exemptions for large or TTL fields, nothing sensitive in
  document or field names [5].

## 4. Incident runbook

- **Bad rules deployed (data exposed or app locked out):** redeploy the previous `main` commit's rules: revert the change
  through a PR and let the deploy workflow run, or in an emergency run `firebase deploy --only firestore:rules,storage`
  from a clean checkout of the last good commit. Then run A3 to confirm deployed equals repo [1].
- **Runaway function (cost or abuse):** delete it (`firebase functions:delete <name>`), deploy, then fix in a PR.
  `maxInstances` (F9) bounds the damage until then [1].
- **Leaked service-account JSON or secret:** revoke it in the console, rotate the GitHub secret, redeploy. A Firebase web API
  key is public by design: restrict it (A5) rather than rotate it.
- **Cost surprise:** every project has a budget alert [1]; confirm it exists when running the audit.
- **Data corruption:** with PITR on, restore to a point within 7 days; without it only the last hour is recoverable [10].
  That is the accepted risk while backups are deferred.

## 5. Recorded deviations from the checklist

- **No staging project (spec Q1, owner 2026-11-16).** The checklist recommends separate environments [1]; both apps use
  the emulators, `demo-*` projects and production only. Revisit if either app gains a second team or paying customers.
- **PITR and backups deferred (D6)** until an app has paying customers (see above).
- **Out of scope:** a "sign-up must be off" rule (F6 plus R2 cover the real invariant), Workload Identity Federation for CI
  deploys (revisit with the ci-local rollout), RTDB rules, mobile APK checks.

## 6. Sources

[1] https://firebase.google.com/support/guides/security-checklist
[2] https://firebase.google.com/docs/rules/insecure-rules
[3] https://firebase.google.com/docs/app-check
[4] https://firebase.google.com/docs/app-check/cloud-functions
[5] https://firebase.google.com/docs/firestore/best-practices
[6] https://firebase.google.com/docs/firestore/security/rules-conditions
[7] https://firebase.google.com/docs/auth/admin/custom-claims
[8] https://firebase.google.com/docs/storage/security/core-syntax
[9] https://firebase.google.com/docs/functions/config-env
[10] https://firebase.google.com/docs/firestore/disaster-recovery
[11] https://cloud.google.com/identity-platform/docs/admin/email-enumeration-protection
[12] https://cloud.google.com/architecture/framework/security
[13] https://raw.githubusercontent.com/trailofbits/skills/main/plugins/firebase-apk-scanner/skills/firebase-apk-scanner/references/vulnerabilities.md
[14] https://github.com/OWASP/ASVS/blob/master/5.0/en/0x12-V3-Web-Frontend-Security.md
