// firebase-web 2.0.0: lint.mjs passes the clean fixture and each rule F4-F11 fires on exactly its one defect;
// F1-F3 (v1) behaviour is unchanged. The fixture (tests/fixtures/firebase-web-2.mjs) is shared with fixture-sync.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, tmpdir, node, git } from './helpers.mjs';
import { FILES, DEFECTS, INDEX_TS, FIREBASE_JSON } from './fixtures/firebase-web-2.mjs';

const DIR = process.env.FIREBASE_WEB_SRC ? path.join(KIT_ROOT, 'src/profiles/firebase-web') : path.join(KIT_ROOT, 'profiles/firebase-web/2.0.0');
const LINT = path.join(DIR, '.standards/firebase-web/lint.mjs');
const l = await import(pathToFileURL(LINT).href);

function repo(over = {}) {
  const r = tmpdir('fbweb-lint-');
  git(r, 'init', '-q', '-b', 'main');
  for (const [f, t] of Object.entries({ ...FILES, ...over })) {
    if (t === null) continue;
    fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true });
    fs.writeFileSync(path.join(r, f), typeof t === 'function' ? t(FILES[f]) : t);
  }
  git(r, 'add', '-A');
  return r;
}
const run = (over) => l.lint(repo(over));
const ids = (out) => [...out.fails, ...out.warns].map((x) => /\[firebase-web\/([^\]]+)\]/.exec(x)[1]);
const has = (list, re) => list.some((x) => re.test(x));
const withJson = (patch) => ({ 'firebase.json': `${JSON.stringify({ ...FIREBASE_JSON, ...patch }, null, 2)}\n` });
const fn = (src) => ({ 'functions/src/index.ts': src });

test('the clean fixture passes with no warnings and the CLI exits 0', () => {
  const r = repo();
  const out = l.lint(r);
  assert.deepEqual(out, { fails: [], warns: [] });
  const c = node([LINT, r]);
  assert.equal(c.code, 0, c.out);
  assert.match(c.out, /\[firebase-web\/lint\] OK/);
});

for (const [id, d] of Object.entries(DEFECTS)) {
  test(`${id}: exactly its one defect fires (${d.level}), nothing else`, () => {
    const over = Object.fromEntries(Object.entries(d.edit).map(([f, edit]) => [f, edit(FILES[f])]));
    const out = run(over);
    assert.deepEqual(ids(out), [id], [...out.fails, ...out.warns].join('\n'));
    assert.ok(has(d.level === 'FAIL' ? out.fails : out.warns, d.expect), [...out.fails, ...out.warns].join('\n'));
    const c = node([LINT, repo(over)]);
    assert.equal(c.code, d.level === 'FAIL' ? 1 : 0, c.out);
  });
}

test('F1-F3 (v1): open rule, untested rules file, committed key and global CLI install still fail', () => {
  assert.ok(has(run({ 'firestore.rules': (t) => t.replace('allow delete: if false;', 'allow delete: if true;') }).fails, /\[firebase-web\/rules\] firestore\.rules: line 14: `allow \.\.\.: if true`/));
  assert.deepEqual(run({ 'firestore.rules': (t) => t.replace('allow delete: if false;', '// standards: public -- fixture reason\n      allow delete: if true;') }).fails, []);
  assert.ok(has(run({ 'firestore.rules': (t) => t.replace('allow delete: if false;', '// standards: public --\n      allow delete: if true;') }).fails, /\[firebase-web\/rules\]/), 'a marker without a reason does not count');
  assert.ok(has(run({ 'tests/rules.test.mjs': 'export {}\n' }).fails, /\[firebase-web\/rules-tested\] firestore\.rules: no test/));
  assert.ok(has(run({ 'sa.json': '{ "private_key": "x", "client_email": "y" }\n' }).fails, /\[firebase-web\/secrets\] sa\.json/));
  assert.ok(has(run({ '.github/workflows/ci.yml': 'jobs:\n  t:\n    steps:\n      - run: npm install -g firebase-tools\n' }).fails, /\[firebase-web\/cli\] \.github\/workflows\/ci\.yml:4/));
});

