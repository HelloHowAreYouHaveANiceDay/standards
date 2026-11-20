#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile ui-kit); do not edit -- re-run sync.
// Zero dependencies, offline. Generates the static ui.<domain> page for one property from design/pack.json, its token
// files and design/DESIGN.md: swatches with the contrast results of the contract pairs per theme (the SAME pairResults()
// lint.mjs UK3 uses), type/space/radius/size/shadow tokens, focus and reduced-motion notes, base elements, extension
// roles, Voice and Look, an optional Storybook link, and a theme toggle when the pack declares one.
// The layout is fixed for every property; every value comes from the pack. Not Storybook: one HTML file + two CSS files.
//
//   node .standards/ui-kit/ui-gen.mjs [repo-root] [--out dist-ui]      exit 0 ok, 1 the pack fails lint (page still written), 2 usage
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT, lint, format, subst, parsePx, isExtensionName } from './lint.mjs';
import { parseColor, hexOf, pairResults, inkResults } from './contrast.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
const ui = (cat, role) => `--ui-${cat}-${role}`;

// ---------- DESIGN.md ----------
function section(md, title) {
  const m = new RegExp(`^##[ \\t]+${title}[ \\t]*$`, 'mi').exec(md);
  if (!m) return null;
  const rest = md.slice(m.index + m[0].length);
  const next = /^##[ \t]+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

const inline = (t) => esc(t)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])/g, '<em>$1</em>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');

