// sdlc-docs fixture: a follower with the five docs of record that passes docs.mjs, plus injected defects -- one or
// more per rule R1-R5 -- each failing with `<file>: R<n>` naming the file. docs.mjs is offline and zero-dep, so the
// fixture needs no downloads.
import fs from 'node:fs';
import path from 'node:path';

const SPEC = (over = {}, body) => {
  const fm = { id: '0001', title: 'Fixture spec', status: 'approved', approved: 'libo 2026-11-13 https://example.com/msg/1', appetite: '40', version: 'v1', ...over };
  const head = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${head}\n---\n\n# Fixture spec\n\n${body ?? '## TL;DR\n- one idea\n\n## What you need to decide now\n<!-- nothing open -->\n\n## Decided\n- D1 one line.\n\n## Acceptance criteria\n- AC1 [must] WHEN a THE SYSTEM SHALL b.\n\n## Build order (hints -- the slicing worker defines the scopes)\n| # | Slice hint | ACs | Done when |\n|---|------------|-----|-----------|\n'}`;
};
const ADR = '---\nid: 0001\nstatus: accepted\ndate: 2026-11-13\n---\n\n# Use a queue\n\n## Context\nx\n\n## Decision\nChosen: y, because z.\n\n## Consequences\nw\n';
const AGENTS = '# fixture -- agent instructions\n\n<!-- kit:sdlc-docs begin -->\n## Docs of record\n- README.md\n<!-- kit:sdlc-docs end -->\n';

export const fixture = {
  id: 'sdlc-docs',
  profiles: ['base@1.0.0', 'sdlc-docs@1.1.0'],
  files: {
    'README.md': '# fixture\n\nA fixture.\n',
    'AGENTS.md': AGENTS,
    'CLAUDE.md': '@AGENTS.md\n',
    'docs/specs/0001-fixture.md': SPEC(),
    'docs/decisions/0001-use-a-queue.md': ADR,
  },
  inject: (dir, h) => {
    const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    const rm = (rel) => fs.rmSync(path.join(dir, rel), { force: true });
    const bites = (msg, re, mutate, undo) => {
      mutate();
      const r = h.check();
      h.step(r.code === 1 && re.test(r.out), msg, r.out);
      undo();
    };
    const keep = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
    const spec = keep('docs/specs/0001-fixture.md');

    bites('a CLAUDE.md that is not the shim fails R1 naming CLAUDE.md', /CLAUDE\.md: R1 must contain exactly/, () => w('CLAUDE.md', '# my own instructions\n'), () => w('CLAUDE.md', '@AGENTS.md\n'));
    bites('a leftover AGENT.md fails R1 naming AGENT.md', /AGENT\.md: R1 must not exist/, () => w('AGENT.md', 'old\n'), () => rm('AGENT.md'));
    bites('an approved spec with no appetite fails R2 naming the spec', /docs\/specs\/0001-fixture\.md: R2 appetite/, () => w('docs/specs/0001-fixture.md', SPEC({ appetite: '' })), () => w('docs/specs/0001-fixture.md', spec));
    bites('a spec status outside draft|approved|done fails R3', /docs\/specs\/0001-fixture\.md: R3 status "in-progress"/, () => w('docs/specs/0001-fixture.md', SPEC({ status: 'in-progress' })), () => w('docs/specs/0001-fixture.md', spec));
    bites('a done spec with no reason fails R3', /docs\/specs\/0001-fixture\.md: R3 reason is empty/, () => w('docs/specs/0001-fixture.md', SPEC({ status: 'done' })), () => w('docs/specs/0001-fixture.md', spec));
    bites('an id that differs from the filename prefix fails R4', /docs\/decisions\/0002-other\.md: R4 id 0001 does not equal/, () => w('docs/decisions/0002-other.md', ADR), () => rm('docs/decisions/0002-other.md'));
    bites('an open [NEEDS CLARIFICATION in an approved spec fails R5', /docs\/specs\/0001-fixture\.md: R5 contains "\[NEEDS CLARIFICATION"/, () => w('docs/specs/0001-fixture.md', spec.replace('- one idea', '- one idea [NEEDS CLARIFICATION: who?]')), () => w('docs/specs/0001-fixture.md', spec));
    bites('a non-empty decide-now section in an approved spec fails R5', /R5 section "What you need to decide now" must be empty/, () => w('docs/specs/0001-fixture.md', spec.replace('<!-- nothing open -->', '1. Which db?')), () => w('docs/specs/0001-fixture.md', spec));
    w('docs/specs/0001-fixture.md', SPEC({ status: 'draft', approved: '', appetite: '' }, '## TL;DR\n- x [NEEDS CLARIFICATION: y]\n\n## What you need to decide now\n1. Which db?\n'));
    const d = h.check();
    h.step(d.code === 0, 'a draft spec may keep open questions and have no appetite (check passes)', d.out);
    w('docs/specs/0001-fixture.md', spec);
  },
};
