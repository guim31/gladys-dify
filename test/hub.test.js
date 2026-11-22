// -----------------------------------------------------------------------------
// The hub against the fake Dify: devices and states, the offline / back
// events, the runs (success in green, every failure in red with its
// multi-language message and the "run failed" event), the conversations, the
// connection status and "Test the connection".
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEATURE_KEYS, LAST_ANSWER_MAX } from '../src/devices.js';
import {
  TRIGGERS,
  WIDGET_KEY,
  parseConversation,
  parseInputs,
  parseMaxCharacters,
  truncate,
  typeInputs,
  workflowAnswer,
} from '../src/hub.js';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGETS } from '../src/widgets.js';
import {
  CHAT_KEY,
  FakeDify,
  KEYS,
  WORKFLOW_KEY,
  createAll,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const eventKey = (event) => event.key ?? event.event_key;

test('publishes one device per app, with its first states', async (t) => {
  const { gladys, fake } = await world(t);
  assert.deepEqual(
    fake.discoveredDevices.map((d) => d.name),
    ['Echo workflow', 'Echo chatflow'],
  );
  const [workflow] = fake.discoveredDevices;
  assert.equal(workflow.external_id, deviceId(gladys, WORKFLOW_KEY));
  assert.equal(workflow.should_poll, false);
  assert.deepEqual(workflow.params, [
    { name: 'DIFY_URL', value: 'http://192.0.2.30' },
    { name: 'DIFY_APP_MODE', value: 'workflow' },
  ]);
  assert.ok(!JSON.stringify(fake.discoveredDevices).includes(WORKFLOW_KEY), 'never the key');
  assert.equal(fake.lastState(featureId(gladys, WORKFLOW_KEY, FEATURE_KEYS.ONLINE)), 1);
  assert.equal(fake.connectionStatus.connected, true);
});

test('no address, no key: no device, a status asking for them', async (t) => {
  let w = await world(t, { config: { language: 'fr' } });
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.match(JSON.stringify(w.fake.connectionStatus), /Saisissez l'adresse/);
  const ack = await w.fake.sceneAction('run_workflow', {});
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /Saisissez l'adresse/);
  w = await world(t, { config: { url: '192.0.2.30', language: 'fr' } });
  assert.match(JSON.stringify(w.fake.connectionStatus), /clé d'API d'au moins une app/);
});

test('publishes only the changes, and everything again once a device is added', async (t) => {
  const w = await world(t);
  const count = () => w.fake.states.length;
  const before = count();
  await w.hub.refresh();
  assert.equal(count(), before, 'nothing changed, nothing sent');
  const refreshes = w.fake.widgetRefreshes.length;
  await w.fake.deviceCreated(w.fake.discoveredDevices[0]);
  assert.equal(count(), before + 1, 'the online state again');
  assert.equal(w.fake.widgetRefreshes.length, refreshes + 1);
});

test('sends the unchanged states again every 12 hours (heartbeat)', async (t) => {
  const w = await world(t);
  const before = w.fake.states.length;
  w.clock.advance(11 * 3600_000);
  await w.hub.refresh();
  assert.equal(w.fake.states.length, before);
  w.clock.advance(3600_000);
  await w.hub.refresh();
  assert.equal(w.fake.states.length, before + 2);
});

test('offline after two failed readings, back with the outage length', async (t) => {
  const w = await world(t, { config: { url: '192.0.2.30', api_keys: KEYS, language: 'fr' } });
  const online = featureId(w.gladys, WORKFLOW_KEY, FEATURE_KEYS.ONLINE);
  w.server.online = false;
  await w.hub.refresh();
  assert.equal(w.fake.sceneEvents.length, 0, 'one failure is a blip');
  assert.equal(w.fake.lastState(online), 1);
  assert.equal(w.fake.connectionStatus.connected, true);

  w.clock.advance(15_000);
  await w.hub.refresh();
  assert.equal(w.fake.sceneEvents.length, 1);
  const [offline] = w.fake.sceneEvents;
  assert.equal(eventKey(offline), TRIGGERS.OFFLINE);
  assert.match(JSON.stringify(offline), /ne répond pas/);
  assert.equal(w.fake.lastState(online), 0);
  assert.equal(w.fake.connectionStatus.connected, false);

  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.equal(w.fake.sceneEvents.length, 1, 'one event per outage');

  w.server.online = true;
  w.clock.advance(5 * 60_000);
  await w.hub.refresh();
  assert.equal(w.fake.sceneEvents.length, 2);
  assert.equal(eventKey(w.fake.sceneEvents[1]), TRIGGERS.BACK);
  assert.match(JSON.stringify(w.fake.sceneEvents[1]), /"downtime_minutes":6/);
  assert.equal(w.fake.lastState(online), 1);
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('a deleted app: its device goes offline, the others stay, the status says why', async (t) => {
  const w = await world(t);
  w.server.apps.delete(CHAT_KEY);
  await w.hub.refresh();
  assert.equal(w.fake.lastState(featureId(w.gladys, CHAT_KEY, FEATURE_KEYS.ONLINE)), 0);
  assert.equal(w.fake.lastState(featureId(w.gladys, WORKFLOW_KEY, FEATURE_KEYS.ONLINE)), 1);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(JSON.stringify(w.fake.connectionStatus), /app was deleted or the key revoked/);
  assert.equal(w.fake.sceneEvents.length, 0, 'not an outage of Dify');
  const ack = await w.fake.sceneAction('send_message', { message: 'Bonjour' });
  assert.equal(ack.success, false);
  const report = await w.fake.action('test_connection', {});
  assert.equal(report.success, false);
  assert.match(report.error.en, /Echo workflow \(workflow\).*Echo chatflow: API key refused/);
});

test('a wrong key at start: no device for it, the status in red', async (t) => {
  const w = await world(t, {
    config: { url: '192.0.2.30', api_keys: `${WORKFLOW_KEY} app-wrongKey0000000000000000` },
  });
  assert.equal(w.fake.discoveredDevices.length, 1);
  assert.equal(w.fake.connectionStatus.connected, false);
  const report = await w.fake.action('test_connection', {});
  assert.match(report.error.en, /Key 2: API key refused/);
});

test('run a workflow: inputs typed as text, outputs to the scene and the device', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.server.tokens = 42;
  const ack = await w.fake.sceneAction('run_workflow', {
    inputs: 'room = kitchen; temperature=21,5',
  });
  assert.equal(ack.success, true, JSON.stringify(ack.error));
  assert.deepEqual(ack.data.outputs, {
    response: JSON.stringify({ room: 'kitchen', temperature: 21.5 }),
    outputs: JSON.stringify({ room: 'kitchen', temperature: 21.5 }),
    app: 'Echo workflow',
    duration_seconds: 0.3,
    tokens: 42,
    truncated: false,
  });
  const run = w.server.requests.find((r) => r.path === '/v1/workflows/run');
  assert.equal(run.body.response_mode, 'streaming');
  assert.equal(run.body.user, 'gladys');
  assert.equal(run.key, WORKFLOW_KEY, 'the only workflow app is used');
  const feature = (key) => w.fake.lastState(featureId(w.gladys, WORKFLOW_KEY, key));
  assert.equal(feature(FEATURE_KEYS.LAST_RUN), 1);
  assert.equal(feature(FEATURE_KEYS.DURATION), 0.3);
  assert.equal(feature(FEATURE_KEYS.TOKENS), 42);
});

test('run a workflow: every failure is red, with "run failed" for a run that failed', async (t) => {
  const w = await world(t, { config: { url: '192.0.2.30', api_keys: KEYS, language: 'fr' } });
  const run = (fields) => w.fake.sceneAction('run_workflow', fields);
  const cases = [
    [{ inputs: 'not understood' }, /Entrées incomprises/],
    [{ inputs: '{"room": ' }, /Entrées incomprises/],
    [{}, /Entrée obligatoire manquante : room/],
    [{ app: 'Unknown', inputs: 'room=x' }, /Aucune app de ce nom/],
    [{ app: 'echo CHATFLOW', inputs: 'room=x' }, /ne peut pas faire cette action/],
  ];
  for (const [fields, expected] of cases) {
    const ack = await run(fields);
    assert.equal(ack.success, false, JSON.stringify(fields));
    assert.match(ack.error.fr, expected);
    assert.deepEqual(Object.keys(ack.error).sort(), ['de', 'en', 'es', 'fr']);
  }
  // Only the missing input reached the app: a refused run.
  assert.equal(w.fake.sceneEvents.length, 1);
  assert.match(JSON.stringify(w.fake.sceneEvents[0]), /Entrée obligatoire manquante/);

  w.server.failing.add(WORKFLOW_KEY);
  const ack = await run({ inputs: 'room=kitchen' });
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /L'exécution a échoué dans Dify \(Failed to execute code/);
  const event = w.fake.sceneEvents.at(-1);
  assert.equal(eventKey(event), TRIGGERS.RUN_FAILED);
  assert.match(JSON.stringify(event), /"app":"Echo workflow"/);
  assert.match(JSON.stringify(event), /L'exécution a échoué/);
  assert.equal(w.fake.lastState(featureId(w.gladys, WORKFLOW_KEY, FEATURE_KEYS.LAST_RUN)), 0);

  w.server.online = false;
  const down = await run({ inputs: 'room=kitchen' });
  assert.match(down.error.fr, /Dify ne répond pas/);
  assert.equal(w.fake.sceneEvents.length, 3);
});

test('a run that takes too long: red, "run failed", and Dify asked to stop it', async (t) => {
  const w = await world(t, { timings: { minRunMs: 10 } });
  const original = w.server.fetch;
  w.hub.apps.get([...w.hub.apps.keys()][0]).client.fetch = async (target, init) => {
    if (target.endsWith('/v1/workflows/run')) {
      // The stream starts (a task id), then nothing until the abort.
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"event":"workflow_started","task_id":"task-1"}\n\n'),
          );
          init.signal.addEventListener('abort', () => controller.error(init.signal.reason));
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    }
    return original(target, init);
  };
  w.hub.config.timeoutMs = 50;
  const ack = await w.fake.sceneAction('run_workflow', { inputs: 'room=x' });
  assert.equal(ack.success, false);
  assert.match(ack.error.en, /took too long/);
  assert.equal(eventKey(w.fake.sceneEvents[0]), TRIGGERS.RUN_FAILED);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(w.server.stops, ['/v1/workflows/tasks/task-1/stop']);
});

test('send a message: the conversation is kept by name, a new one without', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gladys-dify-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const w = await world(t, { dataDir });
  await createAll(w);
  const send = (fields) => w.fake.sceneAction('send_message', fields);
  let ack = await send({ message: 'Bonjour', conversation: 'Kitchen', inputs: 'room=salon' });
  assert.equal(ack.success, true, JSON.stringify(ack.error));
  assert.equal(ack.data.outputs.response, 'Echo: Bonjour (salon) #1');
  assert.equal(ack.data.outputs.app, 'Echo chatflow');
  const conversationId = ack.data.outputs.conversation_id;
  ack = await send({ message: 'Encore', conversation: 'kitchen ' });
  assert.equal(ack.data.outputs.response, 'Echo: Encore () #2');
  assert.equal(ack.data.outputs.conversation_id, conversationId);
  ack = await send({ message: 'Hello' });
  assert.equal(ack.data.outputs.response, 'Echo: Hello () #1');
  assert.notEqual(ack.data.outputs.conversation_id, conversationId);
  assert.equal(
    w.fake.lastState(featureId(w.gladys, CHAT_KEY, FEATURE_KEYS.LAST_ANSWER)),
    'Echo: Hello () #1',
  );
  // Kept on /data: a restarted container continues the conversation.
  const saved = JSON.parse(await readFile(join(dataDir, 'conversations.json'), 'utf8'));
  assert.deepEqual(Object.values(saved), [conversationId]);
  const again = await world(t, { dataDir, server: w.server });
  ack = await again.fake.sceneAction('send_message', { message: 'Re', conversation: 'kitchen' });
  assert.equal(ack.data.outputs.response, 'Echo: Re () #3');
});

test('send a message: a conversation deleted in Dify starts again under its name', async (t) => {
  const w = await world(t);
  const send = () => w.fake.sceneAction('send_message', { message: 'Hi', conversation: 'x' });
  await send();
  w.server.conversations.clear();
  const ack = await send();
  assert.equal(ack.success, true, JSON.stringify(ack.error));
  assert.equal(ack.data.outputs.response, 'Echo: Hi () #1');
});

test('send a message: empty, which app, a long answer cut cleanly', async (t) => {
  const server = new FakeDify();
  server.addApp('app-secondChat00000000000003', 'Kitchen agent', 'agent-chat');
  const w = await world(t, {
    server,
    config: { url: '192.0.2.30', api_keys: `${KEYS} app-secondChat00000000000003` },
  });
  let ack = await w.fake.sceneAction('send_message', { message: '  ' });
  assert.match(ack.error.en, /The message is empty/);
  ack = await w.fake.sceneAction('send_message', { message: 'Hi' });
  assert.match(ack.error.en, /Which app\?/);
  server.answer = () => 'Il fait beau. '.repeat(100) + 'Prenez un parapluie.';
  ack = await w.fake.sceneAction('send_message', {
    message: 'Météo ?',
    app: 'kitchen agent',
    max_characters: '100',
  });
  assert.equal(ack.success, true, JSON.stringify(ack.error));
  assert.equal(ack.data.outputs.truncated, true);
  assert.ok(ack.data.outputs.response.length <= 100);
  await w.fake.sceneAction('send_message', {
    message: 'Météo ?',
    app: 'Kitchen agent',
    max_characters: 5000,
  });
  const kept = w.fake.lastState(
    featureId(w.gladys, 'app-secondChat00000000000003', FEATURE_KEYS.LAST_ANSWER),
  );
  assert.equal(kept.length, LAST_ANSWER_MAX);
});

test('an app is found by the name given in Gladys too', async (t) => {
  const w = await world(t);
  const device = { ...w.fake.discoveredDevices[1], name: 'Assistant' };
  await w.fake.deviceCreated(device);
  const ack = await w.fake.sceneAction('send_message', { message: 'Hi', app: 'assistant' });
  assert.equal(ack.success, true, JSON.stringify(ack.error));
  assert.equal(ack.data.outputs.app, 'Assistant');
});

test('the widget: Dify, each app under its Gladys name, the latest answer', async (t) => {
  const w = await world(t, { config: { url: '192.0.2.30', api_keys: KEYS, language: 'fr' } });
  let ack = await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  assert.equal(ack.success, true);
  assert.deepEqual(
    ack.data.content.components.map((c) => c.type),
    ['status'],
  );
  assert.deepEqual(
    ack.data.content.components[0].items.map((i) => [i.label, i.value]),
    [
      ['Dify', 'En ligne'],
      ['Echo workflow', 'En ligne'],
      ['Echo chatflow', 'En ligne'],
    ],
  );
  const refreshes = w.fake.widgetRefreshes.length;
  await w.fake.sceneAction('send_message', { message: 'Bonjour' });
  assert.equal(w.fake.widgetRefreshes.length, refreshes + 1);
  w.server.failing.add(WORKFLOW_KEY);
  await w.fake.sceneAction('run_workflow', { inputs: 'room=x' });
  ack = await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  const [status, text] = ack.data.content.components;
  assert.match(status.items[1].value, /^Échec · \d\d:\d\d$/);
  assert.match(status.items[2].value, /^OK · \d\d:\d\d$/);
  assert.equal(text.text, 'Echo: Bonjour () #1');
  const hidden = await WIDGETS[WIDGET_KEY].get(w.hub, {
    language: 'fr',
    settings: { show_answer: false },
  });
  assert.deepEqual(
    hidden.components.map((c) => c.type),
    ['status'],
  );
});

test('test the connection: green with the apps, red when Dify is down', async (t) => {
  const w = await world(t, { config: { url: '192.0.2.30', api_keys: KEYS, language: 'fr' } });
  let ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(
    JSON.stringify(ack.data),
    /Dify répond\. 2 app\(s\) : Echo workflow \(workflow\), Echo chatflow \(chatflow\)/,
  );
  w.server.online = false;
  ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /Dify : Dify ne répond pas/);
});

