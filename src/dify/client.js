// -----------------------------------------------------------------------------
// Dify "Service API" client (https://docs.dify.ai/en/guides/application-publishing/developing-with-apis),
// on the global fetch. One client per app: Dify gives every app its own API
// key (`Authorization: Bearer app-…`), and the key alone selects the app.
//
// Read: GET /v1/info (name and mode of the app), GET /v1/parameters (the
// input form). Run: POST /v1/workflows/run, /v1/chat-messages and
// /v1/completion-messages, always in `streaming` mode: Dify refuses
// `blocking` for agent apps, and a stream keeps a reverse proxy (Dify Cloud
// behind Cloudflare) from cutting a long run at 100 s. The events are read
// until the end of the run, then folded into one result.
//
// Errors carry a `kind` (ERROR_KINDS) the rest of the code translates; their
// message never holds the inputs, the answer or the key.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
  AUTH: 'auth',
  NOT_DIFY: 'not_dify',
  APP_UNAVAILABLE: 'app_unavailable',
  WRONG_MODE: 'wrong_mode',
  INVALID_INPUT: 'invalid_input',
  RUN_FAILED: 'run_failed',
  QUOTA: 'quota',
  HTTP: 'http',
});

export class DifyError extends Error {
  constructor(kind, message, { status, code, cause } = {}) {
    super(message, { cause });
    this.name = 'DifyError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

// Reads are small and quick: a server that takes longer is in trouble.
export const READ_TIMEOUT_MS = 10_000;

// What is kept of an error message of Dify, in the logs and the scene event:
// it names a node or a parameter, never an input value (checked on Dify 1.20).
export const MAX_SERVER_ERROR = 160;

// The user every call is made for: Dify keeps conversations per user.
export const DIFY_USER = 'gladys';

/** App modes and the route that runs them. */
export const APP_MODES = Object.freeze({
  WORKFLOW: 'workflow',
  ADVANCED_CHAT: 'advanced-chat',
  CHAT: 'chat',
  AGENT_CHAT: 'agent-chat',
  COMPLETION: 'completion',
});

export const CHAT_MODES = [APP_MODES.ADVANCED_CHAT, APP_MODES.CHAT, APP_MODES.AGENT_CHAT];

const clean = (text) => {
  const line = String(text).replace(/\s+/g, ' ').trim();
  return line.length > MAX_SERVER_ERROR ? `${line.slice(0, MAX_SERVER_ERROR - 1)}…` : line;
};

/** The kind of a Dify error answer `{ code, message, status }`. */
function kindOf(status, code) {
  if (status === 401 || status === 403) {
    return ERROR_KINDS.AUTH;
  }
  if (code === 'app_unavailable') {
    return ERROR_KINDS.APP_UNAVAILABLE;
  }
  if (
    ['not_chat_app', 'not_completion_app', 'not_workflow_app', 'app_mode_mismatch'].includes(code)
  ) {
    return ERROR_KINDS.WRONG_MODE;
  }
  if (code === 'invalid_param' || code === 'bad_request') {
    return ERROR_KINDS.INVALID_INPUT;
  }
  if (
    status === 429 ||
    ['provider_quota_exceeded', 'rate_limit_error', 'too_many_requests'].includes(code)
  ) {
    return ERROR_KINDS.QUOTA;
  }
  if (
    ['provider_not_initialize', 'model_currently_not_support', 'completion_request_error'].includes(
      code,
    )
  ) {
    return ERROR_KINDS.RUN_FAILED;
  }
  return ERROR_KINDS.HTTP;
}

/**
 * Parse a Server-Sent Events body into its `data:` objects (Dify sends one
 * JSON object per event, and `event: ping` lines in between).
 * @param {string} chunk text received so far, without the part already parsed
 * @returns {{ events: object[], rest: string }}
 */
export function parseSse(chunk) {
  const events = [];
  const blocks = chunk.split(/\r?\n\r?\n/);
  const rest = blocks.pop();
  for (const block of blocks) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) {
      continue;
    }
    try {
      events.push(JSON.parse(data));
    } catch {
      // A partial or foreign line: ignored, the end of the run decides.
    }
  }
  return { events, rest };
}

/**
 * Fold the events of a run into one result.
 * @returns {{ answer: string, outputs: object|null, status: string|null, error: string|null,
 *   elapsed: number|null, tokens: number|null, conversationId: string|null,
 *   taskId: string|null, failure: DifyError|null, finished: boolean }}
 */
