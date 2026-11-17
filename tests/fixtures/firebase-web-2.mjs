// firebase-web 2.0.0 fixture: a clean Firebase web follower (Firestore + Storage + functions + hosting) that passes
// every rule F1-F11, plus one injected defect per rule. lint.mjs is offline and zero-dep, so no downloads.
// FILES / defect builders are exported for tests/profile-firebase-web.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

export const FIRESTORE_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }
    function isOwner(uid) {
      return signedIn() && request.auth.uid == uid;
    }
    match /users/{uid} {
      allow read: if isOwner(uid);
      allow create: if isOwner(uid) && request.resource.data.keys().hasOnly(['name', 'email']);
      allow update: if isOwner(uid) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name']);
      allow delete: if false;
    }
  }
}
`;

export const STORAGE_RULES = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function isImage() {
      return request.resource.contentType.matches('image/.*');
    }
    match /avatars/{uid}/{file} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == uid && request.resource.size < 5 * 1024 * 1024 && isImage();
    }
  }
}
`;

export const INDEX_TS = `import { onCall, onRequest } from 'firebase-functions/v2/https';
import { getAppCheck } from 'firebase-admin/app-check';
import { defineSecret } from 'firebase-functions/params';

const API_KEY = defineSecret('API_KEY');
const ORIGINS = ['https://app.example.com'];

export const hello = onCall({ maxInstances: 5, enforceAppCheck: true, secrets: [API_KEY] }, async () => ({ ok: true }));

export const hook = onRequest({ cors: ORIGINS, maxInstances: 5 }, async (req, res) => {
  await getAppCheck().verifyToken(req.header('X-Firebase-AppCheck') ?? '');
  res.send('ok');
});
`;

export const FIREBASE_JSON = {
  firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
  storage: { rules: 'storage.rules' },
  functions: [{ source: 'functions' }],
  hosting: {
    public: 'dist',
    headers: [{ source: '**', headers: [
      { key: 'Content-Security-Policy', value: "default-src 'self'" },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    ] }],
  },
};

export const RULES_TEST = `import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import fs from 'node:fs'

export const env = () => initializeTestEnvironment({ projectId: 'demo-x', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') }, storage: { rules: fs.readFileSync('storage.rules', 'utf8') } })
// assertSucceeds(owner writes /users/u) / assertFails(other writes /users/u); storage.rules: assertSucceeds / assertFails
`;

export const FILES = {
  'package.json': `${JSON.stringify({ name: 'fixture', private: true, devDependencies: { 'firebase-tools': '15.26.0' } }, null, 2)}\n`,
  'firebase.json': `${JSON.stringify(FIREBASE_JSON, null, 2)}\n`,
  'firestore.rules': FIRESTORE_RULES,
  'storage.rules': STORAGE_RULES,
  'firestore.indexes.json': '{ "indexes": [], "fieldOverrides": [] }\n',
  'tests/rules.test.mjs': RULES_TEST,
  'functions/src/index.ts': INDEX_TS,
};

// One defect per rule: id -> { level, file edits (rel -> text | fn(clean) -> text), expect (regex over the finding) }.
export const DEFECTS = {
  F4: { level: 'FAIL', edit: { 'storage.rules': (t) => t.replace(' && isImage()', '') }, expect: /FAIL \[firebase-web\/F4\] storage\.rules:9: storage `allow write` does not check request\.resource\.contentType/ },
  F5: { level: 'WARN', edit: { 'firestore.rules': (t) => t.replace(" && request.resource.data.keys().hasOnly(['name', 'email'])", '') }, expect: /WARN \[firebase-web\/F5\] firestore\.rules:12: Firestore `allow create` has no field allowlist/ },
  F6: { level: 'FAIL', edit: { 'storage.rules': (t) => t.replace('allow read: if request.auth != null;', 'allow read: if request.auth != null;\n      allow delete: if request.auth != null;') }, expect: /FAIL \[firebase-web\/F6\] storage\.rules:9: `allow delete` needs only `request\.auth != null`/ },
  F7: { level: 'FAIL', edit: { 'functions/src/index.ts': (t) => `${t}export const k = process.env.STRIPE_SECRET_KEY;\n` }, expect: /FAIL \[firebase-web\/F7\] functions\/src\/index\.ts:\d+: reads process\.env\.STRIPE_SECRET_KEY/ },
  F8: { level: 'WARN', edit: { 'functions/src/index.ts': (t) => t.replace('enforceAppCheck: true, ', '') }, expect: /WARN \[firebase-web\/F8\] functions\/src\/index\.ts:8: onCall without `enforceAppCheck: true`/ },
  F9: { level: 'FAIL', edit: { 'functions/src/index.ts': (t) => t.replace('maxInstances: 5, enforceAppCheck', 'enforceAppCheck') }, expect: /FAIL \[firebase-web\/F9\] functions\/src\/index\.ts:8: onCall has no maxInstances/ },
  F10: { level: 'WARN', edit: { 'firebase.json': (t) => t.replace('"Content-Security-Policy"', '"Content-Security-Policy-Report-Only"') }, expect: /WARN \[firebase-web\/F10\] firebase\.json: hosting sends Content-Security-Policy-Report-Only only/ },
  F11: { level: 'FAIL', edit: { 'functions/src/index.ts': (t) => t.replace('cors: ORIGINS', 'cors: true') }, expect: /FAIL \[firebase-web\/F11\] functions\/src\/index\.ts:10: onRequest allows every origin/ },
};

export const fixture = {
  id: 'firebase-web-2',
  profiles: ['base@1.0.0', 'firebase-web@2.0.0'],
  files: FILES,
  inject: (dir, h) => {
    const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    for (const [id, d] of Object.entries(DEFECTS)) {
      for (const [rel, fn] of Object.entries(d.edit)) w(rel, fn(FILES[rel]));
      h.git('add', '-A');
      const r = h.check();
      const code = d.level === 'FAIL' ? 1 : 0;
      h.step(r.code === code && d.expect.test(r.out), `${id}: its defect ${d.level === 'FAIL' ? 'fails' : 'warns (exit 0)'} naming the file`, r.out);
      for (const rel of Object.keys(d.edit)) w(rel, FILES[rel]);
      h.git('add', '-A');
    }
    const clean = h.check();
    h.step(clean.code === 0, 'check.mjs passes again after the defects are removed', clean.out);
  },
};
