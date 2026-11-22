# Dify

[Dify](https://dify.ai) construit des applications LLM visuellement : workflows, chatflows, apps
de chat, agents et générateurs de texte, avec des modèles, des bases de connaissances et des
outils. Cette intégration permet à vos scènes Gladys de lancer un workflow Dify avec des entrées
tirées de la scène, ou d'envoyer un message à une app de chat ou à un agent Dify, et d'utiliser
la réponse dans les actions suivantes : l'envoyer en message, la lire à voix haute, la tester
dans une condition.

Chaque app Dify devient un appareil Gladys (en ligne ou non, dernière exécution, sa durée et ses
tokens, dernière réponse), avec un widget de tableau de bord et trois déclencheurs de scène.

Ce qui la distingue de ses voisines : **n8n** et **Activepieces** lancent des flux
d'automatisation construits dans ces outils ; **Local AI** remplace l'assistant IA de Gladys par
un modèle à la maison ; **Flowise** interroge des flux Flowise. Celle-ci lance les apps que vous
avez construites dans Dify (auto-hébergé ou Dify Cloud).

## Ce qu'il faut

- Gladys 5.1 ou plus récent.
- Un serveur Dify sur votre réseau (l'installation Docker Compose officielle écoute sur le port
  80), ou un compte Dify Cloud : l'adresse est alors `https://api.dify.ai`.
- La clé d'API de chaque app à utiliser : ouvrez l'app dans Dify, puis **Accès API**, **Clé
  API**, **Créer une nouvelle clé secrète** (`app-…`). L'app doit être **publiée**.

## Mise en place

1. Dans Gladys, ouvrez **Intégrations**, cherchez **Dify** et installez-la.
2. Dans **Configuration**, renseignez :
   - **Adresse** : l'adresse de Dify, celle de son interface web, ex. `192.168.1.20`,
     `http://192.168.1.20:8080`, l'URL d'un proxy inverse, ou `https://api.dify.ai` ;
   - **Clés d'API des apps** : une clé par app, séparées par des espaces ou des virgules (10 au
     plus) ;
   - **Attente maximale d'une réponse** : de 30 à 110 secondes (60 par défaut) ;
   - **Intervalle de rafraîchissement** : fréquence de vérification des apps (une minute par
     défaut) ;
   - **Langue des noms de fonctionnalités** : les noms donnés aux fonctionnalités et les textes
     des événements de scène et des erreurs.
3. Enregistrez, puis appuyez sur **Tester la connexion** : elle liste vos apps et leur type
   (workflow, chatflow, chat, agent, générateur de texte).
4. Dans l'onglet **Découverte**, ajoutez les appareils de vos apps à Gladys.

Dify ne donne aucun identifiant d'app par son API : l'appareil d'une app est lié à sa clé.
Renommer l'app garde son appareil ; une nouvelle clé crée un nouvel appareil.

## Les appareils

| Fonctionnalité                    | Signification                                                          |
| --------------------------------- | ---------------------------------------------------------------------- |
| `En ligne`                        | 1 quand l'app répond avec sa clé, 0 quand Dify est arrêté ou la refuse |
| `Dernière exécution réussie`      | 1 quand la dernière exécution d'une scène a réussi, 0 en cas d'échec   |
| `Durée de la dernière exécution`  | en secondes, mesurée par Dify                                          |
| `Tokens de la dernière exécution` | tokens utilisés par la dernière exécution (0 sans modèle)              |
| `Dernière réponse`                | début de la dernière réponse (500 caractères)                          |

## Tableau de bord

Le widget **Dify** affiche Dify (en ligne ou non), puis une ligne par app sous le nom donné dans
Gladys, avec le résultat et l'heure de sa dernière exécution, et le début de la dernière
réponse. Le réglage **Afficher la dernière réponse** masque ce texte.

## Scènes

### Déclencheurs

- **Une exécution Dify a échoué** : une exécution lancée par une scène a échoué (un nœud en
  erreur, un délai dépassé, des entrées refusées, Dify injoignable). Variables : l'app et la
  raison.
