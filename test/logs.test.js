// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, an outage is logged once and its end
// once. Never an input, a message, an answer or an API key.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_KEY, WORKFLOW_KEY, createWorld } from './helpers/world.js';

function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record = (...args) =>
    lines.push(args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  return { lines, clear: () => lines.splice(0) };
}

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.lines.some((line) => line.includes('connected')),
    'the start is logged',
  );
  logs.clear();
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh();
  }
  assert.deepEqual(logs.lines, []);
});

test('an outage writes one line when it starts and one when it ends', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.server.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh();
  }
  w.server.online = true;
  await w.hub.refresh();
  assert.equal(logs.lines.length, 2, logs.lines.join('\n'));
  assert.match(logs.lines[0], /ECONNREFUSED/);
  assert.match(logs.lines[1], /Dify answers again after 5 min/);
});

test('a run is logged without its inputs nor its answer, the keys never', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  const ok = await w.fake.sceneAction('send_message', { message: 'Quelle est la capitale ?' });
  assert.equal(ok.success, true);
  w.server.failing.add(WORKFLOW_KEY);
  const failed = await w.fake.sceneAction('run_workflow', { inputs: 'room=salon-privé' });
  assert.equal(failed.success, false);
  const all = logs.lines.join('\n');
  assert.match(all, /Dify app Echo chatflow answered in/);
  assert.match(all, /Run of the Dify app Echo workflow failed/);
  for (const secret of ['capitale', 'salon-privé', 'Echo: ', WORKFLOW_KEY, CHAT_KEY]) {
    assert.ok(!all.includes(secret), secret);
  }
});
