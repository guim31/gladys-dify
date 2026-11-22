# Dify for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
brings [Dify](https://dify.ai), the platform to build LLM apps, to Gladys
scenes: run a Dify workflow with inputs taken from the scene, or send a message
to a chatflow, a chat app, an agent or a text generator, and hand the answer to
the next actions (a message, a speaker, a condition). It also follows each app.

Works with a self-hosted Dify and with Dify Cloud (`https://api.dify.ai`): both
speak the same Service API.

## Features

- **Scene action _Run a Dify workflow_**: an app (by its name in Gladys or in
  Dify; empty when only one workflow is configured), inputs (`name=value` pairs
  or a JSON object, with scene variables; number fields typed from the form of
  the app) and a longest answer. Outputs: **Answer**, **All outputs (JSON)**,
  **App used**, **Run time**, **Tokens used**, **Answer cut**.
- **Scene action _Send a message to Dify_**: a message, an app, an optional
  **conversation** name that continues the Dify conversation from one run to
  the next (kept in `/data`, so it survives a restart), inputs and a longest
  answer. Outputs: **Answer**, **App used**, **Conversation id**, **Run time**,
  **Tokens used**, **Answer cut**.
- Every failure (Dify unreachable, key refused, required input missing, node in
  error, timeout) is shown in red with its reason, in four languages; a run that
  outlives the wait is stopped in Dify.
- **One device per app** (one API key each): online, last run succeeded, its
  duration and tokens, last answer.
- **Scene triggers**: _A Dify run failed_ (app and reason), _Dify is offline_
  (two failed readings in a row) and _Dify is back online_ (length of the
  outage).
- **Dashboard widget** "Dify": the server, one row per app with the result and
  time of its last run, the latest answer (a setting hides it).
- A **Test the connection** button that lists the apps and their kind.
- English, French, German and Spanish everywhere.

How it differs from its neighbours:
[gladys-n8n](https://github.com/guim31/gladys-n8n) and
[gladys-activepieces](https://github.com/guim31/gladys-activepieces) start
automation flows built in those tools;
[gladys-local-ai](https://github.com/guim31/gladys-local-ai) runs the Gladys AI
assistant on a model at home; [gladys-flowise](https://github.com/guim31/gladys-flowise)
asks Flowise flows. This one runs the apps built in Dify.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions,
  action outputs).
- A **Dify** server reachable from Gladys (the official Docker Compose setup
  listens on port 80), or a Dify Cloud account.
- The **API key** of each app to use (the app → API Access → API Key). The app
  must be published.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-dify` (or
   install **Dify** from the catalog once it is listed).
2. In **Configuration**, enter the address of Dify and the API keys of your
   apps (separated by spaces or commas), then press **Test the connection**.
3. In the **Discovery** tab, add the devices of your apps.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- Every refresh interval (30 s to 5 min, 1 min by default), each app is read
  with `GET /v1/info` (its name and mode, no token spent). The devices are
  published with `should_poll: false`: the container reads the apps on its own
  timer. Only the values that changed are sent, all of them again when a device
  is added, and every 12 hours.
- Dify gives an app no id through the Service API: the device id is a short
  SHA-256 of the key (never the key itself). A renamed app keeps its device; a
  new key makes a new one.
- A run reads `GET /v1/parameters` (to check the required inputs and type the
  numbers), then calls `POST /v1/workflows/run`, `/v1/chat-messages` or
  `/v1/completion-messages` in **streaming** mode, for the user `gladys`: Dify
  refuses blocking mode for agents, and a stream is not cut by a proxy at
  100 s. The events are folded into one answer. The wait is configurable (30 to
  110 s; Gladys grants the action 120 s); past it, the run is stopped with
  `POST …/stop`.
- Dify is "offline" after two failed readings in a row of every app (the second
  15 s after the first), counting only silence (refused connection, timeout);
  a refused key is shown on its device and in the connection status.
- `/data/conversations.json` keeps the Dify conversation id of each named
  conversation (ids only, 200 at most). Inputs, messages and answers never
  reach the logs; the keys neither. No console API is used.

## Checked on a real Dify

On 22/11/2026 the integration was checked against a real Dify 1.20.0
(`langgenius/dify-api` with PostgreSQL and Redis, in Docker) with three apps
without model: a workflow (Start → End), a workflow whose Code node fails, and
a chatflow (Start → Answer). Its answers are the fixtures of the tests
(`test/fixtures/dify/`): a run, a failed run, a missing input, a conversation
continued, an unknown conversation (404), a wrong key (401), a wrong route
(400). The Docker image of the integration was run with the Gladys sandbox
constraints (read-only root, all capabilities dropped, 256 MB, bridge network)
against that server and the fake Gladys of the SDK. Not checked: the widget and
the scene editor in a real Gladys, an app calling a real language model, an
agent app, a text generator, Dify Cloud. Feedback welcome.

## Limitations

- One Dify server per Gladys, 10 apps at most. Text only: no image or file in
  the inputs.
- Every run is made for the Dify user `gladys`: the scenes share the
  conversations.
- Gladys waits two minutes at most for a scene action, and caps an output at
  10,000 characters.
- The quotas and prices are those of your model providers and of your Dify
  Cloud plan; the integration only reads `GET /v1/info` between runs.
- Names ending in `.local` do not resolve inside the integration container:
  use IP addresses or names your DNS resolves.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and a fake Dify (`test/helpers/fakeDify.js`) built on answers recorded from a
real server. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Dify](https://github.com/langgenius/dify) (Dify Open Source License, based on
  Apache-2.0): the Service API, and the logo on the cover
  (`web/public/logo/logo.svg` of the Dify repository, in white).
- The architecture follows [gladys-flowise](https://github.com/guim31/gladys-flowise),
  and the conformity tests [gladys-wled](https://github.com/guim31/gladys-wled).
- Home Assistant has no Dify integration in its core; no code was copied from
  any project.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by LangGenius, Inc.
"Dify" and the Dify logo belong to their owners.

## License

Apache-2.0