test('F4: reads and deletes are exempt; a missing size or type each fails; helpers are followed', () => {
  assert.deepEqual(run({ 'storage.rules': (t) => t.replace('request.resource.size < 5 * 1024 * 1024 && ', '') }).fails.length, 1, 'size alone missing');
  assert.deepEqual(ids(run({ 'storage.rules': (t) => t.replace('allow read:', 'allow delete: if request.auth.uid == uid;\n      allow read:') })), [], 'delete needs no size');
  const both = run({ 'storage.rules': (t) => t.replace(' && request.resource.size < 5 * 1024 * 1024 && isImage()', '') });
  assert.ok(has(both.fails, /does not check request\.resource\.size or request\.resource\.contentType/));
  assert.deepEqual(ids(run({ 'storage.rules': (t) => t.replace('allow write: if request.auth.uid == uid && request.resource.size < 5 * 1024 * 1024 && isImage();', 'allow write: if false;') })), [], 'if false denies');
});

test('F5: affectedKeys/keys allowlists and a reasoned schema marker pass; a bare marker warns; write counts', () => {
  assert.deepEqual(ids(run({ 'firestore.rules': (t) => t.replace('allow create: if', '// standards: schema -- callable validates the shape\n      allow create: if').replace(" && request.resource.data.keys().hasOnly(['name', 'email'])", '') })), []);
  assert.deepEqual(ids(run({ 'firestore.rules': (t) => t.replace('allow create: if', '// standards: schema --\n      allow create: if').replace(" && request.resource.data.keys().hasOnly(['name', 'email'])", '') })), ['F5']);
  assert.deepEqual(ids(run({ 'firestore.rules': (t) => t.replace('allow delete: if false;', 'allow write: if isOwner(uid);') })), ['F5']);
  assert.deepEqual(ids(run({ 'firestore.rules': (t) => t.replace('allow delete: if false;', 'allow write: if isOwner(uid) && request.resource.data.keys().hasAll([\'a\']);') })), []);
});

test('F6: auth-only writes fail directly or through a helper; reads and compound conditions pass', () => {
  assert.deepEqual(ids(run({ 'firestore.rules': (t) => t.replace('allow delete: if false;', 'allow update: if signedIn();') })), ['F6', 'F5']);
  assert.deepEqual(ids(run({ 'firestore.rules': (t) => t.replace('allow read: if isOwner(uid);', 'allow read: if request.auth != null;') })), []);
  assert.deepEqual(ids(run({ 'firestore.rules': (t) => t.replace('allow delete: if false;', 'allow delete: if request.auth != null && request.auth.uid == uid;') })), []);
});

test('F7: functions.config() and secret-named env reads fail; other env reads and comments pass', () => {
  assert.ok(has(run(fn(`${INDEX_TS}const c = functions.config().stripe;\n`)).fails, /F7\] functions\/src\/index\.ts:\d+: reads functions\.config\(\)/));
  assert.ok(has(run(fn(`${INDEX_TS}const t = process.env['SLACK_TOKEN'];\n`)).fails, /reads process\.env\.SLACK_TOKEN/));
  assert.deepEqual(ids(run(fn(`${INDEX_TS}const p = process.env.GCLOUD_PROJECT;\n// process.env.OLD_KEY was removed\n`))), []);
  assert.deepEqual(ids(run({ ...fn(INDEX_TS), 'functions/scripts/seed.mjs': 'const k = process.env.ADMIN_KEY;\n' })), [], 'scripts are not function source');
});

test('F8: onRequest with no verify warns; marker with reason or setGlobalOptions enforceAppCheck passes', () => {
  const noVerify = INDEX_TS.replace("  await getAppCheck().verifyToken(req.header('X-Firebase-AppCheck') ?? '');\n", '');
  assert.deepEqual(ids(run(fn(noVerify))), ['F8']);
  assert.deepEqual(ids(run(fn(noVerify.replace('export const hook', '// standards: no-app-check -- webhook, signed by the sender\nexport const hook')))), []);
  assert.deepEqual(ids(run(fn(noVerify.replace('export const hook', '// standards: no-app-check --\nexport const hook')))), ['F8']);
  const oncall = INDEX_TS.replace('enforceAppCheck: true, ', '');
  assert.deepEqual(ids(run(fn(`import { setGlobalOptions } from 'firebase-functions/v2';\nsetGlobalOptions({ enforceAppCheck: true });\n${oncall}`))), []);
});

