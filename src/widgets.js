// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `dify`.
//
// The use cases: is Dify up (the scenes that run its apps depend on it), did
// the last run of each app succeed and when, and what the latest answer was,
// readable on a tablet without opening the scene history.
//
// Budget (8 components, 2 texts): one status list (the server, then one row
// per app, under the name given in Gladys) and one text (the latest answer,
// hidden by the `show_answer` setting). Nothing here is bound to device
// features: the widget works before the devices are added to Gladys.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { shortAnswer } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ERROR_KINDS } from './dify/client.js';
import { pick } from './texts.js';

// The text block shows the beginning of a long answer.
export const WIDGET_ANSWER_MAX = 300;
// Rows of apps in the status list: the core keeps 10 rows, the server takes one.
export const WIDGET_APPS_MAX = 9;

export const TEXT = {
  noConfig: {
    en: 'Enter the address of your Dify server and the API key of an app in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre serveur Dify et la clé d'API d'une app dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Dify-Servers und den API-Schlüssel einer App in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su servidor Dify y la clave de API de una app en la configuración de la integración.',
  },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  unreachable: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  keyRefused: {
    en: 'Key refused',
    fr: 'Clé refusée',
    de: 'Schlüssel abgelehnt',
    es: 'Clave rechazada',
  },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  waiting: { en: 'Waiting…', fr: 'En attente…', de: 'Warte…', es: 'Esperando…' },
  succeeded: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  failed: { en: 'Failed', fr: 'Échec', de: 'Fehlgeschlagen', es: 'Fallida' },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** "14:05" today, "19/10 14:05" another day, in the time zone of Gladys (TZ). */
export function formatTime(at, now) {
  const date = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return new Date(now).toDateString() === date.toDateString()
    ? time
    : `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${time}`;
}

function serverRow(state, language) {
  if (state.error && (state.down || state.online === null)) {
    const unreachable = [ERROR_KINDS.UNREACHABLE, ERROR_KINDS.TIMEOUT].includes(state.error.kind);
    return {
      label: 'Dify',
      icon: 'alert-triangle',
      value: t(unreachable ? TEXT.unreachable : TEXT.error, language),
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (state.online) {
    return {
      label: 'Dify',
      icon: 'server',
      value: t(TEXT.online, language),
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  return {
    label: 'Dify',
    icon: 'clock',
    value: t(TEXT.waiting, language),
    color: WIDGET_COLORS.NEUTRAL,
  };
}

function appRow(hub, app, language) {
  const icon = app.info?.mode === 'workflow' ? 'git-branch' : 'message-square';
  const label = fit(hub.appLabel(app), 40);
  if (app.error) {
    return {
      label,
      icon: 'alert-triangle',
      value: t(app.error.kind === ERROR_KINDS.AUTH ? TEXT.keyRefused : TEXT.error, language),
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (app.online === false) {
    return { label, icon, value: t(TEXT.unreachable, language), color: WIDGET_COLORS.DANGER };
  }
  if (app.lastRun) {
    const time = formatTime(app.lastRun.at, hub.now());
    return {
      label,
      icon,
      value: `${t(app.lastRun.ok ? TEXT.succeeded : TEXT.failed, language)} · ${time}`,
      color: app.lastRun.ok ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    };
  }
  return { label, icon, value: t(TEXT.online, language), color: WIDGET_COLORS.NEUTRAL };
}

async function get(hub, { language = 'en', settings = {} } = {}) {
  if (!hub.configured) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: t(TEXT.noConfig, language) }],
    };
  }
  const apps = hub.knownApps();
  const items = [
    serverRow(hub.state, language),
    ...apps.slice(0, WIDGET_APPS_MAX).map((app) => appRow(hub, app, language)),
  ];
  const components = [{ type: 'status', items }];
  const latest = apps
    .filter((app) => app.lastAnswer && app.lastRun)
    .sort((a, b) => b.lastRun.at - a.lastRun.at)[0];
  if (latest && settings.show_answer !== false && settings.show_answer !== 'false') {
    components.push({
      type: 'text',
      variant: 'body',
      text: fit(shortAnswer(latest.lastAnswer), WIDGET_ANSWER_MAX),
    });
  }
  return { ttl_seconds: 60, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get },
};