export function foldEvents(events, result = emptyRun()) {
  for (const event of events) {
    if (!event || typeof event !== 'object') {
      continue;
    }
    if (typeof event.task_id === 'string') {
      result.taskId = event.task_id;
    }
    if (typeof event.conversation_id === 'string' && event.conversation_id) {
      result.conversationId = event.conversation_id;
    }
    switch (event.event) {
      case 'message':
      case 'agent_message':
        result.answer += typeof event.answer === 'string' ? event.answer : '';
        break;
      case 'message_replace':
        result.answer = typeof event.answer === 'string' ? event.answer : '';
        break;
      case 'message_end': {
        const usage = event.metadata?.usage;
        if (Number.isFinite(usage?.total_tokens)) {
          result.tokens = usage.total_tokens;
        }
        if (result.elapsed === null && Number.isFinite(Number(usage?.latency))) {
          result.elapsed = Number(usage.latency);
        }
        result.finished = true;
        break;
      }
      case 'workflow_finished': {
        const data = event.data ?? {};
        result.status = typeof data.status === 'string' ? data.status : null;
        result.outputs = data.outputs && typeof data.outputs === 'object' ? data.outputs : null;
        result.error = data.error ? clean(data.error) : null;
        if (Number.isFinite(data.elapsed_time)) {
          result.elapsed = data.elapsed_time;
        }
        if (Number.isFinite(data.total_tokens)) {
          result.tokens = data.total_tokens;
        }
        result.finished = true;
        break;
      }
      case 'error': {
        const message = clean(event.message ?? 'error');
        result.failure = new DifyError(
          event.status ? kindOf(event.status, event.code) : ERROR_KINDS.RUN_FAILED,
          message,
          { status: event.status, code: event.code },
        );
        // A run that fails after it started: a failed run, whatever the code says.
        if (result.failure.kind === ERROR_KINDS.HTTP) {
          result.failure.kind = ERROR_KINDS.RUN_FAILED;
        }
        result.finished = true;
        break;
      }
      default:
        break;
    }
  }
  return result;
}

export const emptyRun = () => ({
  answer: '',
  outputs: null,
  status: null,
  error: null,
  elapsed: null,
  tokens: null,
  conversationId: null,
  taskId: null,
  failure: null,
  finished: false,
});

