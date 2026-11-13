// ci-local fixture: a follower with a valid ci/suites.json passes `check-manifest`; a manifest without os_required,
// an unknown OS, and a hand-edited (sha-locked) allowed-signers file each fail naming the file. ci.mjs is offline and zero-dep.
import fs from 'node:fs';
import path from 'node:path';

const MAN = (over = {}) => `${JSON.stringify({ schema: 'ci-local/1', os_required: ['linux'], toolchain: {}, setup: [], suites: [{ id: 'unit', run: ['node -e "process.exit(0)"'], required: true, os: 'any' }], ...over }, null, 2)}\n`;

export const fixture = {
  id: 'ci-local',
  profiles: ['base@1.0.0', 'ci-local@1.0.0'],
  files: { 'ci/suites.json': MAN() },
  inject: (dir, h) => {
    const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    const good = MAN();
    const bites = (msg, re, rel, bad, ok) => { w(rel, bad); const r = h.check(); h.step(r.code === 1 && re.test(r.out), msg, r.out); w(rel, ok); };
    bites('a manifest without os_required fails naming ci/suites.json', /ci\/suites\.json: os_required is mandatory/, 'ci/suites.json', MAN({ os_required: undefined }), good);
    bites('an unknown required OS fails naming ci/suites.json', /ci\/suites\.json: os_required: unknown OS "beos"/, 'ci/suites.json', MAN({ os_required: ['beos'] }), good);
    const signers = fs.readFileSync(path.join(dir, '.standards/ci-local/allowed_signers.org'), 'utf8');
    bites('a hand-edited allowed-signers file fails the lock naming the file', /\[lock\] \.standards\/ci-local\/allowed_signers\.org: sha256/, '.standards/ci-local/allowed_signers.org', `${signers}evil@x ssh-ed25519 AAAA\n`, signers);
    const r = h.check();
    h.step(r.code === 0, 'the restored follower passes', r.out);
  },
};
