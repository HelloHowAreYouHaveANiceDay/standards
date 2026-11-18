// analytics-web fixture: a clean tier-1 static-site follower that passes lint.mjs, plus injected defects. A1 (missing plan)
// fails check.mjs naming the file; A2-A8 are WARN in 1.0.0, so each defect is proved by the finding naming its file with the
// gate still exiting 0 (they flip to FAIL in 1.1.0). lint.mjs is offline and zero-dep, so no downloads.
import fs from 'node:fs';
import path from 'node:path';

const PLAN = `${JSON.stringify({
  schema: 'analytics-plan/1',
  tier: 1,
  property: { domain: 'example.com', hosts: ['example.com'], ga4: 'G-ABC123XYZ', posthog: null, url_params: ['utm_*', 'gclid'] },
  events: {
    lookup_submitted: { stage: 'engage', sinks: ['ga4'], params: { method: { enum: ['typed', 'url'] } } },
    lookup_completed: { stage: 'activate', key_event: true, sinks: ['ga4'] },
  },
}, null, 2)}\n`;
const PAGE = `<!doctype html>
<html>
<head>
<script type="module">
  import { initAnalytics } from "/.standards/analytics-web/track.mjs";
  import plan from "/analytics.plan.json" with { type: "json" };
  initAnalytics(plan);
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"></script>
</head>
<body></body>
</html>
`;
const APP = `import { track } from "./.standards/analytics-web/track.mjs";
track("lookup_submitted", { method: "typed" });
track("lookup_completed");
`;

export const fixture = {
  id: 'analytics-web',
  profiles: ['base@1.0.0', 'analytics-web@1.0.2'],
  files: {
    'analytics.plan.json': PLAN,
    'index.html': PAGE,
    'src/app.mjs': APP,
  },
  inject: (dir, h) => {
    const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    const keep = (rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), 'utf8') : null);
    const restore = (rel, before) => { if (before === null) fs.rmSync(path.join(dir, rel)); else w(rel, before); h.git('add', '-A'); };
    // fails: the gate exits 1 naming the file. warns: the gate still exits 0 and the WARN names the file.
    const bites = (msg, re, rel, text, fails = false) => {
      const before = keep(rel);
      if (text === null) fs.rmSync(path.join(dir, rel)); else w(rel, text);
      h.git('add', '-A');
      const r = h.check();
      h.step((fails ? r.code === 1 : r.code === 0) && re.test(r.out), msg, r.out);
      restore(rel, before);
    };
    bites('analytics-web: a missing analytics.plan.json fails A1', /FAIL \[analytics-web\/A1\] analytics\.plan\.json: missing/, 'analytics.plan.json', null, true);
    bites('analytics-web: an event name not in the plan warns A3 naming the file', /WARN \[analytics-web\/A3\] src\/app\.mjs:4: track\(\) sends an event that is not in analytics\.plan\.json/, 'src/app.mjs', `${APP}track("mystery_event");\n`);
    bites('analytics-web: a computed tool_load_${x} name warns A3', /WARN \[analytics-web\/A3\] src\/app\.mjs:4: track\(\) gets a computed event name/, 'src/app.mjs', `${APP}track(\`tool_load_\${x}\`);\n`);
    bites('analytics-web: an {address} param warns A4', /WARN \[analytics-web\/A4\] src\/app\.mjs:4: track\(\) sends a param named address/, 'src/app.mjs', `${APP}track("lookup_submitted", { address });\n`);
    bites('analytics-web: a {zip} param warns A4', /WARN \[analytics-web\/A4\] src\/app\.mjs:4: track\(\) sends a param named zip/, 'src/app.mjs', `${APP}track("lookup_submitted", { zip });\n`);
    bites('analytics-web: a {latitude} param warns A4', /WARN \[analytics-web\/A4\] src\/app\.mjs:4: track\(\) sends a param named latitude/, 'src/app.mjs', `${APP}track("lookup_submitted", { latitude });\n`);
    {
      const before = keep('src/app.mjs');
      w('src/app.mjs', `${APP}track("lookup_submitted", { target_state, target_relation, target_distance });\n`);
      h.git('add', '-A');
      const r = h.check();
      h.step(r.code === 0 && !/analytics-web\/A4/.test(r.out), 'analytics-web: target_state/target_relation/target_distance are allowed (exact-key match)', r.out);
      restore('src/app.mjs', before);
    }
    bites('analytics-web: a second gtag config warns A2', /WARN \[analytics-web\/A2\] index\.html:\d+: second gtag\('config'\)/, 'index.html', PAGE.replace('</head>', "<script>gtag('config','G-ABC123XYZ')</script>\n<script>gtag('config','G-ABC123XYZ')</script>\n</head>"));
    bites('analytics-web: a raw config without a host gate warns A5', /WARN \[analytics-web\/A5\] index\.html:\d+: no host gate before gtag\('config'\)/, 'index.html', PAGE.replace(/<script type="module">[\s\S]*?<\/script>/, "<script>gtag('config','G-ABC123XYZ')</script>"));
    bites('analytics-web: utm_medium=Social warns A8', /WARN \[analytics-web\/A8\] index\.html:\d+: a link's utm_medium has uppercase/, 'index.html', PAGE.replace('<body>', '<body><a href="https://example.com/?utm_source=x&utm_medium=Social">x</a>'));
    bites('analytics-web: unknown utm_medium=ai-bot warns A8', /WARN \[analytics-web\/A8\] index\.html:\d+: a link's utm_medium is not one of/, 'index.html', PAGE.replace('<body>', '<body><a href="https://example.com/?utm_source=x&utm_medium=ai-bot">x</a>'));
    {
      const before = keep('index.html');
      w('index.html', PAGE.replace('<body>', '<body><a href="https://example.com/?utm_source=claude&utm_medium=ai-agent">x</a>'));
      h.git('add', '-A');
      const r = h.check();
      h.step(r.code === 0 && !/analytics-web\/A8/.test(r.out), 'analytics-web: utm_medium=ai-agent is allowed (A8)', r.out);
      restore('index.html', before);
    }
  },
};
