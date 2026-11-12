// gha-base fixture: a clean follower (one workflow + dependabot.yml) and defects that each make the gate fail
// naming the file:line. Runs the real pinned actionlint/shellcheck/zizmor (downloaded + sha256-verified).
import fs from 'node:fs';
import path from 'node:path';

const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1'; // actions/checkout v7.0.1

const workflow = ({ uses = `actions/checkout@${SHA} # v7.0.1`, env = 'REF: ${{ github.ref_name }}', run = 'echo "ref=$REF" >> "$GITHUB_OUTPUT"', runsOn = 'ubuntu-latest', extra = '', persist = true } = {}) => `name: ci
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ${runsOn}
    steps:
      - uses: ${uses}${persist ? `
        with:
          persist-credentials: false` : ''}
      - name: Show ref
        id: show
        env:
          ${env}
        run: |
          set -euo pipefail
          ${run}
${extra}`;

const DEPENDABOT = `version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    cooldown:
      default-days: 7
`;

const WF = '.github/workflows/ci.yml';

export const fixture = {
  id: 'gha-base',
  profiles: ['base@1.0.0', 'gha-base@1.1.0'],
  files: { [WF]: workflow(), '.github/dependabot.yml': DEPENDABOT },
  inject(dir, h) {
    const expectFail = (what, re) => {
      const r = h.check();
      h.step(r.code === 1 && re.test(r.out), what, r.out);
    };
    const restore = () => fsWrite(dir, WF, workflow());

    fsWrite(dir, WF, workflow({ env: 'REF: ${{ github.evnt.ref_name }}' }));
    expectFail('an undefined context property fails actionlint naming ci.yml', /ci\.yml:\d+:\d+: property "evnt" is not defined .*\[expression\]/);

    fsWrite(dir, WF, workflow({ run: 'echo ref=$REF >> "$GITHUB_OUTPUT"' }));
    expectFail('an unquoted variable fails shellcheck (via actionlint) naming ci.yml', /ci\.yml:\d+:\d+: shellcheck reported issue in this script: SC2086/);

    // 1.1.0 pinning policy (spec--ci-standards S2): GitHub-owned actions may be tag-pinned, third-party must be SHA-pinned.
    fsWrite(dir, WF, workflow({ uses: 'actions/checkout@v4' }));
    const owned = h.check();
    h.step(owned.code === 0, 'a GitHub-owned action pinned by tag (actions/checkout@v4) passes', owned.out);

    fsWrite(dir, WF, workflow({ uses: 'some-org/some-action@v1' }));
    expectFail('a third-party action pinned by tag fails zizmor unpinned-uses naming ci.yml', /\[unpinned-uses\][\s\S]*ci\.yml:\d+:\d+/);

    fsWrite(dir, '.github/zizmor.yml', '# fixture: follower-owned policy wins over the vendored one\nrules:\n  unpinned-uses:\n    config:\n      policies:\n        "*": ref-pin\n');
    const own = h.check();
    h.step(own.code === 0, 'a follower-owned .github/zizmor.yml replaces the vendored policy (tag-pinned third-party passes)', own.out);
    fs.rmSync(path.join(dir, '.github/zizmor.yml'));

    fsWrite(dir, WF, workflow({ persist: false }));
    expectFail('actions/checkout without persist-credentials: false fails zizmor artipacked naming ci.yml', /\[artipacked\][\s\S]*ci\.yml:\d+:\d+/);

    fsWrite(dir, WF, workflow({ uses: 'some-org/some-action@v1' }));
    expectFail('the vendored policy is back after the follower config is removed', /\[unpinned-uses\][\s\S]*ci\.yml:\d+:\d+/);

    fsWrite(dir, WF, workflow({ run: 'echo "${{ github.event.pull_request.title }}"' }));
    expectFail('a PR title expanded in run: fails zizmor template-injection naming ci.yml', /\[template-injection\][\s\S]*ci\.yml:\d+:\d+/);

    fsWrite(dir, WF, workflow({ uses: `some-org/some-action@v1 # zizmor: ignore[unpinned-uses]` }));
    expectFail('a zizmor ignore without a reason fails naming ci.yml', /FAIL \[gha-base\/reasons\] \.github\/workflows\/ci\.yml:\d+: zizmor ignore without a reason/);

    fsWrite(dir, WF, workflow({ uses: `some-org/some-action@v1 # zizmor: ignore[unpinned-uses] fixture: vendor tag is signed, see RULES` }));
    const ok = h.check();
    h.step(ok.code === 0, 'a zizmor ignore with a reason passes (and suppresses the finding)', ok.out);

    fsWrite(dir, WF, workflow({ runsOn: '[self-hosted, fixture-box]' }));
    expectFail('an unknown runner label fails actionlint naming ci.yml', /ci\.yml:\d+:\d+: label "fixture-box" is unknown/);
    fsWrite(dir, '.github/actionlint.yaml', '# fixture: custom self-hosted label\nself-hosted-runner:\n  labels:\n    - fixture-box\n');
    const overlay = h.check();
    h.step(overlay.code === 0, 'the follower .github/actionlint.yaml overlay allows the custom label', overlay.out);

    restore();
    const clean = h.check();
    h.step(clean.code === 0, 'the restored workflow (with the overlay) passes', clean.out);
  },
};

function fsWrite(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}
