#!/usr/bin/env node
// ci-base workflow lint (vendored from HelloHowAreYouHaveANiceDay/standards; do not edit).
//
//   node .standards/ci-base/wf.mjs [.github/workflows]
//
// Offline, no network, no credentials; the only dependency is the vendored single-file YAML parser.
// Rules: C1 C2 G1 G2 G6 L1 D2 K1 S4 (MUST -> FAIL) and O3 (SHOULD -> WARN); see RULES.md.
// Every finding prints `standards: FAIL|WARN [ci-base/wf] <file>:<line>: <message> (<id>)`; exit 1 only on a FAIL.
// Suppress one finding with `# standards-allow <ID>: <reason>` on the offending line, on the first line of the
// job, on the comment line directly above either, or in the file's leading comment block. A reasonless allow FAILS.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDocument, LineCounter, isMap } from './vendor/yaml.mjs';

export const MUST = new Set(['C1', 'C2', 'G1', 'G2', 'G6', 'L1', 'D2', 'K1', 'S4', 'allow', 'parse']);
export const RULE_IDS = ['C1', 'C2', 'G1', 'G2', 'G6', 'L1', 'D2', 'K1', 'S4', 'O3'];

const VERIFY_IF = /always\(\)|!cancelled\(\)|steps\.[\w-]+\.outcome\s*==\s*'failure'/;
const DEPLOY_RE = /\bwrangler(?:@[^\s]+)?\s+(?:pages\s+)?(?:deploy|publish)\b|\bfirebase(?:-tools)?(?:@[^\s]+)?\s+deploy\b|FirebaseExtended\/action-hosting-deploy|cloudflare\/(?:wrangler|pages)-action/i;
const G2_RE = /playwright|\bemulators:(?:exec|start)\b|\bfirebase(?:-tools)?(?:@[^\s]+)?\s+emulators\b/i;
const CACHE_PATH_RE = /go-build|go\/pkg\/mod|(?:^|[\s/~])\.cache\/uv|\.nuget|\.cargo|(?:^|[\s~/])go\/pkg/i;

const str = (v) => (v === null || v === undefined ? '' : String(v));
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const flatStrings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => flatStrings(x, out));
  else if (isObj(v)) Object.values(v).forEach((x) => flatStrings(x, out));
  return out;
};
const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);

// Which events trigger the workflow; push-to-main = a push trigger that is not tag-only / branch-restricted away from main.
export function triggers(on) {
  const ev = {};
  if (typeof on === 'string') ev[on] = {};
  else if (Array.isArray(on)) on.forEach((e) => { ev[e] = {}; });
  else if (isObj(on)) for (const [k, v] of Object.entries(on)) ev[k] = isObj(v) ? v : {};
  const push = ev.push;
  let pushMain = false;
  if (push) {
    const b = asList(push.branches);
    const bi = asList(push['branches-ignore']);
    const t = asList(push.tags);
    if (b.length) pushMain = b.some((g) => ['main', 'master'].some((n) => globRe(str(g)).test(n)));
    else if (bi.length) pushMain = !bi.some((g) => globRe(str(g)).test('main'));
    else pushMain = t.length === 0;
  }
  return { events: Object.keys(ev), pr: Boolean(ev.pull_request || ev.pull_request_target), pushMain, raw: ev };
}