test('F9: setGlobalOptions, spread/const options and generics are resolved; an unknown options name fails closed', () => {
  assert.deepEqual(ids(run(fn(INDEX_TS.replace(/maxInstances: 5, /g, '').replace('import { onCall', "import { setGlobalOptions } from 'firebase-functions/v2';\nsetGlobalOptions({ maxInstances: 3 });\nimport { onCall")))), []);
  assert.deepEqual(ids(run(fn(`${INDEX_TS}const OPTS = { maxInstances: 2 } as const;\nexport const g = onCall<unknown, Promise<number>>({ ...OPTS, enforceAppCheck: true }, async () => 1);\n`))), []);
  assert.deepEqual(ids(run(fn(`${INDEX_TS}export const g = onCall<unknown, Promise<number>>(LEGACY, async () => 1);\n`))), ['F9']);
  assert.deepEqual(ids(run(fn(`${INDEX_TS}export const s = onSchedule('every 5 minutes', async () => {});\n`))), ['F9']);
  assert.deepEqual(ids(run(fn(`${INDEX_TS}// export const x = onCall(async () => 1);\n`))), [], 'comments are ignored');
});

test('F10: no CSP, array hosting targets and missing HSTS warn; no hosting passes', () => {
  const hdrs = (headers) => withJson({ hosting: { public: 'dist', headers: [{ source: '**', headers }] } });
  assert.deepEqual(run(hdrs([])).warns.length, 2);
  assert.ok(has(run(hdrs([{ key: 'Strict-Transport-Security', value: 'max-age=1' }])).warns, /sends no Content-Security-Policy header/));
  assert.ok(has(run(hdrs([{ key: 'content-security-policy', value: "default-src 'self'" }])).warns, /no Strict-Transport-Security/));
  assert.deepEqual(run(withJson({ hosting: undefined })).warns, []);
  assert.ok(has(run(withJson({ hosting: [{ target: 'a' }, FIREBASE_JSON.hosting] })).warns, /hosting\[0\] sends no Content-Security-Policy/));
});

test('F11: cors true, "*", an array holding "*" and a const naming one fail; an explicit origin list passes', () => {
  for (const v of ["true", "'*'", "['*']", 'WIDE']) {
    const src = `${INDEX_TS.replace('cors: ORIGINS', `cors: ${v}`)}const WIDE = ['https://a.com', '*'];\n`;
    assert.ok(has(run(fn(src)).fails, /F11\]/), v);
  }
  assert.deepEqual(ids(run(fn(INDEX_TS.replace('cors: ORIGINS', "cors: ['https://a.com']")))), []);
  assert.deepEqual(ids(run(fn(INDEX_TS.replace('cors: ORIGINS, ', '')))), []);
});

test('a follower with no functions or hosting in firebase.json has nothing to check there', () => {
  assert.deepEqual(run({ ...withJson({ functions: undefined, hosting: undefined }), 'functions/src/index.ts': 'export const k = process.env.A_SECRET;\n' }), { fails: [], warns: [] });
});

test('stripJsComments keeps URLs in strings and blanks both comment forms without moving lines', () => {
  const s = "const u = 'https://x.dev/a'; // note\n/* a\nb */ const k = 1;\n";
  const out = l.stripJsComments(s);
  assert.ok(out.includes("'https://x.dev/a'"));
  assert.ok(!out.includes('note') && !out.includes('a\nb'));
  assert.equal(out.split('\n').length, s.split('\n').length);
});

test('1.0.0 stays released and VERSIONS lists both versions', () => {
  const v = fs.readFileSync(path.join(KIT_ROOT, 'profiles/firebase-web/VERSIONS'), 'utf8').trim().split('\n');
  assert.deepEqual(v, ['1.0.0', '2.0.0']);
  assert.ok(fs.existsSync(path.join(KIT_ROOT, 'profiles/firebase-web/1.0.0/.standards/firebase-web/lint.mjs')));
});