test('parsers: inputs, length, conversation, cut, workflow answer', () => {
  assert.deepEqual(parseInputs('a=1\nb= deux; c = x=y'), { a: '1', b: 'deux', c: 'x=y' });
  assert.deepEqual(parseInputs('{"a": 1}'), { a: 1 });
  assert.deepEqual(parseInputs(''), {});
  assert.equal(parseInputs('[1]'), null);
  assert.equal(parseInputs('no equal sign'), null);
  assert.deepEqual(parseInputs('summary=Line one\nNote: two; and more\nroom=x'), {
    summary: 'Line one\nNote: two; and more',
    room: 'x',
  });
  assert.deepEqual(
    typeInputs({ t: '21,5', n: 'abc', s: '3' }, [
      { variable: 't', type: 'number' },
      { variable: 'n', type: 'number' },
      { variable: 's', type: 'text-input' },
    ]),
    { t: 21.5, n: 'abc', s: '3' },
  );
  assert.equal(parseMaxCharacters(undefined), 1000);
  assert.equal(parseMaxCharacters('20'), 50);
  assert.equal(parseMaxCharacters(99999), 10000);
  assert.equal(parseConversation(' kitchen '), 'kitchen');
  assert.equal(parseConversation('x'.repeat(300)).length, 100);
  assert.deepEqual(truncate('short', 10), { text: 'short', truncated: false });
  assert.equal(workflowAnswer({ only: 'one' }), 'one');
  assert.equal(workflowAnswer({ text: 'a', n: 1 }), 'a');
  assert.equal(workflowAnswer({ n: 1 }), '{"n":1}');
  assert.equal(workflowAnswer(null), '');
});

