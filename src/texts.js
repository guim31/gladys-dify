// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene action
// errors. Four languages, the four of the Gladys interface; German says "du",
// Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './dify/client.js';

/**
 * A failure shown in red by Gladys (a returned value is shown in green, a
 * thrown one in red), its message in every language.
 */
export class ActionFailure extends Error {
  constructor(text, options) {
    super(text.en, options);
    this.name = 'ActionFailure';
    this.message = text;
  }
}

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Dify server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur Dify dans la configuration.",
    de: 'Gib die Adresse deines Dify-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor Dify en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.20',
    fr: 'Adresse incomprise, ex. http://192.168.1.20',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.20',
    es: 'Dirección no válida, p. ej. http://192.168.1.20',
  },
  noKey: {
    en: 'Enter the API key of at least one Dify app in the configuration.',
    fr: "Saisissez la clé d'API d'au moins une app Dify dans la configuration.",
    de: 'Gib in der Konfiguration den API-Schlüssel mindestens einer Dify-App ein.',
    es: 'Introduzca la clave de API de al menos una app de Dify en la configuración.',
  },
};

// One short explanation per error kind (src/dify/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Dify does not answer: check the address and the port',
    fr: "Dify ne répond pas : vérifiez l'adresse et le port",
    de: 'Dify antwortet nicht: Prüfe die Adresse und den Port',
    es: 'Dify no responde: compruebe la dirección y el puerto',
  },
  [ERROR_KINDS.TIMEOUT]: {
    en: 'Dify took too long to answer: raise the longest wait',
    fr: "Dify a mis trop de temps à répondre : augmentez l'attente maximale",
    de: 'Dify hat zu lange gebraucht: Erhöhe die längste Wartezeit',
    es: 'Dify ha tardado demasiado: aumente la espera máxima',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key refused: the app was deleted or the key revoked',
    fr: "Clé d'API refusée : l'app a été supprimée ou la clé révoquée",
    de: 'API-Schlüssel abgelehnt: Die App wurde gelöscht oder der Schlüssel widerrufen',
    es: 'Clave de API rechazada: la app se ha eliminado o se ha revocado la clave',
  },
  [ERROR_KINDS.NOT_DIFY]: {
    en: 'No Dify server at this address',
    fr: 'Aucun serveur Dify à cette adresse',
    de: 'Kein Dify-Server unter dieser Adresse',
    es: 'No hay ningún servidor Dify en esta dirección',
  },
  [ERROR_KINDS.APP_UNAVAILABLE]: {
    en: 'The app is not ready: publish it in Dify',
    fr: "L'app n'est pas prête : publiez-la dans Dify",
    de: 'Die App ist nicht bereit: Veröffentliche sie in Dify',
    es: 'La app no está lista: publíquela en Dify',
  },
  [ERROR_KINDS.WRONG_MODE]: {
    en: 'This app cannot run this action (workflow or chat)',
    fr: 'Cette app ne peut pas faire cette action (workflow ou chat)',
    de: 'Diese App kann diese Aktion nicht ausführen (Workflow oder Chat)',
    es: 'Esta app no puede realizar esta acción (workflow o chat)',
  },
  [ERROR_KINDS.INVALID_INPUT]: {
    en: 'Dify refused the inputs',
    fr: 'Dify a refusé les entrées',
    de: 'Dify hat die Eingaben abgelehnt',
    es: 'Dify ha rechazado las entradas',
  },
  [ERROR_KINDS.RUN_FAILED]: {
    en: 'The run failed in Dify',
    fr: "L'exécution a échoué dans Dify",
    de: 'Die Ausführung ist in Dify fehlgeschlagen',
    es: 'La ejecución ha fallado en Dify',
  },
  [ERROR_KINDS.QUOTA]: {
    en: 'Quota or rate limit of the model reached',
    fr: 'Quota ou limite de débit du modèle atteint',
    de: 'Kontingent oder Ratenlimit des Modells erreicht',
    es: 'Cuota o límite de velocidad del modelo alcanzado',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'Dify refused the request, see the logs',
    fr: 'Dify a refusé la requête, voir les logs',
    de: 'Dify hat die Anfrage abgelehnt, sieh in den Protokollen nach',
    es: 'Dify ha rechazado la solicitud, consulte los registros',
  },
};

