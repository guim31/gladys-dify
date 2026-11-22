import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_APPS, normalizeConfig, parseApiKeys, parseServerUrl } from '../src/config.js';

test('parseServerUrl: a host, a page of the interface or an API path is dropped', () => {
  assert.equal(parseServerUrl('192.0.2.20'), 'http://192.0.2.20');
  assert.equal(parseServerUrl(' dify.lan:8080 '), 'http://dify.lan:8080');
  assert.equal(parseServerUrl('http://192.0.2.20/apps'), 'http://192.0.2.20');
  assert.equal(parseServerUrl('http://192.0.2.20/app/0f1e/workflow'), 'http://192.0.2.20');
  assert.equal(parseServerUrl('http://192.0.2.20/v1'), 'http://192.0.2.20');
  assert.equal(parseServerUrl('https://api.dify.ai/v1'), 'https://api.dify.ai');
  assert.equal(parseServerUrl('https://ai.example.org/dify/'), 'https://ai.example.org/dify');
  assert.equal(parseServerUrl('http://user:pass@192.0.2.20'), null);
  assert.equal(parseServerUrl('ftp://192.0.2.20'), null);
  assert.equal(parseServerUrl(''), null);
  assert.equal(parseServerUrl(undefined), null);
});

test('parseApiKeys: spaces, commas, semicolons, new lines; duplicates dropped', () => {
  assert.deepEqual(parseApiKeys(' app-a, app-b;app-c\napp-a  app-d '), [
    'app-a',
    'app-b',
    'app-c',
    'app-d',
  ]);
  assert.deepEqual(parseApiKeys(''), []);
  assert.deepEqual(parseApiKeys(undefined), []);
  const many = Array.from({ length: 15 }, (_, i) => `app-${i}`).join(' ');
  assert.equal(parseApiKeys(many).length, MAX_APPS);
});

test('normalizeConfig: defaults and choices', () => {
  assert.deepEqual(normalizeConfig({}), {
    url: null,
    urlTyped: false,
    apiKeys: [],
    timeoutMs: 60_000,
    pollIntervalMs: 60_000,
    language: 'fr',
  });
  const config = normalizeConfig({
    url: 'not a url at all',
    api_keys: ' app-key ',
    timeout: '110',
    poll_interval: '7',
    language: 'it',
  });
  assert.equal(config.url, null);
  assert.equal(config.urlTyped, true);
  assert.deepEqual(config.apiKeys, ['app-key']);
  assert.equal(config.timeoutMs, 110_000);
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.language, 'fr');
});
