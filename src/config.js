// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

// Longest wait for an answer, in seconds. A scene action is granted 120 s
// by Gladys (connection wait included): the longest choice leaves a margin.
export const TIMEOUTS = ['30', '60', '90', '110'];

export const DEFAULT_CONFIG = {
  url: '',
  api_keys: '',
  timeout: '60',
  poll_interval: '60',
  language: 'fr',
};

// Pages of the Dify interface and API roots: a URL copied from the browser
// points at one of them, the instance lives at the root.
const INTERFACE_PATH =
  /\/(v1|console\/api|api|apps|app|chat|chatbot|workflow|completion|datasets|explore|tools|plugins|signin|install)(\/.*)?$/i;

// Dify app API keys ("app-" and 24 characters); other shapes are accepted, a
// self-hosted fork may differ, but never blanks or separators.
const KEY_SEPARATORS = /[\s,;]+/;
export const MAX_APPS = 10;

/**
 * The API keys typed by the user (one per Dify app), separated by spaces,
 * commas, semicolons or new lines; duplicates dropped.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseApiKeys(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  const keys = raw
    .split(KEY_SEPARATORS)
    .map((key) => key.trim())
    .filter(Boolean);
  return [...new Set(keys)].slice(0, MAX_APPS);
}

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, port 80), `host:port`, or a URL copied from the
 * browser (`https://dify.example.org/apps`, the page dropped, a
 * reverse proxy path kept).
 * @param {unknown} raw
 * @returns {string|null} base URL without trailing slash, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const typedScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(typedScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '').replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  const typed = text('url');
  return {
    url: parseServerUrl(typed),
    urlTyped: typed !== '',
    apiKeys: parseApiKeys(source.api_keys),
    timeoutMs: Number(pick('timeout', TIMEOUTS)) * 1000,
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