const MODES = {
  en: {
    workflow: 'workflow',
    'advanced-chat': 'chatflow',
    chat: 'chat',
    'agent-chat': 'agent',
    completion: 'text generator',
  },
  fr: {
    workflow: 'workflow',
    'advanced-chat': 'chatflow',
    chat: 'chat',
    'agent-chat': 'agent',
    completion: 'générateur de texte',
  },
  de: {
    workflow: 'Workflow',
    'advanced-chat': 'Chatflow',
    chat: 'Chat',
    'agent-chat': 'Agent',
    completion: 'Textgenerator',
  },
  es: {
    workflow: 'workflow',
    'advanced-chat': 'chatflow',
    chat: 'chat',
    'agent-chat': 'agente',
    completion: 'generador de texto',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Dify answers.',
    apps: (count) => `${count} app(s)`,
    mode: (mode) => MODES.en[mode] ?? String(mode),
    keyNumber: (n) => `Key ${n}`,
  },
  fr: {
    ok: 'Dify répond.',
    apps: (count) => `${count} app(s)`,
    mode: (mode) => MODES.fr[mode] ?? String(mode),
    keyNumber: (n) => `Clé ${n}`,
  },
  de: {
    ok: 'Dify antwortet.',
    apps: (count) => `${count} App(s)`,
    mode: (mode) => MODES.de[mode] ?? String(mode),
    keyNumber: (n) => `Schlüssel ${n}`,
  },
  es: {
    ok: 'Dify responde.',
    apps: (count) => `${count} app(s)`,
    mode: (mode) => MODES.es[mode] ?? String(mode),
    keyNumber: (n) => `Clave ${n}`,
  },
};

// Errors of the scene actions (shown in red in Gladys).
export const ACTION_TEXT = {
  noMessage: {
    en: 'The message is empty.',
    fr: 'Le message est vide.',
    de: 'Die Nachricht ist leer.',
    es: 'El mensaje está vacío.',
  },
  badInputs: {
    en: 'Inputs not understood: one name=value per line (or separated by ;), or a JSON object.',
    fr: 'Entrées incomprises : un nom=valeur par ligne (ou séparés par ;), ou un objet JSON.',
    de: 'Eingaben nicht verstanden: ein name=wert pro Zeile (oder durch ; getrennt) oder ein JSON-Objekt.',
    es: 'Entradas no válidas: un nombre=valor por línea (o separados por ;), o un objeto JSON.',
  },
  missingInput: {
    en: 'Required input missing',
    fr: 'Entrée obligatoire manquante',
    de: 'Pflichteingabe fehlt',
    es: 'Falta una entrada obligatoria',
  },
  noApp: {
    en: 'No Dify app could be read yet: check the configuration.',
    fr: "Aucune app Dify n'a encore pu être lue : vérifiez la configuration.",
    de: 'Noch keine Dify-App konnte gelesen werden: Prüfe die Konfiguration.',
    es: 'Todavía no se ha podido leer ninguna app de Dify: compruebe la configuración.',
  },
  unknownApp: {
    en: 'No app of this name among the keys of the configuration.',
    fr: 'Aucune app de ce nom parmi les clés de la configuration.',
    de: 'Keine App mit diesem Namen unter den Schlüsseln der Konfiguration.',
    es: 'Ninguna app con este nombre entre las claves de la configuración.',
  },
  ambiguousApp: {
    en: 'Several apps have this name: rename one in Gladys or in Dify.',
    fr: 'Plusieurs apps portent ce nom : renommez-en une dans Gladys ou dans Dify.',
    de: 'Mehrere Apps tragen diesen Namen: Benenne eine in Gladys oder in Dify um.',
    es: 'Varias apps tienen este nombre: cambie el nombre de una en Gladys o en Dify.',
  },
  noFittingApp: {
    en: 'None of the configured apps can run this action: add the key of a workflow or of a chat app.',
    fr: "Aucune des apps configurées ne peut faire cette action : ajoutez la clé d'un workflow ou d'une app de chat.",
    de: 'Keine der konfigurierten Apps kann diese Aktion ausführen: Füge den Schlüssel eines Workflows oder einer Chat-App hinzu.',
    es: 'Ninguna de las apps configuradas puede realizar esta acción: añada la clave de un workflow o de una app de chat.',
  },
  whichApp: {
    en: 'Which app? Several can run this action: type its name in the action.',
    fr: "Quelle app ? Plusieurs peuvent faire cette action : saisissez son nom dans l'action.",
    de: 'Welche App? Mehrere können diese Aktion ausführen: Gib ihren Namen in der Aktion ein.',
    es: '¿Qué app? Varias pueden realizar esta acción: escriba su nombre en la acción.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A text of every language, built from a function of the language. */
export const everyLanguage = (render) =>
  Object.fromEntries(['en', 'fr', 'de', 'es'].map((language) => [language, render(language)]));