const hasPrCond = (c) => (/event_name\s*==\s*'pull_request(?:_target)?'/.test(c) || /event_name\s*!=\s*'push'/.test(c) || /(?<!!)github\.event\.pull_request\b/.test(c));
const hasPushCond = (c) => /event_name\s*==\s*'push'/.test(c);
export const prOnly = (job) => { const c = str(job.if); return c !== '' && hasPrCond(c) && !hasPushCond(c) && !/event_name\s*!=\s*'pull_request/.test(c); };
export const pushOnly = (job) => { const c = str(job.if); return c !== '' && hasPushCond(c) && !hasPrCond(c); };
const tolerant = (job) => { const c = str(job.if); return /!cancelled\(\)/.test(c) && /failure/.test(c); };

const stepText = (s) => [s.name, s.uses, s.run, s.with ? JSON.stringify(s.with) : ''].map(str).join('\n');
const truthy = (v) => v === true || (typeof v === 'string' && v.trim() !== '' && v.trim() !== 'false');

// Lint one workflow. ctx = { names: Set of every workflow name/path in the directory, lane: repo declares a `deploy` lane }.
export function lintWorkflow(text, file, ctx = { names: new Set(), lane: false }) {
  const found = [];
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, uniqueKeys: false });
  const lines = text.split(/\r?\n/);
  const lineAt = (node) => (node && node.range ? lc.linePos(node.range[0]).line : 1);
  const nodeLine = (p) => lineAt(doc.getIn(p, true));
  const keyLine = (p) => {
    const parent = doc.getIn(p.slice(0, -1), true);
    const pair = parent && parent.items ? parent.items.find((i) => i.key && str(i.key.value) === str(p[p.length - 1])) : null;
    return pair ? lineAt(pair.key) : nodeLine(p.slice(0, -1));
  };

  // allow comments (collected from raw lines; a comment on its own line also covers the next line)
  const allows = new Map();
  const add = (n, a) => { if (!allows.has(n)) allows.set(n, []); allows.get(n).push(a); };
  let leading = true;
  const header = [];
  lines.forEach((l, i) => {
    const m = /#\s*standards-allow\b(.*)$/.exec(l);
    const commentOnly = /^\s*#/.test(l);
    if (!commentOnly && l.trim() !== '') leading = false;
    if (!m) return;
    const idm = /^\s*([A-Za-z]\w*)/.exec(m[1]);
    const id = idm ? idm[1] : '';
    const rm = /^\s*:\s*(\S.*?)\s*$/.exec(m[1].slice(idm ? idm[0].length : 0));
    const reason = rm ? rm[1] : '';
    if (!reason) { found.push({ id: 'allow', line: i + 1, msg: `standards-allow${id ? ` ${id}` : ''} without a reason (write "# standards-allow <ID>: <why>")` }); return; }
    if (!id || (!RULE_IDS.includes(id))) { found.push({ id: 'allow', line: i + 1, msg: `standards-allow names an unknown rule${id ? ` "${id}"` : ''}`, warn: true }); return; }
    add(i + 1, id);
    if (commentOnly) add(i + 2, id);
    if (leading) header.push(id);
  });

  const find = (id, line, msg, jobLine) => found.push({ id, line, msg, jobLine });

  if (doc.errors.length) {
    const e = doc.errors[0];
    found.push({ id: 'parse', line: e.linePos ? e.linePos[0].line : 1, msg: `YAML parse error: ${e.message.split('\n')[0]}` });
    return finish();
  }
  const wf = doc.toJS() || {};
  if (!isObj(wf) || !isObj(wf.jobs)) return finish();
  const tr = triggers(wf.on);
  const jobs = wf.jobs;
  const ids = Object.keys(jobs);
  const jl = (id) => keyLine(['jobs', id]);
  const needsOf = (j) => asList(j.needs).map(str);
  const runsOnPush = (j) => tr.pushMain && !prOnly(j);
  const runsOnPr = (j) => tr.pr && !pushOnly(j);

  // C1 concurrency on PR-triggered workflows
  if (tr.pr) {
    const onLine = wf.on !== undefined ? keyLine(['on']) : 1;
    const c = wf.concurrency;
    if (c === undefined) find('C1', onLine, 'PR-triggered workflow has no workflow-level concurrency (group with github.workflow + PR number/ref; cancel-in-progress for pull_request only)');
    else {
      const cl = keyLine(['concurrency']);
      const group = isObj(c) ? str(c.group) : str(c);
      if (!group.includes('github.workflow')) find('C1', cl, 'concurrency group must contain github.workflow (groups are repo-wide)');
      else if (!/github\.event\.pull_request\.number|github\.ref\b|github\.head_ref/.test(group)) find('C1', cl, 'concurrency group needs a PR-number-or-ref key (github.event.pull_request.number || github.ref)');
      const cip = isObj(c) ? c['cancel-in-progress'] : undefined;
      if (cip === undefined || cip === false || str(cip) === 'false') find('C1', cl, "concurrency must set cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
      else if ((cip === true || str(cip) === 'true') && tr.pushMain) find('C1', cl, "cancel-in-progress: true also cancels runs on main; use ${{ github.event_name == 'pull_request' }}");
      else if (typeof cip === 'string' && cip !== 'true' && !/event_name\s*==\s*'pull_request/.test(cip)) find('C1', cl, "cancel-in-progress expression must be true only for pull_request (${{ github.event_name == 'pull_request' }})");
    }
  }

  for (const id of ids) {
    const job = jobs[id];
    if (!isObj(job)) continue;
    const line = jl(id);
    const steps = Array.isArray(job.steps) ? job.steps.filter(isObj) : [];
    const stepLine = (i) => nodeLine(['jobs', id, 'steps', i]);

    // C2 timeout-minutes
    if (job.uses === undefined) {
      const t = job['timeout-minutes'];
      if (t === undefined) find('C2', line, `job "${id}" has no timeout-minutes (default 360)`, line);
      else if (typeof t === 'number' && t > 60) find('C2', keyLine(['jobs', id, 'timeout-minutes']), `job "${id}" timeout-minutes ${t} > 60 needs a reasoned allow`, line);
      else if (typeof t === 'number' && t <= 0) find('C2', keyLine(['jobs', id, 'timeout-minutes']), `job "${id}" timeout-minutes ${t} is not positive`, line);
    }

    // S4 / L1 on runs-on (+ matrix for S4)
    const ro = job['runs-on'];
    const roStr = flatStrings(ro);
    const roLine = ro !== undefined ? keyLine(['jobs', id, 'runs-on']) : line;
    const s4 = [...roStr, ...flatStrings(job.strategy && job.strategy.matrix)];
    if (s4.some((s) => /ubuntu-latest/.test(s))) find('S4', roLine, 'ubuntu-latest (literal or fallback) bills hosted minutes; use the self-hosted lane labels', line);
    for (const s of roStr) {
      const re = /\bvars\.\w+/g; let m;
      while ((m = re.exec(s))) {
        const rest = s.slice(m.index + m[0].length);
        const lit = /^\s*\|\|\s*(?:'((?:[^']|'')*)'|"([^"]*)")/.exec(rest);
        if (!lit) { find('L1', roLine, `${m[0]} in runs-on has no literal fallback (fromJSON('') errors, an unset var strands the job)`, line); continue; }
        const val = (lit[1] !== undefined ? lit[1].replace(/''/g, "'") : lit[2]).trim();
        if (val === '') find('L1', roLine, `${m[0]} fallback is empty`, line);
        else if (/^[[{]/.test(val)) { try { JSON.parse(val); } catch { find('L1', roLine, `${m[0]} fallback is not valid JSON: ${val}`, line); } }
      }
    }
    if (ctx.lane && job.uses === undefined && runsOnPush(job) && roStr.length && !roStr.some((s) => /\bdeploy\b/.test(s))) {
      find('L1', roLine, `job "${id}" runs on push to main but runs-on never names the \`deploy\` lane (declared in .github/actionlint.yaml)`, line);
    }

    // G2 no browser/emulator steps on a push-to-main run
    if (runsOnPush(job)) {
      steps.forEach((s, i) => {
        if (prOnly({ if: s.if })) return;
        if (G2_RE.test(stepText(s))) find('G2', stepLine(i), `job "${id}" runs a Playwright/Firebase-emulator step on push to main (e2e/browser/emulator work is PR-only)`, line);
      });
    }

    // G6 push job needing a job that is skipped on push
    if (runsOnPush(job) && id !== 'ci-ok' && !tolerant(job)) {
      const skipped = (nid, seen = new Set()) => {
        const n = jobs[nid]; if (!isObj(n) || seen.has(nid)) return false; seen.add(nid);
        if (prOnly(n)) return true;
        return !tolerant(n) && !/always\(\)/.test(str(n.if)) && needsOf(n).some((x) => skipped(x, seen));
      };
      for (const n of needsOf(job)) {
        if (skipped(n)) find('G6', job.needs !== undefined ? keyLine(['jobs', id, 'needs']) : line, `job "${id}" runs on push but needs "${n}", which is skipped on push, so it would be skipped too; add if: \${{ !cancelled() && !contains(needs.*.result, 'failure') }}`, line);
      }
    }

    // D2 honest deploy status
    if (job.uses === undefined && !(tr.pr && !tr.pushMain) && !prOnly(job)) {
      let last = -1;
      steps.forEach((s, i) => { if (DEPLOY_RE.test(stepText(s))) last = i; });
      const isDeploy = last >= 0 || truthy(job.environment);
      if (isDeploy) {
        const verify = steps.map((s, i) => [s, i]).filter(([s, i]) => i > last && VERIFY_IF.test(str(s.if)));
        const where = last >= 0 ? stepLine(last) : keyLine(['jobs', id, 'environment']);
        if (verify.length === 0) {
          const coe = last >= 0 && truthy(steps[last]['continue-on-error']);
          find('D2', where, `deploy job "${id}" has no later live-verify step with if: always()${coe ? ' (continue-on-error on the deploy step needs one)' : ''}`, line);
        } else if (verify.every(([s]) => truthy(s['continue-on-error']))) {
          find('D2', stepLine(verify[0][1]), `live-verify step in "${id}" has continue-on-error: it must fail the job`, line);
        }
      }
    }

    // K1 caches on persistent runners
    steps.forEach((s, i) => {
      const u = str(s.uses);
      if (/^actions\/setup-go@/.test(u) && !(s.with && (s.with.cache === false || str(s.with.cache) === 'false'))) {
        find('K1', stepLine(i), 'actions/setup-go must set `cache: false` (cache-save hangs on persistent runners)', line);
      }
      if (/^actions\/cache(\/(restore|save))?@/.test(u) && s.with && CACHE_PATH_RE.test(str(s.with.path))) {
        find('K1', stepLine(i), 'no actions/cache for Go/uv/NuGet/cargo directories on persistent runners', line);
      }
    });
  }

  // G1 aggregate job for CI workflows
  const base = path.basename(file);
  const nameStr = str(wf.name);
  const isCi = tr.pr && (/^ci\.ya?ml$/i.test(base) || /^ci$/i.test(nameStr.trim()) || ids.includes('ci-ok'));
  if (isCi) {
    const okLine = ids.includes('ci-ok') ? jl('ci-ok') : keyLine(['jobs']);
    const ok = jobs['ci-ok'];
    if (!isObj(ok)) find('G1', okLine, 'PR-triggered CI workflow has no `ci-ok` aggregate job (if: always(), needs: every PR job)');
    else {
      if (!/always\(\)/.test(str(ok.if))) find('G1', okLine, '`ci-ok` must run with if: always() (a skipped required check counts as success)');
      const need = new Set(needsOf(ok));
      const missing = ids.filter((i) => i !== 'ci-ok' && isObj(jobs[i]) && runsOnPr(jobs[i]) && !need.has(i));
      if (missing.length) find('G1', okLine, `\`ci-ok\` does not need every PR job: missing ${missing.join(', ')}`);
      const body = [str(ok.if), ...(Array.isArray(ok.steps) ? ok.steps : []).map((s) => `${str(s && s.if)} ${str(s && s.run)} ${s && s.with ? JSON.stringify(s.with) : ''}`)].join('\n');
      if (!(/failure/.test(body) && /cancelled/.test(body))) find('G1', okLine, '`ci-ok` must fail when a needed job is `failure` or `cancelled` (check needs.*.result)');
    }
    const pr = tr.raw.pull_request || tr.raw.pull_request_target || {};
    for (const k of ['paths', 'paths-ignore']) {
      if (pr[k] !== undefined) {
        const ev = isObj(wf.on) && wf.on.pull_request !== undefined ? 'pull_request' : 'pull_request_target';
        find('G1', keyLine(['on', ev, k]), `workflow with \`ci-ok\` has a workflow-level ${k} filter (path-skipped workflow leaves the required check Pending)`);
      }
    }
  }

  // O3 workflow_run names
  const wr = tr.raw.workflow_run;
  if (wr) {
    asList(wr.workflows).forEach((n, i) => {
      if (!ctx.names.has(str(n))) find('O3', nodeLine(['on', 'workflow_run', 'workflows', i]), `workflow_run.workflows names "${n}", which matches no workflow name: in this directory (a rename silently stops this workflow)`);
    });
  }
  return finish();

  function finish() {
    const out = [];
    for (const f of found) {
      const ids2 = [f.id];
      if (f.id !== 'allow') {
        const cand = [f.line, f.jobLine].filter(Boolean);
        const ok = cand.some((n) => (allows.get(n) || []).includes(f.id)) || header.includes(f.id);
        if (ok) continue;
      }
      out.push({ ...f, file, level: f.warn || !MUST.has(f.id) ? 'WARN' : 'FAIL', ids: ids2 });
    }
    return out;
  }
}

export function workflowNames(files) {
  const names = new Set();
  for (const f of files) {
    names.add(f.rel);
    try {
      const w = parseDocument(f.text).toJS();
      if (isObj(w) && w.name !== undefined) names.add(str(w.name));
    } catch { /* reported by lintWorkflow */ }
  }
  return names;
}

export function laneDeclared(repoRoot) {
  for (const n of ['actionlint.yaml', 'actionlint.yml']) {
    const p = path.join(repoRoot, '.github', n);
    if (!fs.existsSync(p)) continue;
    try {
      const c = parseDocument(fs.readFileSync(p, 'utf8')).toJS();
      return asList(c && c['self-hosted-runner'] && c['self-hosted-runner'].labels).map(str).includes('deploy');
    } catch { return false; }
  }
  return false;
}

export function lintDir(dir, cwd = process.cwd()) {
  const abs = path.resolve(cwd, dir);
  if (!fs.existsSync(abs)) return { findings: [], files: 0 };
  const rel = (p) => path.relative(cwd, p).split(path.sep).join('/');
  const files = fs.readdirSync(abs).filter((f) => /\.ya?ml$/i.test(f)).sort().map((f) => ({ rel: rel(path.join(abs, f)), text: fs.readFileSync(path.join(abs, f), 'utf8') }));
  const root = path.resolve(abs, '..', '..');
  const ctx = { names: workflowNames(files), lane: laneDeclared(root) };
  const findings = [];
  for (const f of files) findings.push(...lintWorkflow(f.text, f.rel, ctx).sort((a, b) => a.line - b.line));
  return { findings, files: files.length };
}

export const format = (f) => `standards: ${f.level} [ci-base/wf] ${f.file}:${f.line}: ${f.msg} (${f.id})`;

function main(argv) {
  const dir = argv[0] || '.github/workflows';
  const { findings, files } = lintDir(dir);
  for (const f of findings) console.log(format(f));
  const fails = findings.filter((f) => f.level === 'FAIL').length;
  console.log(`standards: [ci-base/wf] ${files} workflow file(s), ${fails} failure(s), ${findings.length - fails} warning(s)`);
  return fails ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
