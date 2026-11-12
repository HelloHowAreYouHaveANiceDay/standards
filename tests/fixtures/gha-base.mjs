// gha-base fixture: a clean follower (one workflow + dependabot.yml) and defects that each make the gate fail
// naming the file:line. Runs the real pinned actionlint/shellcheck/zizmor (downloaded + sha256-verified).
import fs from 'node:fs';
import path from 'node:path';

const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1'; // actions/checkout v7.0.1

const workflow = ({ uses = `actions/checkout@${SHA} # v7.0.1`, env = 'REF: ${{ github.ref_name }}', run = 'echo "ref=$REF" >> "$GITHUB_OUTPUT"', runsOn = 'ubuntu-latest', extra = '' } = {}) => `name: ci
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
      - uses: ${uses}
        with:
          persist-credentials: false
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
  profiles: ['base@1.0.0', 'gha-base@1.0.0'],
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

    fsWrite(dir, WF, workflow({ uses: 'actions/checkout@v4' }));
    expectFail('an unpinned action fails zizmor unpinned-uses naming ci.yml', /\[unpinned-uses\][\s\S]*ci\.yml:\d+:\d+/);

    fsWrite(dir, WF, workflow({ run: 'echo "${{ github.event.pull_request.title }}"' }));
    expectFail('a PR title expanded in run: fails zizmor template-injection naming ci.yml', /\[template-injection\][\s\S]*ci\.yml:\d+:\d+/);

    fsWrite(dir, WF, workflow({ uses: `actions/checkout@v4 # zizmor: ignore[unpinned-uses]` }));
    expectFail('a zizmor ignore without a reason fails naming ci.yml', /FAIL \[gha-base\/reasons\] \.github\/workflows\/ci\.yml:\d+: zizmor ignore without a reason/);

    fsWrite(dir, WF, workflow({ uses: `actions/checkout@v4 # zizmor: ignore[unpinned-uses] fixture: first-party tag, see RULES` }));
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