export class DifyClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL (src/config.js parseServerUrl)
   * @param {string} options.apiKey the API key of one app
   * @param {typeof fetch} [options.fetch] HTTP seam (tests)
   */
  constructor({ url, apiKey, fetch: fetchImpl = globalThis.fetch }) {
    this.url = url;
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async send(method, path, { body, signal, label = path, stream = false }) {
    const headers = {
      accept: stream ? 'text/event-stream' : 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    let response;
    try {
      response = await this.fetch(`${this.url}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal,
      });
    } catch (err) {
      throw this.networkError(method, label, err);
    }
    if (response.ok) {
      return response;
    }
    let text = '';
    try {
      text = await response.text();
    } catch {
      // The status is enough.
    }
    let data;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    // A reverse proxy whose Dify is stopped: the server is down.
    if ([502, 503, 504].includes(response.status)) {
      throw new DifyError(ERROR_KINDS.UNREACHABLE, `${method} ${label}: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    if (!data || typeof data !== 'object') {
      throw new DifyError(
        response.status === 401 || response.status === 403
          ? ERROR_KINDS.AUTH
          : ERROR_KINDS.NOT_DIFY,
        `${method} ${label}: HTTP ${response.status}, not a Dify answer`,
        { status: response.status },
      );
    }
    const code = typeof data.code === 'string' ? data.code : undefined;
    const message = typeof data.message === 'string' ? ` ${clean(data.message)}` : '';
    throw new DifyError(
      kindOf(response.status, code),
      `${method} ${label}: HTTP ${response.status}${code ? ` ${code}` : ''}${message}`,
      { status: response.status, code },
    );
  }

  networkError(method, label, err, timeoutMs) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return new DifyError(
        ERROR_KINDS.TIMEOUT,
        `${method} ${label}: no answer within ${timeoutMs ? `${timeoutMs / 1000} s` : 'the delay'}`,
        { cause: err },
      );
    }
    // fetch refuses redirects (`redirect: 'error'`): a proxy sending HTTP to
    // HTTPS, or a login page, is a wrong address, not a server down.
    if (/redirect/i.test(String(err?.cause?.message ?? err?.message))) {
      return new DifyError(ERROR_KINDS.NOT_DIFY, `${method} ${label}: redirected`, { cause: err });
    }
    const code = err?.cause?.code ?? err?.code;
    return new DifyError(
      ERROR_KINDS.UNREACHABLE,
      `${method} ${label}: ${code ?? err?.message ?? 'network error'}`,
      { cause: err },
    );
  }

  async getJson(path) {
    const signal = AbortSignal.timeout(READ_TIMEOUT_MS);
    let text;
    try {
      const response = await this.send('GET', path, { signal });
      text = await response.text();
    } catch (err) {
      if (err instanceof DifyError) {
        throw err;
      }
      throw this.networkError('GET', path, err, READ_TIMEOUT_MS);
    }
    try {
      const data = JSON.parse(text);
      if (data && typeof data === 'object') {
        return data;
      }
    } catch {
      // Below.
    }
    throw new DifyError(ERROR_KINDS.NOT_DIFY, `GET ${path}: not a Dify answer`);
  }

  /**
   * The app the key opens.
   * @returns {Promise<{ name: string, mode: string|null, description: string }>}
   */
  async info() {
    const data = await this.getJson('/v1/info');
    if (typeof data.name !== 'string') {
      throw new DifyError(ERROR_KINDS.NOT_DIFY, 'GET /v1/info: no app name');
    }
    return {
      name: data.name.trim() || 'Dify',
      mode: typeof data.mode === 'string' ? data.mode : null,
      description: typeof data.description === 'string' ? data.description : '',
    };
  }

  /**
   * The input variables of the app (its start node or prompt variables).
   * @returns {Promise<Array<{ variable: string, label: string, required: boolean, type: string }>>}
   */
  async inputs() {
    const data = await this.getJson('/v1/parameters');
    const form = Array.isArray(data.user_input_form) ? data.user_input_form : [];
    return form.flatMap((item) => {
      const [type, field] = Object.entries(item ?? {})[0] ?? [];
      if (!field || typeof field.variable !== 'string') {
        return [];
      }
      return [
        {
          variable: field.variable,
          label: typeof field.label === 'string' ? field.label : field.variable,
          required: field.required === true,
          type,
        },
      ];
    });
  }

  /**
   * Run the app once and wait for its end.
   * @param {object} request
   * @param {string} request.mode app mode (APP_MODES)
   * @param {object} request.inputs input variables
   * @param {string} [request.query] the message (chat and completion apps)
   * @param {string} [request.conversationId] conversation to continue (chat apps)
   * @param {number} request.timeoutMs
   */
  async run({ mode, inputs, query, conversationId, timeoutMs }) {
    let path;
    const body = { inputs, response_mode: 'streaming', user: DIFY_USER };
    if (mode === APP_MODES.WORKFLOW) {
      path = '/v1/workflows/run';
    } else if (mode === APP_MODES.COMPLETION) {
      path = '/v1/completion-messages';
      // Older completion apps read the text from the `query` variable.
      body.inputs = { query, ...inputs };
    } else {
      path = '/v1/chat-messages';
      body.query = query;
      body.conversation_id = conversationId ?? '';
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException('timeout', 'TimeoutError')),
      timeoutMs,
    );
    const result = emptyRun();
    try {
      const response = await this.send('POST', path, {
        body,
        signal: controller.signal,
        stream: true,
      });
      const type = response.headers.get('content-type') ?? '';
      if (!type.includes('text/event-stream')) {
        // A server that ignored `streaming` (a proxy, an old version): one object.
        const data = JSON.parse((await response.text()) || 'null');
        foldEvents(
          [
            { event: 'message_end', ...data },
            data.data
              ? { event: 'workflow_finished', data: data.data }
              : { event: 'message', answer: data.answer },
          ],
          result,
        );
        return result;
      }
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const { events, rest } = parseSse(buffer);
        buffer = rest;
        foldEvents(events, result);
      }
      foldEvents(parseSse(`${buffer}\n\n`).events, result);
      return result;
    } catch (err) {
      if (err instanceof DifyError) {
        throw err;
      }
      const failure = this.networkError('POST', path, controller.signal.reason ?? err, timeoutMs);
      failure.taskId = result.taskId;
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ask Dify to stop a run the integration gave up on (best effort). */
  async stop(mode, taskId) {
    if (!taskId) {
      return;
    }
    const path =
      mode === APP_MODES.WORKFLOW
        ? `/v1/workflows/tasks/${encodeURIComponent(taskId)}/stop`
        : mode === APP_MODES.COMPLETION
          ? `/v1/completion-messages/${encodeURIComponent(taskId)}/stop`
          : `/v1/chat-messages/${encodeURIComponent(taskId)}/stop`;
    const response = await this.send('POST', path, {
      body: { user: DIFY_USER },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      label: path.replace(taskId, '…'),
    });
    await response.text().catch(() => {});
  }
}
