// -----------------------------------------------------------------------------
// The Dify hub: every app (one API key each) is read on a timer of the
// container (the interval chosen in the configuration), its states published
// to Gladys when they change, the "offline" / "back" scene events fired on
// transitions of the instance; and the runs of the scene actions, with the
// "run failed" event.
//
// Gladys never polls the devices (should_poll: false): the configurable
// interval goes up to 5 minutes, beyond the fixed list of the core scheduler,
// and the scene events must fire even when no device was added.
// (Adapted from guim31/gladys-flowise.)
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { appIdOf, buildDevice, deviceIds, featureValues } from './devices.js';
import { APP_MODES, CHAT_MODES, DifyClient, ERROR_KINDS } from './dify/client.js';
import { ConversationStore } from './conversations.js';
import {
  ACTION_TEXT,
  ActionFailure,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  everyLanguage,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'dify-hub' });

export const WIDGET_KEY = 'dify';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  RUN_FAILED: 'run_failed',
  OFFLINE: 'server_offline',
  BACK: 'server_back',
});

export const HUB_TIMINGS = {
  // A server that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before the server counts as down (scene event).
  downAfterFailures: 2,
  // States that do not change are sent again this often, or Gladys shows
  // "no recent value" after 48 hours.
  heartbeatMs: 12 * 60 * 60_000,
  // The shortest wait granted to a run, whatever is left of the action budget.
  minRunMs: 5_000,
};

// What the scene action hands over: Gladys caps an output at 10 000 characters.
export const MAX_ANSWER_CHARACTERS = 10_000;
export const DEFAULT_ANSWER_CHARACTERS = 1000;
export const MIN_ANSWER_CHARACTERS = 50;

// What Gladys grants the scene action (120 s), minus a margin for the answer.
export const ACTION_BUDGET_MS = 115_000;

// A conversation name typed in a scene.
export const MAX_CONVERSATION_LENGTH = 100;

const DOWN_KINDS = new Set([ERROR_KINDS.UNREACHABLE, ERROR_KINDS.TIMEOUT]);

// Workflow output keys that hold "the" answer when a workflow has several.
const ANSWER_KEYS = ['answer', 'text', 'result', 'output'];

/**
 * Cut an answer to `max` characters, at the end of a sentence when one ends in
 * the last third, else at a word; `…` marks the cut.
 * @returns {{ text: string, truncated: boolean }}
 */
export function truncate(text, max) {
  if (text.length <= max) {
    return { text, truncated: false };
  }
  // Room for the " …" mark of a cut at the end of a sentence.
  const room = text.slice(0, max - 2);
  const sentence = Math.max(
    ...['. ', '! ', '? ', '.\n', '!\n', '?\n', '\n'].map((end) => room.lastIndexOf(end)),
  );
  if (sentence >= max * 0.66) {
    return { text: `${room.slice(0, sentence + 1).trimEnd()} …`, truncated: true };
  }
  const word = room.lastIndexOf(' ');
  const cut = word >= max * 0.66 ? room.slice(0, word) : room;
  return { text: `${cut.trimEnd()}…`, truncated: true };
}

/** A number of characters typed in a scene (a number, or a string). */
export function parseMaxCharacters(raw) {
  const number = typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : raw;
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    return DEFAULT_ANSWER_CHARACTERS;
  }
  return Math.min(MAX_ANSWER_CHARACTERS, Math.max(MIN_ANSWER_CHARACTERS, Math.round(number)));
}

/** The conversation typed in a scene ('' for none). */
export function parseConversation(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return '';
  }
  return String(raw).trim().slice(0, MAX_CONVERSATION_LENGTH);
}

/**
 * The inputs typed in a scene: a JSON object, or `name=value` pairs, one per
 * line or separated by `;` (`name: value` too). null when not understood.
 * @returns {Record<string, unknown>|null}
 */
export function parseInputs(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...raw };
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {};
  }
  const text = raw.trim();
  if (text.startsWith('{')) {
    try {
      const value = JSON.parse(text);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }
  const inputs = {};
  for (const part of text.split(/\r?\n|;/)) {
    if (!part.trim()) {
      continue;
    }
    const match = part.match(/^\s*([A-Za-z_][\w-]*)\s*[=:]\s*(.*?)\s*$/s);
    if (!match) {
      return null;
    }
    inputs[match[1]] = match[2];
  }
  return inputs;
}