// paragraphs, - lists, ### subheads, > quotes: all the DESIGN.md template uses
function md(text) {
  if (!text) return '<p class="muted">Not written yet: add this section to design/DESIGN.md.</p>';
  const out = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`);
    else if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>`).join('')}</ol>`);
    else if (/^###\s/.test(lines[0])) out.push(`<h4>${inline(lines[0].replace(/^###\s+/, ''))}</h4>`, ...(lines.length > 1 ? [`<p>${inline(lines.slice(1).join(' '))}</p>`] : []));
    else if (lines.every((l) => /^>/.test(l))) out.push(`<blockquote>${inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '))}</blockquote>`);
    else out.push(`<p>${inline(lines.join(' '))}</p>`);
  }
  return out.join('\n');
}

// ---------- model ----------
function themeRoles(m) {
  // every --ui-color-* role name any theme (or the light base) assigns, contract roles first
  const names = new Set(CONTRACT.required.color);
  for (const mp of Object.values(m.themeMaps)) for (const n of mp.keys()) if (n.startsWith('--ui-color-')) names.add(n.slice('--ui-color-'.length));
  return [...names];
}

function tokenRows(m, cat) {
  const rows = [];
  for (const [name, d] of m.light) {
    if (!name.startsWith(`--ui-${cat}-`)) continue;
    const v = subst(d.value, m.lookupFor('light')) ?? d.value;
    rows.push({ name, role: name.slice(`--ui-${cat}-`.length), raw: d.value, value: v, px: parsePx(v) });
  }
  return rows.sort((a, b) => (a.px ?? Infinity) - (b.px ?? Infinity) || a.role.localeCompare(b.role, 'en', { numeric: true }));
}

// ---------- page ----------
function swatchTable(m, roles, themeNames) {
  const head = themeNames.map((t) => `<th scope="col">${esc(t)}</th>`).join('');
  const rows = roles.map((role) => {
    const cells = themeNames.map((t) => {
      const r = m.resolved[t].get(role);
      if (!r) return '<td><span class="muted">not set</span></td>';
      const hex = hexOf(r.c);
      return `<td><span class="chip" aria-hidden="true" style="background:${hex}"></span> <code>${hex}</code></td>`;
    }).join('');
    return `<tr><th scope="row"><code>${esc(ui('color', role))}</code>${CONTRACT.required.color.includes(role) ? '' : ' <span class="badge-x">extension</span>'}</th>${cells}</tr>`;
  }).join('\n');
  return `<table><caption>Every colour role, resolved per theme</caption><thead><tr><th scope="col">Role</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function contrastTable(m, t) {
  const rows = [];
  const cell = (fg, bg, fgC, bgC, ratio, min, pass) => `<tr><th scope="row"><code>${esc(fg)}</code> on <code>${esc(bg)}</code></th>`
    + `<td><span class="sample" style="color:${hexOf(fgC)};background:${hexOf(bgC)}">Aa</span></td>`
    + `<td>${ratio.toFixed(2)}:1</td><td>${min}:1</td><td class="${pass ? 'pass' : 'fail'}">${pass ? 'Pass' : 'FAIL'}</td></tr>`;
  for (const r of pairResults(CONTRACT, m.resolved[t])) rows.push(cell(ui('color', r.fg), ui('color', r.bg), r.a.c, r.b.c, r.ratio, r.min, r.pass));
  for (const r of inkResults(CONTRACT, m.resolved[t])) rows.push(cell(ui('color', r.role), ui('color', CONTRACT.extensionInk.bg), r.x.c, r.bg.c, r.ratio, r.min, r.pass));
  return `<table class="contrast" data-theme-name="${esc(t)}"><caption>Contrast, theme <strong>${esc(t)}</strong></caption>`
    + `<thead><tr><th scope="col">Pair</th><th scope="col">Sample</th><th scope="col">Ratio</th><th scope="col">Floor</th><th scope="col">Result</th></tr></thead><tbody>${rows.join('\n')}</tbody></table>`;
}

function tokenSection(m) {
  const font = ['sans', 'serif', 'mono'].map((r) => [r, m.light.get(ui('font', r))]).filter(([, d]) => d)
    .map(([r]) => `<li><code>${ui('font', r)}</code> <span class="specimen" style="font-family:var(${ui('font', r)})">The quick brown fox jumps over the lazy dog 0123456789</span></li>`).join('');
  const size = tokenRows(m, 'font-size').map((r) => `<li><code>${esc(r.name)}</code> <span class="muted">${esc(r.value)}</span><span class="specimen" style="font-size:var(${r.name})">Aa Sphinx of black quartz</span></li>`).join('');
  const space = tokenRows(m, 'space').map((r) => `<li><code>${esc(r.name)}</code> <span class="muted">${esc(r.value)}</span><span class="bar" aria-hidden="true" style="width:var(${r.name})"></span></li>`).join('');
  const radius = tokenRows(m, 'radius').map((r) => `<li><code>${esc(r.name)}</code> <span class="muted">${esc(r.value)}</span><span class="box" aria-hidden="true" style="border-radius:var(${r.name})"></span></li>`).join('');
  const sizes = tokenRows(m, 'size').map((r) => `<li><code>${esc(r.name)}</code> <span class="muted">${esc(r.value)}</span></li>`).join('');
  const shadow = tokenRows(m, 'shadow').map((r) => `<li><code>${esc(r.name)}</code> <span class="box" aria-hidden="true" style="box-shadow:var(${r.name})"></span></li>`).join('');
  const none = '<p class="muted">None declared.</p>';
  const group = (title, items) => `<section class="group" aria-labelledby="g-${slug(title)}"><h3 id="g-${slug(title)}">${title}</h3>${items ? `<ul class="tokens">${items}</ul>` : none}</section>`;
  return [group('Font families', font), group('Type scale', size), group('Space scale', space), group('Radius', radius), group('Size', sizes), group('Shadow', shadow)].join('\n');
}

function elements() {
  return `<div class="elements">
<p><button type="button">Primary action</button> <button type="button" disabled>Disabled</button></p>
<p><label for="el-name">Field label</label><br><input id="el-name" type="text" value="Sample text" autocomplete="off"></p>
<p><label for="el-sel">Select</label><br><select id="el-sel"><option>First option</option><option>Second option</option></select></p>
<p><a href="#elements">An inline link</a> inside a sentence of body text.</p>
<p role="alert" class="alert-demo">Alert: something needs attention.</p>
<p><span class="badge-demo">Badge</span></p>
<table><caption>Table</caption><thead><tr><th scope="col">Name</th><th scope="col">Status</th></tr></thead><tbody><tr><td>Row one</td><td>Open</td></tr><tr><td>Row two</td><td>Closed</td></tr></tbody></table>
</div>`;
}

export function buildPage(model, { design = '', root = '' } = {}) {
  const m = model;
  const themeNames = Object.keys(m.themes);
  const roles = themeRoles(m);
  const pk = m.pack;
  const sb = typeof pk.storybook === 'string' ? pk.storybook : null;
  // a toggle works when a non-light theme is selected by [data-theme="x"] (the Broadsheet convention)
  let toggle = null;
  for (const t of themeNames) {
    if (t === 'light') continue;
    const hit = m.themes[t].map((s) => /\[(data-[\w-]+)=["']?([\w-]+)["']?\]/.exec(s)).find(Boolean);
    if (hit) { toggle = { attr: hit[1], value: hit[2], name: t }; break; }
  }
  const baseText = m.baseFiles.map((f) => f.text).join('\n') + m.tokenFiles.map((f) => f.text).join('\n');
  const motion = /prefers-reduced-motion/.test(baseText);
  const exts = m.exts;
  const extRows = [];
  for (const [name, d] of m.light) {
    if (!name.startsWith('--ui-') || !isExtensionName(name, exts)) continue;
    const v = subst(d.value, m.lookupFor('light')) ?? d.value;
    extRows.push({ name, value: v, color: name.startsWith('--ui-color-') });
  }
  const extHtml = exts.length === 0 ? '<p class="muted">This pack declares no extension roles.</p>'
    : `<p>Declared in <code>pack.json</code>: ${exts.map((e) => `<code>${esc(e)}</code>`).join(', ')}.</p>`
      + `<ul class="tokens">${extRows.map((r) => `<li><code>${esc(r.name)}</code> ${r.color && parseColor(r.value) ? `<span class="chip" aria-hidden="true" style="background:var(${r.name})"></span> ` : ''}<span class="muted">${esc(r.value)}</span></li>`).join('')}</ul>`;
  const conv = m.converging ? `<p class="note">This property converges on <strong>${esc(pk.pack)} ${esc(pk.version)}</strong> and sets only its own spot colour${exts.length ? ' and extensions' : ''}.</p>` : '';
  const title = `${pk.pack} UI`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${themeNames.includes('dark') ? 'light dark' : 'light'}">
<title>${esc(title)} · design pack ${esc(pk.version)}</title>
<link rel="stylesheet" href="pack.css">
<link rel="stylesheet" href="ui.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
<h1>${esc(pk.pack)} <span class="muted">design pack ${esc(pk.version)}</span></h1>
<nav aria-label="On this page"><ul>
<li><a href="#colour">Colour</a></li><li><a href="#tokens">Tokens</a></li><li><a href="#focus">Focus and motion</a></li><li><a href="#elements">Elements</a></li><li><a href="#extensions">Extensions</a></li><li><a href="#voice">Voice</a></li><li><a href="#look">Look</a></li>${sb ? '<li><a href="#storybook">Storybook</a></li>' : ''}
</ul></nav>
${toggle ? `<button type="button" id="theme-toggle" class="toggle" aria-pressed="false" hidden>Dark theme</button>` : ''}
</header>
<main id="main">
${conv}
<section id="colour" aria-labelledby="h-colour"><h2 id="h-colour">Colour</h2>
${swatchTable(m, roles, themeNames)}
<p class="muted">Contrast comes from the same function the lint rule UK3 runs. AA floors: text 4.5:1; borders, focus and marks 3:1.</p>
${themeNames.map((t) => contrastTable(m, t)).join('\n')}
</section>
<section id="tokens" aria-labelledby="h-tokens"><h2 id="h-tokens">Tokens</h2>
${tokenSection(m)}
</section>
<section id="focus" aria-labelledby="h-focus"><h2 id="h-focus">Focus and motion</h2>
<p>Every interactive element shows a ${esc(subst(m.light.get(ui('size', 'focus-ring'))?.value ?? '2px', m.lookupFor('light')))} ring in <code>--ui-color-focus</code> (WCAG 2.4.7, 2.4.13). Press Tab to try the live controls below.</p>
<p><button type="button">Focus me</button> <a href="#focus">Or me</a> <input type="text" aria-label="Focus demo field" value="Or me"> <span class="ring-static" tabindex="-1">Ring as drawn</span></p>
<p>Motion: ${motion ? 'this pack ships a <code>prefers-reduced-motion: reduce</code> block that removes animation and transitions.' : '<strong>this pack has no <code>prefers-reduced-motion</code> block; lint UK7 fails if it moves anything.</strong>'} Touch targets are at least ${esc(subst(m.light.get(ui('size', 'touch-min'))?.value ?? '44px', m.lookupFor('light')))} on coarse pointers.</p>
</section>
<section id="elements" aria-labelledby="h-elements"><h2 id="h-elements">Base elements</h2>
<p class="muted">Plain HTML, styled only by the pack's own base.css.</p>
${elements()}
</section>
<section id="extensions" aria-labelledby="h-ext"><h2 id="h-ext">Extension roles</h2>
${extHtml}
</section>
<section id="voice" aria-labelledby="h-voice"><h2 id="h-voice">Voice</h2>
${md(section(design, 'Voice'))}
</section>
<section id="look" aria-labelledby="h-look"><h2 id="h-look">Look</h2>
${md(section(design, 'Look'))}
</section>
${sb ? `<section id="storybook" aria-labelledby="h-sb"><h2 id="h-sb">Storybook</h2><p>The component library has a live Storybook: <a href="${esc(sb)}">${esc(sb)}</a>.</p></section>` : ''}
</main>
<footer><p class="muted">Generated by ui-kit <code>ui-gen.mjs</code> from <code>design/pack.json</code>. Layout is the same for every property; the values are this pack's.</p></footer>
${toggle ? `<script>
(function () {
  var b = document.getElementById('theme-toggle'), r = document.documentElement, on = false;
  b.hidden = false;
  b.addEventListener('click', function () {
    on = !on;
    if (on) r.setAttribute(${JSON.stringify(toggle.attr)}, ${JSON.stringify(toggle.value)}); else r.setAttribute(${JSON.stringify(toggle.attr)}, 'light');
    b.setAttribute('aria-pressed', String(on));
  });
})();
</script>` : ''}
</body>
</html>
`;
}

// Page chrome. Reads only --ui-* names (declared by the pack); no motion, no external fonts.
export const UI_CSS = `/* ui-kit ui-gen.mjs layout: identical for every property. */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; line-height: 1.5; font-size: 1rem; }
.skip { position: absolute; left: var(--ui-space-2); top: -4rem; background: var(--ui-color-primary); color: var(--ui-color-on-primary); padding: var(--ui-space-2) var(--ui-space-3); }
.skip:focus { top: var(--ui-space-2); }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ui-space-3) var(--ui-space-5); padding: var(--ui-space-4) var(--ui-space-5); border-bottom: 1px solid var(--ui-color-line); background: var(--ui-color-panel); }
.top h1 { margin: 0; font-size: 1.5rem; }
.top nav ul { display: flex; flex-wrap: wrap; gap: var(--ui-space-3); list-style: none; margin: 0; padding: 0; }
main, footer { max-width: 64rem; margin: 0 auto; padding: var(--ui-space-4) var(--ui-space-5); }
section { margin: var(--ui-space-6) 0; }
h2 { border-bottom: 1px solid var(--ui-color-line); padding-bottom: var(--ui-space-2); }
.muted { color: var(--ui-color-text-muted); }
.note { background: var(--ui-color-panel); border-left: 4px solid var(--ui-color-spot); padding: var(--ui-space-3) var(--ui-space-4); }
table { border-collapse: collapse; width: 100%; margin: var(--ui-space-4) 0; }
caption { text-align: left; font-weight: 600; padding-bottom: var(--ui-space-2); }
th, td { text-align: left; padding: var(--ui-space-2) var(--ui-space-3); border-bottom: 1px solid var(--ui-color-line); vertical-align: middle; }
.chip { display: inline-block; width: 1.5rem; height: 1.5rem; vertical-align: middle; border: 1px solid var(--ui-color-border); }
.sample { display: inline-block; padding: 0 var(--ui-space-3); border: 1px solid var(--ui-color-border); font-weight: 700; }
.pass { font-weight: 600; } .fail { font-weight: 700; text-decoration: underline; }
.fail::before { content: "\\2716  "; } .pass::before { content: "\\2714  "; }
.badge-x, .badge-demo { display: inline-block; font-size: 0.75rem; padding: 0 var(--ui-space-2); border: 1px solid var(--ui-color-border); border-radius: 999px; }
.group { margin: var(--ui-space-5) 0; }
.tokens { list-style: none; margin: 0; padding: 0; }
.tokens li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ui-space-2) var(--ui-space-4); padding: var(--ui-space-2) 0; border-bottom: 1px solid var(--ui-color-line); }
.specimen { flex-basis: 100%; }
.bar { display: inline-block; height: 1rem; background: var(--ui-color-spot); }
.box { display: inline-block; width: 3rem; height: 3rem; background: var(--ui-color-panel); border: 1px solid var(--ui-color-border); }
.ring-static { display: inline-block; padding: var(--ui-space-1) var(--ui-space-3); outline: var(--ui-size-focus-ring) solid var(--ui-color-focus); outline-offset: 2px; }
.alert-demo { background: var(--ui-color-alert); color: var(--ui-color-on-alert); padding: var(--ui-space-3) var(--ui-space-4); }
.toggle { margin-left: auto; }
blockquote { margin: var(--ui-space-4) 0; padding-left: var(--ui-space-4); border-left: 4px solid var(--ui-color-spot); }
`;

// ---------- CLI ----------
export function generate(root, outDir) {
  const out = {};
  const findings = lint(root, out);
  const m = out.model;
  if (!m) return { findings, written: null };
  const read = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
  const design = read('design/DESIGN.md');
  fs.mkdirSync(outDir, { recursive: true });
  // pack.css = the pack's own files in the order the lint reads them: vendored tokens, own tokens, base files
  const css = [...m.tokenFiles, ...m.baseFiles].map((f) => `/* ${f.rel} */\n${f.text}`).join('\n');
  fs.writeFileSync(path.join(outDir, 'pack.css'), css);
  fs.writeFileSync(path.join(outDir, 'ui.css'), UI_CSS);
  fs.writeFileSync(path.join(outDir, 'index.html'), buildPage(m, { design, root }));
  return { findings, written: outDir };
}

export function main(argv = process.argv.slice(2)) {
  let root = process.cwd(), out = 'dist-ui';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i]; else if (argv[i].startsWith('--')) { console.error(`ui-gen: unknown flag ${argv[i]}`); return 2; } else root = path.resolve(argv[i]);
  }
  if (!out) { console.error('ui-gen: --out needs a directory'); return 2; }
  const outDir = path.resolve(root, out);
  const { findings, written } = generate(root, outDir);
  const fails = findings.filter((f) => f.level === 'FAIL');
  for (const f of fails) console.log(format(f));
  if (!written) { console.log('ui-gen: the pack could not be read (fix the findings above); no page written'); return 1; }
  console.log(`ui-gen: wrote ${path.relative(root, outDir) || '.'}/index.html${fails.length ? ` (the pack fails lint: ${fails.length} finding(s))` : ''}`);
  return fails.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main();
