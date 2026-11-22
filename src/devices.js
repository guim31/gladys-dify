// -----------------------------------------------------------------------------
// One Gladys device per Dify app, the app its API key opens.
//
// Identity: Dify does not tell an app its id through the Service API, and the
// key alone selects the app. The device id is a short SHA-256 of the key
// (never the key itself): a renamed app keeps its device, a new key makes a
// new one (documented).
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js):
//   - online: input/binary, 1 when the app answers with its key, 0 when Dify
//     is down (two failed readings in a row) or refuses the key (app deleted);
//   - last run: input/binary, 1 when the last run from a scene succeeded;
//   - duration: duration/decimal in seconds, of the last run;
//   - tokens: counter-sensor/integer, tokens spent by the last run;
//   - last answer: text/text, its beginning (LAST_ANSWER_MAX characters).
//
// should_poll: false: the hub reads the apps on its own timer, at the
// interval chosen in the configuration (see src/hub.js).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'app';
export const URL_PARAM = 'DIFY_URL';
export const MODE_PARAM = 'DIFY_APP_MODE';

// The dashboard shows a text feature on one row: a long answer stays in the
// scene, the device keeps its beginning.
export const LAST_ANSWER_MAX = 500;

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ONLINE: 'online',
  LAST_RUN: 'last_run',
  DURATION: 'duration',
  TOKENS: 'tokens',
  LAST_ANSWER: 'last_answer',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.ONLINE]: 'Online',
    [FEATURE_KEYS.LAST_RUN]: 'Last run succeeded',
    [FEATURE_KEYS.DURATION]: 'Last run duration',
    [FEATURE_KEYS.TOKENS]: 'Last run tokens',
    [FEATURE_KEYS.LAST_ANSWER]: 'Last answer',
  },
  fr: {
    [FEATURE_KEYS.ONLINE]: 'En ligne',
    [FEATURE_KEYS.LAST_RUN]: 'Dernière exécution réussie',
    [FEATURE_KEYS.DURATION]: 'Durée de la dernière exécution',
    [FEATURE_KEYS.TOKENS]: 'Tokens de la dernière exécution',
    [FEATURE_KEYS.LAST_ANSWER]: 'Dernière réponse',
  },
  de: {
    [FEATURE_KEYS.ONLINE]: 'Online',
    [FEATURE_KEYS.LAST_RUN]: 'Letzte Ausführung erfolgreich',
    [FEATURE_KEYS.DURATION]: 'Dauer der letzten Ausführung',
    [FEATURE_KEYS.TOKENS]: 'Tokens der letzten Ausführung',
    [FEATURE_KEYS.LAST_ANSWER]: 'Letzte Antwort',
  },
  es: {
    [FEATURE_KEYS.ONLINE]: 'En línea',
    [FEATURE_KEYS.LAST_RUN]: 'Última ejecución correcta',
    [FEATURE_KEYS.DURATION]: 'Duración de la última ejecución',
    [FEATURE_KEYS.TOKENS]: 'Tokens de la última ejecución',
    [FEATURE_KEYS.LAST_ANSWER]: 'Última respuesta',
  },
};

/** The platform id of the app a key opens: never the key itself. */
export const appIdOf = (apiKey) => createHash('sha256').update(apiKey).digest('hex').slice(0, 16);

/** The answer as the device keeps it: one line, cut at LAST_ANSWER_MAX. */
export function shortAnswer(text) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > LAST_ANSWER_MAX ? `${line.slice(0, LAST_ANSWER_MAX - 1).trimEnd()}…` : line;
}

// Order = display order in Gladys. A value of null publishes nothing.
const FEATURES = [
  {
    key: FEATURE_KEYS.ONLINE,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.INPUT,
      type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: 1,
    },
    value: (app) => (app.online === null ? null : app.online ? 1 : 0),
  },
  {
    key: FEATURE_KEYS.LAST_RUN,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.INPUT,
      type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: 1,
    },
    value: (app) => (app.lastRun ? (app.lastRun.ok ? 1 : 0) : null),
  },
  {
    key: FEATURE_KEYS.DURATION,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.DURATION,
      type: DEVICE_FEATURE_TYPES.DURATION.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.SECONDS,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      // Display bound only: a scene action is granted 120 s by Gladys.
      max: 120,
    },
    value: (app) => app.lastRun?.duration ?? null,
  },
  {
    key: FEATURE_KEYS.TOKENS,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      // Display bound only, the core never applies it on write.
      max: 1_000_000,
    },
    value: (app) => app.lastRun?.tokens ?? null,
  },
  {
    key: FEATURE_KEYS.LAST_ANSWER,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      read_only: true,
      has_feedback: false,
      keep_history: false,
      min: 0,
      max: 0,
    },
    // Gladys ignores an empty text.
    value: (app) => (app.lastAnswer ? shortAnswer(app.lastAnswer) || null : null),
  },
];

/** External ids of the device of an app and its features. */
export const deviceIds = (gladys, appId) => gladys.externalIds(DEVICE_TYPE, appId);

/**
 * The discovery payload of an app.
 * @param {object} gladys SDK client
 * @param {object} app { id, info: { name, mode } }
 * @param {string} url base URL of Dify
 * @param {string} [language] feature names language
 */
export function buildDevice(gladys, app, url, language = 'en') {
  const ids = deviceIds(gladys, app.id);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: app.info.name,
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: URL_PARAM, value: url },
      { name: MODE_PARAM, value: app.info.mode ?? 'unknown' },
    ],
    features: FEATURES.map(({ key, definition }) => ({
      ...definition,
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The value of every feature of an app (null: nothing to publish).
 * @returns {Array<{ key: string, externalId: string, value: number|string|null }>}
 */
export function featureValues(gladys, app) {
  const ids = deviceIds(gladys, app.id);
  return FEATURES.map(({ key, value }) => ({
    key,
    externalId: ids.feature(key),
    value: value(app),
  }));
}