/**
 * Turn the inputs typed as text into what the form of the app expects: a
 * number for a number field (a decimal comma accepted).
 */
export function typeInputs(inputs, form) {
  const typed = { ...inputs };
  for (const field of form) {
    const value = typed[field.variable];
    if (field.type === 'number' && typeof value === 'string' && value.trim() !== '') {
      const number = Number(value.trim().replace(',', '.'));
      if (Number.isFinite(number)) {
        typed[field.variable] = number;
      }
    }
  }
  return typed;
}

/** The text a workflow gives back: its only text output, or a usual key, else JSON. */
export function workflowAnswer(outputs) {
  if (!outputs || typeof outputs !== 'object') {
    return '';
  }
  const entries = Object.entries(outputs);
  if (entries.length === 1 && typeof entries[0][1] === 'string') {
    return entries[0][1];
  }
  for (const key of ANSWER_KEYS) {
    if (typeof outputs[key] === 'string') {
      return outputs[key];
    }
  }
  return entries.length === 0 ? '' : JSON.stringify(outputs);
}

const round1 = (seconds) => Math.round(seconds * 10) / 10;

export class DifyHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {typeof fetch} [options.fetch] HTTP seam (tests)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   * @param {string|null} [options.dataDir] where conversations are kept (null: memory)
   */
  constructor({ gladys, fetch, timers = true, timings, now, dataDir }) {
    this.gladys = gladys;
    this.fetch = fetch;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.conversations = new ConversationStore(dataDir);
    this.config = null;
    /** @type {Map<string, object>} apps by id (hash of their key), in the order of the keys */
    this.apps = new Map();
    this.state = this.emptyState();
    /** Last value published per feature external id. */
    this.published = new Map();
    this.publishedDevices = null;
    this.heartbeatAt = 0;
    this.transports = new Map();
    this.connection = null;
    this.pollTimer = null;
    this.retryTimer = null;
    this.reading = null;
    this.stopped = false;
    /** Problems already logged as warnings, by key: repeats go to debug. */
    this.warned = new Set();
  }

  emptyState() {
    return { online: null, error: null, failures: 0, down: false, downSince: null };
  }

  /** The configured address and at least one key: something to read. */
  get configured() {
    return Boolean(this.config?.url && this.config.apiKeys.length > 0);
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (Dify connected, lost, back, user runs). A
  // problem that repeats every cycle is logged once, then at debug until it
  // clears. Never an input, a message, an answer or a key.

  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  resolved(key) {
    this.warned.delete(key);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    await this.conversations.load();
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.publishedDevices = null;
    this.transports.clear();
    this.connection = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const keysOf = (c) => (c ? `${c.url}\n${c.apiKeys.join('\n')}` : null);
    if (keysOf(previous) !== keysOf(config)) {
      const apps = new Map();
      for (const apiKey of config.url ? config.apiKeys : []) {
        const id = appIdOf(apiKey);
        const old = this.apps.get(id);
        apps.set(id, {
          id,
          client: new DifyClient({ url: config.url, apiKey, fetch: this.fetch }),
          // The last run survives a change of address: it happened.
          info: previous?.url === config.url ? (old?.info ?? null) : null,
          online: null,
          error: null,
          lastRun: old?.lastRun ?? null,
          lastAnswer: old?.lastAnswer ?? null,
        });
      }
      this.apps = apps;
      // Another server: forget what the previous one said, without events.
      if (previous?.url !== config.url) {
        this.state = this.emptyState();
      }
      clearTimeout(this.retryTimer);
    }
    try {
      await this.publishDevices();
      await this.refresh();
    } finally {
      // A refused publication must not stop the readings for good.
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.retryTimer);
    await this.reading?.catch(() => {});
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.configured) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.refresh();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', 'Reading failed', err, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  later(name, delay, run) {
    clearTimeout(this[name]);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this[name] = setTimeout(() => {
      run().catch((err) => this.problem(name, 'Reading failed', err, 'error'));
    }, delay);
    this[name].unref?.();
  }

  // --- Devices ---------------------------------------------------------------

  /** The apps already read once (their name is known), in the order of the keys. */
  knownApps() {
    return [...this.apps.values()].filter((app) => app.info);
  }

  async publishDevices() {
    // An empty list when nothing is configured: the Discovery tab shows nothing stale.
    const devices = this.knownApps().map((app) =>
      buildDevice(this.gladys, app, this.config.url, this.config.language),
    );
    const key = JSON.stringify(devices);
    if (key === this.publishedDevices) {
      return;
    }
    await this.gladys.publishDiscoveredDevices(devices);
    this.publishedDevices = key;
  }

  /** "Search" in the Discovery tab: read the apps, publish them again. */
  async rediscover() {
    this.publishedDevices = null;
    await this.refresh();
    await this.publishDevices();
  }

  appOfDevice(device) {
    return this.knownApps().find(
      (app) => deviceIds(this.gladys, app.id).device === device?.external_id,
    );
  }

  /** The user added (or updated) a device: its states sent before were dropped. */
  async onDeviceCreated(device) {
    const app = this.appOfDevice(device);
    if (!app) {
      return;
    }
    this.transports.delete(app.id);
    await this.publishStates({ force: true, only: app });
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** The name shown for an app: the one given in Gladys, else the one of Dify. */
  appLabel(app) {
    const externalId = deviceIds(this.gladys, app.id).device;
    const device = (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
    return device?.name || app.info?.name || 'Dify';
  }

  // --- Reading the apps ------------------------------------------------------

  /** Read every app and publish what changed. Concurrent calls share the read. */
  refresh() {
    if (!this.configured) {
      return this.afterChanges(false);
    }
    // A read of a previous configuration is not shared: the new one is read now.
    if (this.reading?.apps !== this.apps) {
      const reading = this.read().finally(() => {
        if (this.reading === reading) {
          this.reading = null;
        }
      });
      reading.apps = this.apps;
      this.reading = reading;
    }
    return this.reading;
  }

  /** Gladys asks for a refresh (onPoll), a fallback: the timer does the work. */
  async pollDevice(device) {
    if (this.appOfDevice(device)) {
      await this.refresh();
    }
  }

  async read() {
    const apps = this.apps;
    const results = await Promise.all(
      [...apps.values()].map((app) =>
        app.client.info().then(
          (info) => ({ app, info }),
          (err) => {
            if (!err.kind) {
              throw err;
            }
            return { app, err };
          },
        ),
      ),
    );
    if (apps !== this.apps) {
      return; // the configuration changed while reading
    }
    const answered = results.filter((result) => !result.err || !DOWN_KINDS.has(result.err.kind));
    let widgetChanged;
    if (answered.length === 0) {
      widgetChanged = await this.applyFailure(results[0].err);
    } else {
      widgetChanged = await this.applySuccess(results);
    }
    await this.publishDevices().catch((err) =>
      this.problem('devices', `Devices refused: ${err.message}`),
    );
    await this.afterChanges(widgetChanged);
  }

  async applySuccess(results) {
    const state = this.state;
    let widgetChanged = state.online !== true || state.error !== null;
    for (const { app, info, err } of results) {
      const before = JSON.stringify([app.info, app.online, app.error?.kind]);
      if (info) {
        if (app.error) {
          logger.info(`Dify app ${info.name}: answers again`);
        } else if (!app.info) {
          logger.info(`Dify app ${info.name} (${info.mode ?? 'unknown mode'}) connected`);
        } else if (app.info.name !== info.name) {
          logger.info(`Dify app ${app.info.name} renamed ${info.name}`);
        }
        app.info = info;
        app.online = true;
        app.error = null;
      } else {
        // The instance answers, this key does not: deleted app, revoked key.
        if (app.error?.kind !== err.kind) {
          logger.warn(`Dify app ${app.info?.name ?? '(not read yet)'}: ${err.message}`);
        }
        app.online = app.info ? false : null;
        app.error = { kind: err.kind, message: err.message };
      }
      widgetChanged ||= before !== JSON.stringify([app.info, app.online, app.error?.kind]);
    }
    if (state.down) {
      const downMinutes = Math.round((this.now() - state.downSince) / 60_000);
      logger.info(`Dify answers again after ${downMinutes} min`);
      await this.fire(TRIGGERS.BACK, { downtime_minutes: downMinutes });
    } else if (state.error) {
      logger.info('Dify: connection restored');
    }
    clearTimeout(this.retryTimer);
    this.state = { online: true, error: null, failures: 0, down: false, downSince: null };
    await this.publishStates();
    return widgetChanged;
  }

  async applyFailure(err) {
    const state = this.state;
    const wasError = state.error?.kind;
    state.error = { kind: err.kind, message: err.message };
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`Dify: ${err.message}`);
    } else {
      logger.debug(`Dify: ${err.message} (again)`);
    }
    state.failures += 1;
    if (state.failures === 1 && !state.down) {
      state.downSince = this.now();
      this.later('retryTimer', this.timings.retryMs, () => this.refresh());
    }
    if (!state.down && state.failures >= this.timings.downAfterFailures) {
      state.down = true;
      state.online = false;
      for (const app of this.apps.values()) {
        app.online = app.info ? false : null;
      }
      await this.fire(TRIGGERS.OFFLINE, {
        error: pick(ERROR_TEXT[err.kind], this.config.language),
      });
      await this.publishStates();
      return true;
    }
    await this.publishStates();
    return wasError !== err.kind;
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys --------------------------------------------------

  async publishStates({ force = false, only = null } = {}) {
    const heartbeat = this.now() - this.heartbeatAt >= this.timings.heartbeatMs;
    const states = [];
    for (const app of only ? [only] : this.knownApps()) {
      for (const { externalId, value } of featureValues(this.gladys, app)) {
        if (value === null || (!force && !heartbeat && this.published.get(externalId) === value)) {
          continue;
        }
        states.push(
          typeof value === 'string'
            ? { device_feature_external_id: externalId, text: value }
            : { device_feature_external_id: externalId, state: value },
        );
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishStates(states);
      for (const state of states) {
        this.published.set(state.device_feature_external_id, state.text ?? state.state);
      }
      if (heartbeat && !only) {
        this.heartbeatAt = this.now();
      }
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged) {
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransports() {
    const changes = [];
    for (const app of this.knownApps()) {
      if (app.online === null) {
        continue;
      }
      const transport = app.online ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(app.id) !== transport) {
        changes.push({ app, transport });
      }
    }
    if (changes.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(
        changes.map(({ app, transport }) => ({
          external_id: deviceIds(this.gladys, app.id).device,
          transport,
        })),
      );
      for (const { app, transport } of changes) {
        this.transports.set(app.id, transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transport refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.url) {
      return {
        connected: false,
        message: this.config.urlTyped ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl,
      };
    }
    if (this.config.apiKeys.length === 0) {
      return { connected: false, message: CONNECTION_TEXT.noKey };
    }
    const { error } = this.state;
    // A single silent reading is a blip: red only once the server is down.
    if (error && (!DOWN_KINDS.has(error.kind) || this.state.down)) {
      return { connected: false, message: ERROR_TEXT[error.kind] };
    }
    const refused = [...this.apps.values()].find((app) => app.error);
    if (refused) {
      return { connected: false, message: ERROR_TEXT[refused.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Running an app --------------------------------------------------------

  /** An error of the client, as the user reads it (Dify's own reason appended). */
  userError(err) {
    if (!err.kind) {
      return err;
    }
    const reason = err.kind === ERROR_KINDS.RUN_FAILED || err.kind === ERROR_KINDS.INVALID_INPUT;
    const detail = reason ? err.detail : null;
    return new ActionFailure(
      detail
        ? everyLanguage((language) => `${pick(ERROR_TEXT[err.kind], language)} (${detail})`)
        : ERROR_TEXT[err.kind],
      { cause: err },
    );
  }

  /**
   * The app a scene names: by its name in Gladys or in Dify (case ignored),
   * else the only app of the right kind.
   * @param {unknown} typed
   * @param {(mode: string) => boolean} fits the modes the action can run
   */
  async appOf(typed, fits) {
    if (!this.configured) {
      throw new ActionFailure(this.connectionStatus().message);
    }
    // An app never read (Dify down at start): read now.
    if ([...this.apps.values()].some((app) => !app.info)) {
      await this.refresh();
    }
    const text = typeof typed === 'string' ? typed.trim().toLocaleLowerCase() : '';
    const apps = this.knownApps();
    if (apps.length === 0) {
      const err = this.state.error ?? [...this.apps.values()].find((app) => app.error)?.error;
      throw new ActionFailure(err ? ERROR_TEXT[err.kind] : ACTION_TEXT.noApp);
    }
    if (text) {
      const named = apps.filter((app) =>
        [this.appLabel(app), app.info.name].some(
          (name) => name.trim().toLocaleLowerCase() === text,
        ),
      );
      if (named.length === 0) {
        throw new ActionFailure(ACTION_TEXT.unknownApp);
      }
      if (named.length > 1) {
        throw new ActionFailure(ACTION_TEXT.ambiguousApp);
      }
      if (!fits(named[0].info.mode)) {
        throw new ActionFailure(ERROR_TEXT[ERROR_KINDS.WRONG_MODE]);
      }
      return named[0];
    }
    const fitting = apps.filter((app) => fits(app.info.mode));
    if (fitting.length === 1) {
      return fitting[0];
    }
    throw new ActionFailure(fitting.length === 0 ? ACTION_TEXT.noFittingApp : ACTION_TEXT.whichApp);
  }

  /** Record a run on the device, the widget, and fire "run failed" for a failure. */
  async recordRun(app, run) {
    app.lastRun = { ...run, at: this.now() };
    if (run.ok) {
      app.lastAnswer = run.answer || app.lastAnswer;
    } else {
      await this.fire(TRIGGERS.RUN_FAILED, { app: this.appLabel(app), error: run.reason });
    }
    await this.publishStates({ only: app });
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /**
   * Run an app once.
   * @param {object} request
   * @param {'workflow'|'message'} request.kind
   * @param {string} [request.app] its name
   * @param {string} [request.message]
   * @param {unknown} [request.inputs]
   * @param {string} [request.conversation]
   * @param {number|string} [request.maxCharacters]
   */
  async run({
    kind,
    app: typedApp,
    message: typedMessage,
    inputs: typedInputs,
    conversation,
    maxCharacters,
  }) {
    const asked = this.now();
    const message = typeof typedMessage === 'string' ? typedMessage.trim() : '';
    if (kind === 'message' && !message) {
      throw new ActionFailure(ACTION_TEXT.noMessage);
    }
    const inputs = parseInputs(typedInputs);
    if (inputs === null) {
      throw new ActionFailure(ACTION_TEXT.badInputs);
    }
    const fits =
      kind === 'workflow'
        ? (mode) => mode === APP_MODES.WORKFLOW
        : (mode) => CHAT_MODES.includes(mode) || mode === APP_MODES.COMPLETION;
    const app = await this.appOf(typedApp, fits);
    const label = app.info.name;
    const mode = app.info.mode;
    const max = parseMaxCharacters(maxCharacters);
    const name = mode === APP_MODES.COMPLETION ? '' : parseConversation(conversation);

    let result;
    const started = this.now();
    try {
      let form = [];
      try {
        form = await app.client.inputs();
      } catch (err) {
        if (DOWN_KINDS.has(err.kind) || err.kind === ERROR_KINDS.AUTH) {
          throw err;
        }
        // The form only types the numbers: the run can go on without it.
      }
      const missing = form.find(
        (field) =>
          field.required &&
          (inputs[field.variable] === undefined || inputs[field.variable] === '') &&
          !(mode === APP_MODES.COMPLETION && field.variable === 'query'),
      );
      if (missing) {
        throw new ActionFailure(
          everyLanguage((language) =>
            labelled(pick(ACTION_TEXT.missingInput, language), missing.variable, language),
          ),
        );
      }
      const timeoutMs = Math.max(
        this.timings.minRunMs,
        Math.min(this.config.timeoutMs, ACTION_BUDGET_MS - (this.now() - asked)),
      );
      const runOnce = (conversationId) =>
        app.client.run({
          mode,
          inputs: typeInputs(inputs, form),
          query: message,
          conversationId,
          timeoutMs,
        });
      const conversationId = name ? this.conversations.get(app.id, name) : undefined;
      try {
        result = await runOnce(conversationId);
      } catch (err) {
        // A conversation deleted in Dify: start a new one under the same name.
        if (conversationId && err.status === 404) {
          logger.info(`Dify app ${label}: conversation gone, a new one is started`);
          await this.conversations.delete(app.id, name);
          result = await runOnce(undefined);
        } else {
          throw err;
        }
      }
      if (result.failure) {
        throw result.failure;
      }
      // A workflow ends on its status; a chatflow too (an error node, a stop).
      if (
        (mode === APP_MODES.WORKFLOW || result.status !== null) &&
        result.status !== 'succeeded'
      ) {
        const failure = new Error(`workflow ${result.status ?? 'ended without status'}`);
        failure.kind = ERROR_KINDS.RUN_FAILED;
        failure.detail = result.error ?? result.status ?? undefined;
        throw failure;
      }
    } catch (err) {
      if (err instanceof ActionFailure) {
        throw err;
      }
      if (err.kind === ERROR_KINDS.TIMEOUT && err.taskId) {
        app.client.stop(mode, err.taskId).catch(() => {});
      }
      if (
        err.kind &&
        !err.detail &&
        [ERROR_KINDS.RUN_FAILED, ERROR_KINDS.INVALID_INPUT].includes(err.kind)
      ) {
        // Dify's own reason, without the request line.
        err.detail = err.message.replace(/^POST \S+: HTTP \d+ \S+ /, '') || undefined;
      }
      logger.warn(
        `Run of the Dify app ${label} failed: ${err.kind ?? ''} ${err.status ?? ''}`.trim(),
      );
      const failure = this.userError(err);
      await this.recordRun(app, {
        ok: false,
        duration: round1((this.now() - started) / 1000),
        tokens: null,
        reason: pick(failure.message, this.config.language),
      });
      throw failure;
    }

    if (name && result.conversationId) {
      await this.conversations.set(app.id, name, result.conversationId);
    }
    const text = (
      mode === APP_MODES.WORKFLOW ? workflowAnswer(result.outputs) : result.answer
    ).trim();
    const { text: response, truncated } = truncate(text, max);
    const seconds = round1(result.elapsed ?? (this.now() - started) / 1000);
    // Lengths only: the inputs and the answer stay out of the logs.
    logger.info(
      `Dify app ${label} answered in ${seconds} s (${response.length} characters${truncated ? ', cut' : ''})`,
    );
    await this.recordRun(app, {
      ok: true,
      duration: seconds,
      tokens: result.tokens ?? 0,
      answer: response,
    });
    const outputs = {
      response,
      app: this.appLabel(app),
      duration_seconds: seconds,
      tokens: result.tokens ?? 0,
      truncated,
    };
    if (kind === 'workflow') {
      outputs.outputs = truncate(JSON.stringify(result.outputs ?? {}), MAX_ANSWER_CHARACTERS).text;
    } else {
      outputs.conversation_id = result.conversationId ?? '';
    }
    return outputs;
  }

  /** "Test the connection": read the apps now, one line (red on failure). */
  async testConnection() {
    await this.refresh();
    if (!this.configured) {
      throw new ActionFailure(this.connectionStatus().message);
    }
    if (this.state.error) {
      throw new ActionFailure(
        everyLanguage((language) =>
          labelled('Dify', pick(ERROR_TEXT[this.state.error.kind], language), language),
        ),
      );
    }
    const apps = [...this.apps.values()];
    const refused = apps.filter((app) => app.error);
    const line = (language) => {
      const text = REPORT_TEXT[language];
      const names = apps
        .filter((app) => app.info && !app.error)
        .map((app) => `${app.info.name} (${text.mode(app.info.mode)})`);
      const parts = [];
      if (names.length > 0) {
        parts.push(labelled(text.apps(names.length), names.join(', '), language));
      }
      for (const app of refused) {
        parts.push(
          labelled(
            app.info?.name ?? text.keyNumber(apps.indexOf(app) + 1),
            pick(ERROR_TEXT[app.error.kind], language),
            language,
          ),
        );
      }
      return parts.join('. ');
    };
    if (refused.length > 0) {
      throw new ActionFailure(everyLanguage(line));
    }
    return everyLanguage((language) => `${REPORT_TEXT[language].ok} ${line(language)}`);
  }
}
