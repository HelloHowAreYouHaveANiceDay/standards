#!/usr/bin/env node
// mcp-connector: offline checker for a follower-owned MCP connector manifest, plus an optional live contract test.
//
//   node .standards/mcp-connector/connector.mjs [<dir>]                       offline check (what check.mjs runs)
//   node .standards/mcp-connector/connector.mjs --scaffold [<dir>]            copy templates that are absent; never overwrite
//   node .standards/mcp-connector/connector.mjs --live <url> [--call <tool> '<json args>']   contract test (never in the gate)
//
// Check prints one line per finding, `<file>: M<n> <what>`; exit 0 clean, 1 findings, 2 usage.
// --live exits 0 pass, 1 fail, 3 network error. Zero dependencies (node built-ins; fetch only under --live).
// Rules M1-M10 and L1-L4: see RULES.md next to this folder's check.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, 'templates');
const MANIFEST = 'connector/manifest.json';
const DOCS = 'connector/docs.md';
const PRIVACY = 'connector/privacy.md';

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const INJECTION = [/ignore (all )?previous/i, /system prompt/i, /always call/i, /do not tell the user/i, /<important>/i];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const METHOD_PROPS = ['method', 'http_method', 'verb'];

// ------------------------------------------------------------------ offline check
export function check(dir = '.') {
  const out = [];
  const add = (file, rule, msg) => out.push(`${file}: ${rule} ${msg}`);
  const mpath = path.join(dir, MANIFEST);
  if (!fs.existsSync(mpath)) { add(MANIFEST, 'M1', 'is missing (run: node .standards/mcp-connector/connector.mjs --scaffold)'); return out; }
  let m;
  try { m = JSON.parse(read(mpath)); } catch (e) { add(MANIFEST, 'M1', `does not parse: ${e.message}`); return out; }
  if (!isObj(m)) { add(MANIFEST, 'M1', 'must be a JSON object'); return out; }

  // M1: required shape
  const need = (cond, what) => { if (!cond) add(MANIFEST, 'M1', what); };
  need(m.schemaVersion === 1, 'schemaVersion must be 1');
  need(nonEmpty(m.name), 'name is required');
  need(nonEmpty(m.title), 'title is required');
  need(typeof m.endpoint === 'string' && /^https:\/\/\S+$/.test(m.endpoint), 'endpoint must be an https URL');
  need(m.auth === 'none' || m.auth === 'oauth', 'auth must be "none" or "oauth"');
  need(Array.isArray(m.protocolVersions) && m.protocolVersions.length > 0 && m.protocolVersions.every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)), 'protocolVersions must be a non-empty list of YYYY-MM-DD');
  need(Array.isArray(m.directories) && m.directories.every((d) => ['claude', 'chatgpt', 'muse', 'other'].includes(d)), 'directories must be a list drawn from claude, chatgpt, muse, other');
  const links = isObj(m.links) ? m.links : {};
  for (const k of ['docs', 'privacy', 'support']) need(nonEmpty(links[k]), `links.${k} is required`);
  const data = isObj(m.data) ? m.data : {};
  need(Array.isArray(data.collected) && data.collected.length > 0 && data.collected.every(nonEmpty), 'data.collected must be a non-empty list of strings');
  need(nonEmpty(data.retention), 'data.retention is required');
  need(typeof data.training === 'boolean', 'data.training must be a boolean');
  need(m.testMode === undefined || m.testMode === null || nonEmpty(m.testMode), 'testMode must be a non-empty string or null');
  need(m.wording === undefined || (isObj(m.wording) && (m.wording.forbidden === undefined || (Array.isArray(m.wording.forbidden) && m.wording.forbidden.every(nonEmpty)))), 'wording.forbidden must be a list of words');
  if (!Array.isArray(m.tools) || m.tools.length === 0) { add(MANIFEST, 'M1', 'tools must be a non-empty list'); return out; }

  const forbidden = (m.wording && Array.isArray(m.wording.forbidden) ? m.wording.forbidden : []).filter(nonEmpty);
  const seen = new Set();
  m.tools.forEach((t, i) => {
    if (!isObj(t)) { add(MANIFEST, 'M1', `tools[${i}] must be an object`); return; }
    const id = nonEmpty(t.name) ? `tool ${t.name}` : `tools[${i}]`;
    const f = (rule, msg) => add(MANIFEST, rule, `${id}: ${msg}`);
    // M2
    if (typeof t.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(t.name)) f('M2', 'name must match ^[a-z][a-z0-9_]{0,63}$');
    else if (seen.has(t.name)) f('M2', 'name is not unique'); else seen.add(t.name);
    if (!nonEmpty(t.title)) f('M2', 'title is required');
    if (typeof t.description !== 'string' || t.description.length < 20 || t.description.length > 1024) f('M2', 'description must be 20-1024 characters');
    // M3
    const a = isObj(t.annotations) ? t.annotations : {};
    const hints = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];
    const missing = hints.filter((h) => typeof a[h] !== 'boolean');
    if (missing.length) f('M3', `annotations must set booleans: ${missing.join(', ')}`);
    if (!['read', 'write', 'sensitive_write'].includes(t.class)) f('M3', 'class must be read, write or sensitive_write');
    else if (!missing.length) {
      if (t.class === 'read' && !(a.readOnlyHint === true && a.destructiveHint === false)) f('M3', 'class read needs readOnlyHint true and destructiveHint false');
      if (t.class === 'write' && a.readOnlyHint !== false) f('M3', 'class write needs readOnlyHint false');
      if (t.class === 'sensitive_write' && !(a.readOnlyHint === false && a.destructiveHint === true)) f('M3', 'class sensitive_write needs readOnlyHint false and destructiveHint true');
    }
    // M4
    const props = isObj(t.inputSchema) && isObj(t.inputSchema.properties) ? t.inputSchema.properties : {};
    if (t.class === 'read') {
      if (t.transaction !== false) f('M4', 'a read tool must set transaction: false');
      for (const p of METHOD_PROPS) {
        if (!(p in props)) continue;
        const en = isObj(props[p]) ? props[p].enum : null;
        if (!(Array.isArray(en) && en.length > 0 && en.every((v) => SAFE_METHODS.has(v)))) f('M4', `a read tool must not take "${p}" (a read/write catch-all) unless it is an enum of GET, HEAD, OPTIONS`);
      }
    }
    // M5
    for (const [field, text] of [['title', t.title], ['description', t.description]]) {
      if (typeof text !== 'string') continue;
      for (const re of INJECTION) if (re.test(text)) f('M5', `${field} matches model-instruction pattern ${re} (describe what the tool does, not how the model should behave)`);
    }
    // M6
    for (const k of ['inputSchema', 'outputSchema']) if (!isObj(t[k]) || t[k].type !== 'object') f('M6', `${k} must have type "object"`);
    if (isObj(t.inputSchema)) {
      if (t.inputSchema.additionalProperties !== false) f('M6', 'inputSchema must set additionalProperties: false');
      for (const [p, s] of Object.entries(props)) if (!isObj(s) || !nonEmpty(s.description)) f('M6', `inputSchema property "${p}" needs a description`);
    }
    // M7
    if (t.transaction === true) {
      if (t.class !== 'sensitive_write') f('M7', 'a transaction tool must be class sensitive_write');
      const req = isObj(t.inputSchema) && Array.isArray(t.inputSchema.required) ? t.inputSchema.required : [];
      if (!(req.includes('idempotency_key') && isObj(props.idempotency_key) && props.idempotency_key.type === 'string')) f('M7', 'a transaction tool must require an idempotency_key string input');
      if (!nonEmpty(m.testMode)) f('M7', 'a transaction tool needs a non-empty manifest testMode (how a reviewer tests without real charges)');
    }
    // M9
    if (!Array.isArray(t.errors) || t.errors.length === 0) f('M9', 'errors must list at least one error');
    else {
      const codes = new Set();
      for (const e of t.errors) {
        const c = isObj(e) ? e.code : undefined;
        if (typeof c !== 'string' || !/^[a-z][a-z0-9_]*$/.test(c)) f('M9', `error code ${JSON.stringify(c)} must match ^[a-z][a-z0-9_]*$`);
        else if (codes.has(c)) f('M9', `error code "${c}" is not unique`); else codes.add(c);
      }
    }
    if (!nonEmpty(t.rateLimit)) f('M9', 'rateLimit is required');
    // M10
    for (const w of forbidden) {
      const re = new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(w)}($|[^A-Za-z0-9_])`, 'i');
      for (const [field, text] of [['title', t.title], ['description', t.description]]) if (typeof text === 'string' && re.test(text)) f('M10', `${field} contains forbidden word "${w}"`);
    }
  });

  // M8
  const docs = path.join(dir, DOCS); const priv = path.join(dir, PRIVACY);
  const placeholder = (file, text) => { if (text.includes('{{')) add(file, 'M8', 'still contains a {{ placeholder'); };
  placeholder(MANIFEST, read(mpath));
  if (!fs.existsSync(docs)) add(DOCS, 'M8', 'is missing');
  else {
    const t = read(docs); placeholder(DOCS, t);
    for (const n of seen) if (!t.includes(n)) add(DOCS, 'M8', `does not name tool "${n}"`);
  }
  if (!fs.existsSync(priv)) add(PRIVACY, 'M8', 'is missing');
  else {
    const t = read(priv); placeholder(PRIVACY, t);
    for (const w of ['retention', 'training']) if (!t.toLowerCase().includes(w)) add(PRIVACY, 'M8', `does not mention "${w}"`);
  }
  return out;
}

// ------------------------------------------------------------------ scaffold
function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, r)); else out.push(r);
  }
  return out.sort();
}

export function scaffold(dir = '.') {
  const lines = [];
  for (const rel of walk(path.join(TEMPLATES, 'connector'))) {
    const target = path.join(dir, 'connector', rel);
    if (fs.existsSync(target)) { lines.push(`kept     connector/${rel}`); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fs.readFileSync(path.join(TEMPLATES, 'connector', rel)));
    lines.push(`wrote    connector/${rel}`);
  }
  return lines;
}

// ------------------------------------------------------------------ live contract test
const stable = (v) => JSON.stringify(v, (_, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

export async function live(url, { call } = {}, dir = '.') {
  const m = JSON.parse(read(path.join(dir, MANIFEST)));
  const results = [];
  const rec = (id, ok, msg) => results.push({ id, ok, msg });
  let n = 0;
  const post = async (body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json };
  };
  const rpc = (method, params) => post({ jsonrpc: '2.0', id: ++n, method, params });

  const init = await rpc('initialize', { protocolVersion: m.protocolVersions[0], capabilities: {}, clientInfo: { name: 'connector-check', version: '1.0.0' } });
  const r = init.json && init.json.result;
  rec('L1', Boolean(r && m.protocolVersions.includes(r.protocolVersion) && r.capabilities && r.capabilities.tools), `initialize returned HTTP ${init.status}, protocolVersion ${r ? r.protocolVersion : 'none'}, capabilities.tools ${r && r.capabilities && r.capabilities.tools ? 'present' : 'absent'}`);
  const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  rec('L1', note.status === 202, `notifications/initialized returned HTTP ${note.status}, expected 202`);

  const list = await rpc('tools/list', {});
  const tools = list.json && list.json.result && Array.isArray(list.json.result.tools) ? list.json.result.tools : null;
  if (!tools) rec('L2', false, `tools/list returned no tools array (HTTP ${list.status})`);
  else {
    const want = m.tools.map((t) => t.name).sort().join(',');
    const got = tools.map((t) => t.name).sort().join(',');
    rec('L2', want === got, `tools/list names ${got || '(none)'}; manifest has ${want}`);
    for (const mt of m.tools) {
      const t = tools.find((x) => x.name === mt.name);
      if (!t) continue;
      for (const k of ['title', 'annotations', 'inputSchema']) rec('L2', stable(t[k]) === stable(mt[k]), `tool ${mt.name}: ${k} ${stable(t[k]) === stable(mt[k]) ? 'equals' : 'differs from'} the manifest`);
    }
  }

  const unk = await rpc('connector-check/no-such-method', {});
  rec('L3', Boolean(unk.json && unk.json.error && unk.json.error.code === -32601), `unknown method returned ${unk.json && unk.json.error ? `error ${unk.json.error.code}` : `HTTP ${unk.status} with no JSON-RPC error`}, expected -32601`);

  if (call) {
    const mt = m.tools.find((t) => t.name === call.tool);
    const res = await rpc('tools/call', { name: call.tool, arguments: call.args });
    const cr = res.json && res.json.result;
    const ok = Boolean(mt && cr && Array.isArray(cr.content));
    let msg = `tools/call ${call.tool} ${ok ? 'returned content[]' : `did not return a result with content[] (HTTP ${res.status})`}`;
    let pass = ok;
    const req = mt && isObj(mt.outputSchema) && isObj(mt.outputSchema.properties) && Object.keys(mt.outputSchema.properties).length > 0 && Array.isArray(mt.outputSchema.required) ? mt.outputSchema.required : [];
    if (ok && req.length) {
      const sc = isObj(cr.structuredContent) ? cr.structuredContent : null;
      const lacking = sc ? req.filter((k) => !(k in sc)) : req;
      if (lacking.length) { pass = false; msg += `; structuredContent lacks ${lacking.join(', ')}`; }
    }
    rec('L4', pass, msg);
  }
  return results;
}

// ------------------------------------------------------------------ CLI
async function main(argv) {
  const args = [...argv];
  const take = (flag) => { const i = args.indexOf(flag); if (i < 0) return false; args.splice(i, 1); return true; };
  const usage = (msg) => { console.error(`connector: ${msg}\nusage: connector.mjs [<dir>] | --scaffold [<dir>] | --live <url> [--call <tool> '<json args>']`); return 2; };
  const doScaffold = take('--scaffold');
  const li = args.indexOf('--live');
  let url = null; let call = null;
  if (li >= 0) {
    url = args[li + 1];
    if (!url || url.startsWith('--')) return usage('--live needs a url');
    args.splice(li, 2);
    const ci = args.indexOf('--call');
    if (ci >= 0) {
      const tool = args[ci + 1]; const raw = args[ci + 2];
      if (!tool || raw === undefined) return usage("--call needs a tool name and '<json args>'");
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return usage('--call args are not valid JSON'); }
      call = { tool, args: parsed }; args.splice(ci, 3);
    }
  } else if (args.includes('--call')) return usage('--call needs --live');
  if (args.some((a) => a.startsWith('--'))) return usage(`unknown option ${args.find((a) => a.startsWith('--'))}`);
  if (args.length > 1) return usage('at most one <dir>');
  const dir = args[0] || '.';
  if (doScaffold && url) return usage('--scaffold and --live do not combine');

  if (doScaffold) { for (const l of scaffold(dir)) console.log(l); return 0; }
  if (url) {
    if (!fs.existsSync(path.join(dir, MANIFEST))) { console.error(`${MANIFEST}: M1 is missing`); return 1; }
    let results;
    try { results = await live(url, { call }, dir); } catch (e) { console.error(`connector: network error: ${e.cause ? e.cause.message : e.message}`); return 3; }
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} ${r.msg}`);
    return results.every((r) => r.ok) ? 0 : 1;
  }
  const findings = check(dir);
  for (const l of findings) console.log(l);
  return findings.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`connector: ${e.message}`); process.exitCode = 3; });
}
