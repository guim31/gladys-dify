// -----------------------------------------------------------------------------
// A fake Dify server behind a fake `fetch`, built on the real answers recorded
// from langgenius/dify-api 1.20.0 (test/fixtures/dify/): a workflow "Echo
// workflow" (Start → End, outputs `room` and `temperature`), and a chatflow
// "Echo chatflow" (Start → Answer "Echo: <query> (<room>) #<turn>"), no model.
// Tests change its fields to play an outage, a deleted app, a failing run…
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/dify/${name}.json`, import.meta.url), 'utf8'));

/** The `data:` events of a recorded stream. */
export const recordedEvents = (name) =>
  fixture(name)
    .body.split('\n\n')
    .filter((block) => block.startsWith('data:'))
    .map((block) => JSON.parse(block.slice(5)));

export const WORKFLOW_KEY = 'app-workflowTestKey00000001';
export const CHAT_KEY = 'app-chatflowTestKey00000002';

const json = (status, body) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': typeof body === 'string' ? 'text/html' : 'application/json' },
  });

const sse = (events) =>
  new Response(
    `event: ping\n\n${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}`,
    { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
  );

export class FakeDify {
  constructor({ url = 'http://192.0.2.30' } = {}) {
    this.url = url;
    this.apps = new Map([
      [
        WORKFLOW_KEY,
        {
          info: fixture('info-workflow').body,
          parameters: fixture('parameters-workflow').body,
        },
      ],
      [
        CHAT_KEY,
        {
          info: fixture('info-chatflow').body,
          parameters: {
            ...fixture('parameters-workflow').body,
            user_input_form: [
              { 'text-input': { variable: 'room', label: 'room', required: false } },
            ],
          },
        },
      ],
    ]);
    /** false: connection refused; 'timeout': never answers. */
    this.online = true;
    /** Keys whose workflow run fails in a node. */
    this.failing = new Set();
    /** What the chat answers (a function of the query), or null for the echo. */
    this.answer = null;
    /** Tokens a run reports. */
    this.tokens = 0;
    this.conversations = new Map();
    this.requests = [];
    this.stops = [];
    this.fetch = this.fetch.bind(this);
  }

  addApp(key, name, mode) {
    this.apps.set(key, {
      info: { ...fixture('info-chatflow').body, name, mode },
      parameters: { ...fixture('parameters-workflow').body, user_input_form: [] },
    });
  }

  calls(path) {
    return this.requests.filter((request) => request.path === path).length;
  }

  async fetch(target, init = {}) {
    const url = new URL(target);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const key = init.headers?.authorization?.replace(/^Bearer /, '');
    this.requests.push({ method: init.method, path: url.pathname, body, key });
    if (!target.startsWith(this.url)) {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    }
    if (this.online === false) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    if (this.online === 'timeout') {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    const path = url.pathname.replace(new URL(this.url).pathname.replace(/\/$/, ''), '');
    const app = this.apps.get(key);
    if (!path.startsWith('/v1/')) {
      return json(404, '<html>Not found</html>');
    }
    if (!app) {
      return json(401, fixture('info-bad-key').body);
    }
    const mode = app.info.mode;
    if (init.method === 'GET' && path === '/v1/info') {
      return json(200, app.info);
    }
    if (init.method === 'GET' && path === '/v1/parameters') {
      return json(200, app.parameters);
    }
    if (init.method === 'POST' && /\/stop$/.test(path)) {
      this.stops.push(path);
      return json(200, { result: 'success' });
    }
    if (init.method === 'POST' && path === '/v1/workflows/run') {
      if (mode !== 'workflow') {
        return json(400, fixture('run-on-chat-app').body);
      }
      return this.runWorkflow(key, app, body);
    }
    if (init.method === 'POST' && path === '/v1/chat-messages') {
      if (!['advanced-chat', 'chat', 'agent-chat'].includes(mode)) {
        return json(400, fixture('chat-on-workflow').body);
      }
      return this.chat(body);
    }
    return json(404, { code: 'not_found', message: 'Not found', status: 404 });
  }

  runWorkflow(key, app, body) {
    const missing = app.parameters.user_input_form
      .map((item) => Object.values(item)[0])
      .find((field) => field.required && (body.inputs?.[field.variable] ?? '') === '');
    if (missing) {
      return sse(recordedEvents('run-missing-input'));
    }
    const failing = this.failing.has(key);
    const events = recordedEvents(failing ? 'run-failed' : 'run-ok');
    const finished = events.at(-1);
    if (!failing) {
      finished.data.outputs = {
        room: body.inputs.room,
        temperature: body.inputs.temperature ?? null,
      };
      finished.data.total_tokens = this.tokens;
    }
    return sse(events);
  }

  chat(body) {
    let conversationId = body.conversation_id;
    if (conversationId && !this.conversations.has(conversationId)) {
      return json(404, fixture('chat-unknown-conversation').body);
    }
    conversationId ||= crypto.randomUUID();
    const turn = (this.conversations.get(conversationId) ?? 0) + 1;
    this.conversations.set(conversationId, turn);
    const answer = this.answer
      ? this.answer(body.query)
      : `Echo: ${body.query} (${body.inputs?.room ?? ''}) #${turn}`;
    const events = recordedEvents('chat-1').map((event) => ({
      ...event,
      conversation_id: conversationId,
    }));
    const firstMessage = events.findIndex((event) => event.event === 'message');
    const kept = events.filter(
      (event, index) => event.event !== 'message' || index === firstMessage,
    );
    kept[firstMessage] = { ...kept[firstMessage], answer };
    const end = kept.find((event) => event.event === 'message_end');
    end.metadata.usage.total_tokens = this.tokens;
    return sse(kept);
  }
}
