// who.mjs: read-only follower listing via gh (injected here).
import test from 'node:test';
import assert from 'node:assert/strict';
import { collect, formatRows } from '../who.mjs';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');

test('who lists repo / profile@version / latest, skipping repos without .standards.json', async () => {
  const calls = [];
  const gh = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'repo') return JSON.stringify([{ nameWithOwner: 'o/energy-cli' }, { nameWithOwner: 'o/site-cli' }, { nameWithOwner: 'o/none' }]);
    if (args[1] === 'repos/o/energy-cli/contents/.standards.json') return JSON.stringify({ content: b64({ kit: 'k', profiles: { base: '1.0.0', 'go-strict': '1.0.0' } }) });
    if (args[1] === 'repos/o/site-cli/contents/.standards.json') return JSON.stringify({ content: b64({ kit: 'k', profiles: { 'go-strict': '1.0.0' } }) });
    const e = new Error('HTTP 404'); e.notFound = true; throw e;
  };
  const latest = { base: '1.1.0', 'go-strict': '1.0.0' };
  const rows = await collect({ owner: 'o', gh, latest });
  assert.deepEqual(rows, [
    { repo: 'o/energy-cli', profile: 'base', version: '1.0.0', latest: '1.1.0' },
    { repo: 'o/energy-cli', profile: 'go-strict', version: '1.0.0', latest: '1.0.0' },
    { repo: 'o/site-cli', profile: 'go-strict', version: '1.0.0', latest: '1.0.0' },
  ]);
  assert.ok(calls.every((c) => c.startsWith('repo list') || c.startsWith('api ')), 'read-only gh calls only');
  const text = formatRows(rows);
  assert.match(text, /o\/energy-cli\s+base@1\.0\.0\s+1\.1\.0 \(behind\)/);
  assert.match(text, /o\/site-cli\s+go-strict@1\.0\.0\s+1\.0\.0\n?/);
});
