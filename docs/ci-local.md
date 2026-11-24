# ci-local evidence

`ci-local` (profile `profiles/ci-local`, `node .standards/ci-local/ci.mjs`) posts the `builder-ci` commit status from
records on `refs/ci/<tree>`. `verify` counts two kinds of evidence. Both are checked against the default branch's
`.standards/ci-local/allowed_signers.org`, so a PR cannot enroll its own signer (that file is under
`.standards/ci-local`, the gated path: `manifest-changed` unless the trusted caller passes `--approved`).

## Host records (`ci-result@hhay`)

`record.<os>.<host-id>.json` plus `.sig`, written by `ci run` on a builder host and signed by `ci sign` with the host's
key (namespace `ci-result@hhay`). Per-suite results, toolchain probes, OS and `ci_local_version` are all signed and
checked. See `profiles/ci-local/CHANGELOG.md` for the rules by version.

## aah check statements (`aah-check@v1`, 1.7.0)

An agent-at-home gateway runs a repo's check command in its sandbox and signs a statement of what ran (aah spec 0023,
attested checks). The statement is the evidence; the record around it is unsigned, so the code that formats and posts it
(an aah plugin) needs no signing key. Only the gateway's key is trusted.

Statement (canonical bytes = the exact UTF-8 file content; signed with `ssh-keygen -Y sign -n aah-check@v1`):

```json
{"v":1,"box":"haus-mac1","grant":"g-widgets","repo":"owner/repo","tree":"<git tree sha>","commit":"<sha>",
 "command":"node ci/run.mjs","exit":0,"log_sha256":"<hex>","build_sha256":null,"started_ms":0,"ended_ms":0}
```

Enrolment, one line in the default branch's `allowed_signers.org` (a key may not hold both namespaces):

```
aah@haus-mac1 namespaces="aah-check@v1",valid-before="20270215" ssh-ed25519 AAAA...
```

Manifest: `ci/suites.json` declares the command a gateway check must have run:

```json
{ "schema": "ci-local/1", "os_required": "any", "aah_check": "node ci/run.mjs", "suites": [ ... ] }
```

Plugin side (no key):

```sh
node .standards/ci-local/ci.mjs aah-record statement.json --sig statement.json.sig --principal aah@haus-mac1 --out DIR
node .standards/ci-local/ci.mjs publish DIR/record.aah.haus-mac1.json
node .standards/ci-local/ci.mjs status --sha <sha> --repo owner/repo
```

The record is `{schema, tree, commit, os: "aah", signer, host, outcome, evidence: {type: "aah-check@v1", principal,
statement, signature}}`. `verify` reads only `evidence`; every other field is informational.

Acceptance rules (a record failing any of them is ignored and listed under `notes`; ignoring one never grants a pass):

1. The signature verifies (`ssh-keygen -Y verify -n aah-check@v1 -I <principal>`) against the default branch's allowed
   signers: the principal is enrolled for `aah-check@v1` and its `valid-before` has not passed. Otherwise
   `bad-signature` (wrong namespace, unenrolled or ci-only key, edited bytes, expired key).
2. `statement.tree` is the head commit's tree (`wrong-tree`). The commit sha is not compared, as for host records.
3. `statement.repo` equals the repo, from `--repo` or the github `origin` URL, case-insensitive (`aah-wrong-repo`;
   `aah-repo-unknown` when neither is known).
4. `statement.command` equals `aah_check` exactly. The default branch's `aah_check` wins over the head's, so a PR
   cannot redefine the command its own statement must match; a repo adopting it gets the head's value
   (`aah-command-mismatch`, `aah-no-command`).
5. `os_required` is `"any"` (`aah-any-mode-only`): a statement names no OS, so it cannot fill an all-of OS slot.

Mapping: one statement covers the whole manifest. On `exit` 0 every `os: "any"` suite is `passed`; on any other exit they
are `failed`, which makes the tree red (`record-failed` + `suite-failed`). A red statement is never out-voted: a later
green one replacing the same file still leaves the tree red (as for host records since 1.3.0). An OS-bound suite
(`os: "windows"`, ...) is `skipped:os` on an aah record and stays pending until a host record for that OS passes it.
Toolchain pins are not checked for aah records: the statement carries no probes, and the gateway's sandbox is the
toolchain. `manifest-changed` and the suites-dropped suffix apply unchanged.

Limit (same as host records): the command runs the PR's own code, so a test that exits 0 dishonestly still passes.
`ci/**` is not gated by ci-local since 1.5.0; code-owner review on the PR is the human gate for it.
