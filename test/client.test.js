// -----------------------------------------------------------------------------
// The Dify client on the recorded answers of Dify 1.20.0: the event stream
// folded into one result, the errors sorted by kind.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DifyClient, ERROR_KINDS, foldEvents, parseSse } from '../src/dify/client.js';
import { fixture, recordedEvents } from './helpers/fakeDify.js';

const replay = (name) => async () => {
  const { status, content_type: type, body } = fixture(name);
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': type },
  });
};

const client = (fetch) => new DifyClient({ url: 'http://192.0.2.30', apiKey: 'app-x', fetch });

test('parseSse: data lines, pings skipped, a cut block kept for later', () => {
  const { events, rest } = parseSse('event: ping\n\ndata: {"event":"a"}\n\ndata: {"ev');
  assert.deepEqual(events, [{ event: 'a' }]);
  assert.equal(rest, 'data: {"ev');
});

test('a workflow run: status, outputs, time and tokens', async () => {
  const run = await client(replay('run-ok')).run({ mode: 'workflow', inputs: {}, timeoutMs: 1000 });
  assert.equal(run.status, 'succeeded');
  assert.deepEqual(run.outputs, { room: 'kitchen', temperature: 21.5 });
  assert.equal(run.tokens, 0);
  assert.ok(run.elapsed > 0.2 && run.elapsed < 0.3);
  assert.equal(run.taskId, '74a8a2c0-c18a-4f05-8227-540d8e73e5d6');
});

test('a failed workflow run and a missing input end on a failed status', async () => {
  let run = await client(replay('run-failed')).run({
    mode: 'workflow',
    inputs: {},
    timeoutMs: 1000,
  });
  assert.equal(run.status, 'failed');
  assert.match(run.error, /Failed to execute code/);
  run = await client(replay('run-missing-input')).run({
    mode: 'workflow',
    inputs: {},
    timeoutMs: 1000,
  });
  assert.equal(run.error, 'room is required in input form');
});

test('a chatflow message: the answer pieces joined, the conversation kept', async () => {
  const run = await client(replay('chat-1')).run({
    mode: 'advanced-chat',
    inputs: {},
    query: 'Bonjour',
    timeoutMs: 1000,
  });
  assert.equal(run.answer, 'Echo: Bonjour (salon) #1');
  assert.equal(run.conversationId, 'ac498e4f-2740-4d50-87c8-1052f0bb494f');
  assert.equal(run.status, 'succeeded');
});

test('an agent stream: agent_message pieces and an error event', () => {
  const run = foldEvents([
    { event: 'agent_message', answer: 'Hel', task_id: 't' },
    { event: 'agent_message', answer: 'lo' },
    { event: 'message_end', metadata: { usage: { total_tokens: 12, latency: 1.5 } } },
  ]);
  assert.equal(run.answer, 'Hello');
  assert.equal(run.tokens, 12);
  assert.equal(run.elapsed, 1.5);
  const failed = foldEvents([
    { event: 'error', status: 400, code: 'provider_quota_exceeded', message: 'quota' },
  ]);
  assert.equal(failed.failure.kind, ERROR_KINDS.QUOTA);
  assert.equal(
    foldEvents([{ event: 'error', message: 'boom' }]).failure.kind,
    ERROR_KINDS.RUN_FAILED,
  );
});

test('errors: wrong key, wrong route, unknown conversation, not Dify, network', async () => {
  const kind = (fn) =>
    fn().then(
      () => assert.fail('no error'),
      (err) => err,
    );
  let err = await kind(() => client(replay('info-bad-key')).info());
  assert.equal(err.kind, ERROR_KINDS.AUTH);
  err = await kind(() => client(replay('info-deleted-app')).info());
  assert.equal(err.kind, ERROR_KINDS.AUTH);
  assert.match(err.message, /HTTP 403 forbidden The app no longer exists/);
  assert.ok(!err.message.includes('app-x'));
  err = await kind(() =>
    client(replay('run-on-chat-app')).run({ mode: 'workflow', inputs: {}, timeoutMs: 1000 }),
  );
  assert.equal(err.kind, ERROR_KINDS.WRONG_MODE);
  err = await kind(() =>
    client(replay('chat-unknown-conversation')).run({ mode: 'chat', inputs: {}, timeoutMs: 1000 }),
  );
  assert.equal(err.status, 404);
  err = await kind(() => client(async () => new Response('<html>', { status: 404 })).info());
  assert.equal(err.kind, ERROR_KINDS.NOT_DIFY);
  err = await kind(() => client(async () => new Response('bad gateway', { status: 502 })).info());
  assert.equal(err.kind, ERROR_KINDS.UNREACHABLE);
  err = await kind(() =>
    client(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }).info(),
  );
  assert.equal(err.kind, ERROR_KINDS.UNREACHABLE);
  assert.match(err.message, /ECONNREFUSED/);
});

test('info and inputs read the recorded answers', async () => {
  assert.deepEqual(await client(replay('info-chatflow')).info(), {
    name: 'Echo chatflow',
    mode: 'advanced-chat',
    description: '',
  });
  assert.deepEqual(await client(replay('parameters-workflow')).inputs(), [
    { variable: 'room', label: 'room', required: true, type: 'text-input' },
    { variable: 'temperature', label: 'temperature', required: false, type: 'number' },
  ]);
  assert.equal(recordedEvents('run-ok').at(-1).event, 'workflow_finished');
});

test('a server ignoring streaming: the blocking answer is read too', async () => {
  const run = await client(replay('run-blocking')).run({
    mode: 'workflow',
    inputs: {},
    timeoutMs: 1000,
  });
  assert.equal(run.status, 'succeeded');
  assert.deepEqual(run.outputs, { room: 'kitchen', temperature: null });
});
