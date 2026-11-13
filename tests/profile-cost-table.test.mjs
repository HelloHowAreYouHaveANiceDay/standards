// cost-table 1.0.0: schema (every row has its required fields), exact-id lookup that throws on an unknown model,
// list-cost arithmetic, and the released files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT_ROOT, node } from './helpers.mjs';

const DIR = process.env.COST_TABLE_SRC ? path.join(KIT_ROOT, 'src/profiles/cost-table') : path.join(KIT_ROOT, 'profiles/cost-table/1.0.0');
const STD = path.join(DIR, '.standards/cost-table');
const T = await import(pathToFileURL(path.join(STD, 'table.mjs')).href);
const table = () => structuredClone(T.load(path.join(STD, 'cost-table.json')));
const row = (t, id) => t.rows.find((r) => r.id === id);

test('the shipped table is valid and has model, sub and runner rows', () => {
  const t = table();
  assert.deepEqual(T.validate(t), []);
  for (const k of ['model', 'sub', 'runner']) assert.ok(t.rows.some((r) => r.kind === k), k);
  assert.ok(t.rows.filter((r) => r.kind === 'model').length >= 10);
});

test('every model row has all rates, an https source and a checked date', () => {
  for (const r of table().rows.filter((x) => x.kind === 'model')) {
    for (const f of T.RATE_FIELDS) assert.ok(Number.isFinite(r[f]) && r[f] >= 0, `${r.id}.${f}`);
    assert.match(r.source, /^https:\/\//, r.id);
    assert.match(r.checked, /^\d{4}-\d{2}-\d{2}$/, r.id);
  }
});

test('round 1: runner rows are 0 / not measured', () => {
  for (const r of table().rows.filter((x) => x.kind === 'runner')) assert.deepEqual([r.usd_per_min, r.measured], [0, false], r.id);
});

test('schema: each missing or bad field is reported naming the row', () => {
  const bad = (mut, re) => { const t = table(); mut(t); assert.match(T.validate(t).join('\n'), re); };
  for (const f of T.RATE_FIELDS) bad((t) => { delete row(t, 'claude-opus-5-5')[f]; }, new RegExp(`claude-opus-5-5\\): ${f} must be a number`));
  bad((t) => { row(t, 'claude-opus-5-5').input = -1; }, /input must be a number >= 0/);
  bad((t) => { delete row(t, 'claude-opus-5-5').source; }, /source must be an https URL/);
  bad((t) => { row(t, 'claude-opus-5-5').source = 'http://x'; }, /source must be an https URL/);
  bad((t) => { row(t, 'claude-opus-5-5').checked = '11/13/2026'; }, /checked must be a YYYY-MM-DD/);
  bad((t) => { row(t, 'claude').shadow_multiplier = 0; }, /shadow_multiplier must be a number > 0/);
  bad((t) => { row(t, 'self-hosted').measured = 'no'; }, /measured must be true or false/);
  bad((t) => { row(t, 'self-hosted').usd_per_min = 0.5; }, /not-measured runner must be priced 0/);
  bad((t) => { t.rows.push({ kind: 'model', id: 'claude-opus-5-5', vendor: 'a', input: 1, output: 1, cache_read: 1, cache_write: 1, source: 'https://x', checked: '2026-01-01' }); }, /duplicate model id claude-opus-5-5/);
  bad((t) => { t.rows.push({ kind: 'bogus', id: 'x' }); }, /kind must be model \| sub \| runner/);
  bad((t) => { t.schema = 2; }, /schema must be 1/);
});

test('lookup: exact id and alias resolve; an unknown or missing model throws (no fallback rate)', () => {
  const t = table();
  assert.equal(T.model(t, 'claude-sonnet-5-5').output, 10);
  assert.equal(T.model(t, 'claude-haiku-4-5-20251001').id, 'claude-haiku-4-5');
  for (const id of ['claude-nonexistent-9', 'us.anthropic.claude-sonnet-5-5', '', undefined, null]) assert.throws(() => T.model(t, id), /unknown model/);
  assert.throws(() => T.subscription(t, 'nope'), /unknown subscription/);
  assert.equal(T.subscription(t, 'claude').shadow_multiplier, 1);
});

test('listCost: tokens x $/Mtok, cache included', () => {
  const t = table();
  // sonnet-5-5: in 2, out 10, cache read 0.1, write 2.5
  assert.equal(T.listCost(t, 'claude-sonnet-5-5', { input: 1e6, output: 1e6, cache_read: 1e6, cache_write: 1e6 }), 14.6);
  assert.throws(() => T.listCost(t, 'unknown', { input: 1 }), /unknown model/);
});

test('CLI --check: exit 0 on the shipped table, 1 naming cost-table.json on a bad file, 2 on usage', () => {
  assert.equal(node([path.join(STD, 'table.mjs'), '--check']).code, 0);
  const t = table(); delete row(t, 'gpt-6-luna').source;
  const f = path.join(KIT_ROOT, 'tests', '.tmp-bad-cost-table.json');
  fs.writeFileSync(f, JSON.stringify(t));
  try {
    const r = node([path.join(STD, 'table.mjs'), '--check', f]);
    assert.equal(r.code, 1); assert.match(r.out, /cost-table\.json: rows\[\d+\] \(gpt-6-luna\): source/);
  } finally { fs.rmSync(f, { force: true }); }
  assert.equal(node([path.join(STD, 'table.mjs')]).code, 2);
  const cj = JSON.parse(fs.readFileSync(path.join(STD, 'check.json'), 'utf8'));
  assert.deepEqual(cj.commands, [{ id: 'table', tool: 'table', run: ['node', '.standards/cost-table/table.mjs', '--check'] }]);
});
