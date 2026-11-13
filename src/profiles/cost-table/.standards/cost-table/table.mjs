#!/usr/bin/env node
// cost-table: the portfolio price list (spec SPEC-v4 section 2, "Appetite and the cost table").
//
//   node .standards/cost-table/table.mjs --check [<file>]    validate the table (what check.mjs runs in CI)
//   import { load, validate, model, subscription, listCost } from './table.mjs'
//
// One JSON file, `rows[]`, each row has a `kind`:
//   model   id, vendor, input, output, cache_read, cache_write ($/Mtok list price), source (URL), checked (YYYY-MM-DD);
//           optional aliases[] (extra exact ids) and note
//   sub     id, shadow_multiplier (> 0, one number per subscription; spend = list cost x multiplier; 1 for API keys)
//   runner  id, usd_per_min (>= 0), measured (boolean; round 1: 0 / false)
// model() on an unknown id THROWS: never a max-rate fallback. Zero dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TABLE_FILE = path.join(HERE, 'cost-table.json');
export const RATE_FIELDS = ['input', 'output', 'cache_read', 'cache_write'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';

export const load = (file = TABLE_FILE) => JSON.parse(fs.readFileSync(file, 'utf8'));

// Returns a list of problems; empty = valid.
export function validate(table) {
  const errs = [];
  if (!table || typeof table !== 'object' || Array.isArray(table)) return ['table is not an object'];
  if (table.schema !== 1) errs.push(`schema must be 1, got ${JSON.stringify(table.schema)}`);
  if (table.unit !== 'usd-per-mtok') errs.push('unit must be "usd-per-mtok"');
  if (!Array.isArray(table.rows) || table.rows.length === 0) return [...errs, 'rows must be a non-empty array'];
  const seen = new Map();
  table.rows.forEach((r, i) => {
    const at = `rows[${i}]${r && r.id ? ` (${r.id})` : ''}`;
    if (!r || typeof r !== 'object') { errs.push(`${at}: not an object`); return; }
    if (!isStr(r.id)) errs.push(`${at}: id is missing`);
    if (!['model', 'sub', 'runner'].includes(r.kind)) { errs.push(`${at}: kind must be model | sub | runner`); return; }
    for (const id of [r.id, ...(r.kind === 'model' && Array.isArray(r.aliases) ? r.aliases : [])]) {
      if (!isStr(id)) continue;
      const key = `${r.kind === 'model' ? 'model' : r.kind}:${id}`;
      if (seen.has(key)) errs.push(`${at}: duplicate ${r.kind} id ${id} (also rows[${seen.get(key)}])`);
      else seen.set(key, i);
    }
    if (r.kind === 'model') {
      if (!isStr(r.vendor)) errs.push(`${at}: vendor is missing`);
      for (const f of RATE_FIELDS) if (!isNum(r[f]) || r[f] < 0) errs.push(`${at}: ${f} must be a number >= 0 ($/Mtok)`);
      if (!isStr(r.source) || !/^https:\/\/\S+$/.test(r.source)) errs.push(`${at}: source must be an https URL of the vendor price page`);
      if (!isStr(r.checked) || !/^\d{4}-\d{2}-\d{2}$/.test(r.checked) || Number.isNaN(Date.parse(r.checked))) errs.push(`${at}: checked must be a YYYY-MM-DD date`);
      if (r.aliases !== undefined && !(Array.isArray(r.aliases) && r.aliases.every(isStr))) errs.push(`${at}: aliases must be an array of ids`);
    } else if (r.kind === 'sub') {
      if (!isNum(r.shadow_multiplier) || r.shadow_multiplier <= 0) errs.push(`${at}: shadow_multiplier must be a number > 0`);
    } else {
      if (!isNum(r.usd_per_min) || r.usd_per_min < 0) errs.push(`${at}: usd_per_min must be a number >= 0`);
      if (typeof r.measured !== 'boolean') errs.push(`${at}: measured must be true or false`);
      if (r.measured === false && r.usd_per_min !== 0) errs.push(`${at}: a not-measured runner must be priced 0`);
    }
  });
  return errs;
}

const find = (table, kind, id) => table.rows.find((r) => r.kind === kind && (r.id === id || (r.kind === 'model' && (r.aliases || []).includes(id))));

// Exact id (or a listed alias) only. Unknown = error, never a fallback rate.
export function model(table, id) {
  const r = typeof id === 'string' ? find(table, 'model', id) : undefined;
  if (!r) throw new Error(`cost-table: unknown model ${JSON.stringify(id)} -- add a row (with source and checked) instead of guessing a rate`);
  return r;
}

export function subscription(table, id) {
  const r = typeof id === 'string' ? find(table, 'sub', id) : undefined;
  if (!r) throw new Error(`cost-table: unknown subscription ${JSON.stringify(id)}`);
  return r;
}

// USD list cost of a token breakdown for a model.
export function listCost(table, id, { input = 0, output = 0, cache_read = 0, cache_write = 0 } = {}) {
  const r = model(table, id);
  return (input * r.input + output * r.output + cache_read * r.cache_read + cache_write * r.cache_write) / 1_000_000;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] !== '--check' || args.length > 2) { console.error('usage: table.mjs --check [<file>]'); process.exit(2); }
  const file = path.resolve(args[1] || TABLE_FILE);
  let table;
  try { table = load(file); } catch (e) { console.log(`cost-table.json: unreadable: ${e.message}`); process.exit(1); }
  const errs = validate(table);
  for (const e of errs) console.log(`cost-table.json: ${e}`);
  console.log(errs.length ? `cost-table: ${errs.length} problem(s)` : `cost-table: ok (${table.rows.length} rows)`);
  process.exit(errs.length ? 1 : 0);
}