- **Dify est hors ligne** : Dify ne répond plus (deux lectures en échec de suite, à 15 secondes
  d'écart). Variable : la raison.
- **Dify est de retour** : Dify répond de nouveau. Variable : la durée de la panne, en minutes.

### Actions

- **Lancer un workflow Dify** : lance une app de type workflow.
  - **App** : son nom dans Gladys ou dans Dify ; vide quand une seule app configurée est un
    workflow ;
  - **Entrées** : les variables d'entrée du workflow, un `nom=valeur` par ligne ou séparés par
    `;` (ex. `piece=cuisine; temperature=21`), ou un objet JSON ; tapez `{{` pour insérer des
    informations de la scène. Un champ numérique accepte la virgule décimale ;
  - **Réponse la plus longue** : en caractères (1000 par défaut, 10 000 au plus).

  Ses résultats : **Réponse** (la seule sortie texte du workflow, ou sa sortie `answer`, `text`,
  `result` ou `output`, sinon toutes les sorties en JSON), **Toutes les sorties (JSON)**, **App
  utilisée**, **Durée d'exécution** (secondes), **Tokens utilisés** et **Réponse coupée**
  (oui/non).

- **Envoyer un message à Dify** : envoie un message à un chatflow, une app de chat, un agent ou
  un générateur de texte.
  - **Message** : tapez `{{` pour insérer des informations de la scène ;
  - **App** : comme ci-dessus ;
  - **Conversation** : le même nom d'une exécution à l'autre (ex. `cuisine`) poursuit la
    conversation, même après un redémarrage ; vide, chaque exécution est une nouvelle
    conversation ;
  - **Entrées** : les variables d'entrée de l'app, comme ci-dessus ;
  - **Réponse la plus longue** : comme ci-dessus.

  Ses résultats : **Réponse**, **App utilisée**, **Identifiant de conversation**, **Durée
  d'exécution**, **Tokens utilisés** et **Réponse coupée**.

Dans une action **Envoyer un message** de Gladys, tapez `{{` et choisissez **Réponse**. Une
réponse plus longue est coupée à la fin d'une phrase (ou d'un mot), marquée par `…`. Un échec
(Dify injoignable, clé refusée, entrée manquante, exécution en erreur, délai dépassé) s'affiche
en rouge avec sa raison.

### Idées de scènes

- **Point du matin** : à 7 h, **Envoyer un message à Dify** « Résume la journée : température
  extérieure `{{…}}`. » à un agent, puis envoyez la **Réponse** sur votre téléphone.
- **Signaler un capteur** : quand l'humidité de la salle de bain monte, **Lancer un workflow
  Dify** avec `piece=salle de bain; humidite={{…}}` et faites lire le conseil à voix haute.
- **Surveiller vos apps** : sur **Une exécution Dify a échoué**, envoyez-vous un message avec
  l'app et la raison.

## Dépannage

- **« Dify ne répond pas »** : vérifiez l'adresse et le port, et que Dify est démarré.
- **« clé d'API refusée »** : l'app a été supprimée, ou la clé révoquée : créez une nouvelle
  clé.
- **« Entrée obligatoire manquante »** : le workflow demande cette entrée ; ajoutez-la dans
  **Entrées**.
- **« l'app n'est pas prête »** : publiez l'app dans Dify.
- **« l'exécution a échoué dans Dify »** : un nœud a échoué (modèle injoignable, quota, erreur
  de code) ; ouvrez l'app et ses **Journaux** dans Dify.
- **« Dify a mis trop de temps à répondre »** : augmentez l'attente maximale, ou simplifiez
  l'app.
- Problèmes et idées : [issues GitHub](https://github.com/guim31/gladys-dify/issues).

## Limites

- Texte seulement : ni image ni fichier dans les entrées.
- Gladys attend deux minutes au plus une action ; l'intégration demande alors à Dify d'arrêter
  l'exécution. La réponse est plafonnée à 10 000 caractères.
- Chaque exécution est faite pour l'utilisateur Dify `gladys` : vos scènes partagent les
  conversations.
- Les quotas et les prix sont ceux de vos fournisseurs de modèles (et de votre offre Dify
  Cloud). Vérifier une app ne coûte aucun token.
- Les entrées et les réponses ne vont jamais dans les logs de l'intégration ; les clés ne
  quittent pas la configuration.
- Testée contre un vrai Dify 1.20.0 (un workflow et un chatflow sans modèle), sans instance
  Gladys réelle : retours bienvenus.
- Non affiliée à LangGenius ni à Dify.