test('a stream cut before the end of the run is a failure, not a partial answer', async (t) => {
  const w = await world(t);
  const original = w.server.fetch;
  w.hub.apps.get([...w.hub.apps.keys()][1]).client.fetch = async (target, init) => {
    if (target.endsWith('/v1/chat-messages')) {
      return new Response('data: {"event":"message","answer":"Half an ans"}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return original(target, init);
  };
  const ack = await w.fake.sceneAction('send_message', { message: 'Hi' });
  assert.equal(ack.success, false);
  assert.equal(eventKey(w.fake.sceneEvents[0]), TRIGGERS.RUN_FAILED);
  assert.equal(w.fake.lastState(featureId(w.gladys, CHAT_KEY, FEATURE_KEYS.LAST_RUN)), 0);
});

test('a workflow that partially succeeded (a node with an error strategy) is a success', async (t) => {
  const w = await world(t);
  const original = w.server.fetch;
  w.hub.apps.get([...w.hub.apps.keys()][0]).client.fetch = async (target, init) => {
    const response = await original(target, init);
    if (!target.endsWith('/v1/workflows/run')) {
      return response;
    }
    const text = (await response.text())
      .replace('"status": "succeeded"', '"status": "partial-succeeded"')
      .replace('"status":"succeeded","outputs"', '"status":"partial-succeeded","outputs"');
    assert.match(text, /partial-succeeded/);
    return new Response(text, { headers: { 'content-type': 'text/event-stream' } });
  };
  const ack = await w.fake.sceneAction('run_workflow', { inputs: 'room=x' });
  assert.equal(ack.success, true, JSON.stringify(ack.error));
});

test('the widget keeps within the 10 rows of the core with 10 apps', async (t) => {
  const server = new FakeDify();
  const keys = Array.from({ length: 10 }, (_, i) => `app-many${String(i).padStart(20, '0')}`);
  keys.forEach((key, i) => server.addApp(key, `App ${i}`, 'chat'));
  const w = await world(t, { server, config: { url: '192.0.2.30', api_keys: keys.join(' ') } });
  const content = await WIDGETS[WIDGET_KEY].get(w.hub, { language: 'en', settings: {} });
  assert.equal(content.components[0].items.length, 10);
  assert.deepEqual(validateWidgetContent(content), []);
});
