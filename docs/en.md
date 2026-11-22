# Dify

[Dify](https://dify.ai) builds LLM apps visually: workflows, chatflows, chat apps, agents and
text generators, with models, knowledge bases and tools. This integration lets your Gladys
scenes run a Dify workflow with inputs taken from the scene, or send a message to a Dify chat
app or agent, and use the answer in the next actions: send it as a message, read it aloud,
test it in a condition.

Each Dify app becomes a Gladys device (online or not, last run, its duration and tokens, last
answer), with a dashboard widget and three scene triggers.

How it differs from its neighbours: **n8n** and **Activepieces** start automation flows that
you build in those tools; **Local AI** replaces the Gladys AI assistant with a model at home;
**Flowise** asks Flowise flows. This one runs the apps you built in Dify (self-hosted or Dify
Cloud).

## Requirements

- Gladys 5.1 or later.
- A Dify server on your network (the official Docker Compose setup listens on port 80), or a
  Dify Cloud account: the address is then `https://api.dify.ai`.
- The API key of each app to use: open the app in Dify, then **API Access**, **API Key**,
  **Create new secret key** (`app-…`). The app must be **published**.

## Setup

1. In Gladys, open **Integrations**, search for **Dify** and install it.
2. In **Configuration**, fill in:
   - **Address**: the address of Dify, the one of its web interface, e.g. `192.168.1.20`,
     `http://192.168.1.20:8080`, the URL of a reverse proxy, or `https://api.dify.ai`;
   - **API keys of the apps**: one key per app, separated by spaces or commas (10 at most);
   - **Longest wait for an answer**: 30 to 110 seconds (60 by default);
   - **Refresh interval**: how often the apps are checked (one minute by default);
   - **Language of the feature names**: the names given to the features and the texts of the
     scene events and errors.
3. Save, then press **Test the connection**: it lists your apps and their kind (workflow,
   chatflow, chat, agent, text generator).
4. In the **Discover** tab, add the devices of your apps to Gladys.

Dify gives an app no id through its API: the device of an app is tied to its key. Renaming the
app keeps its device; a new key makes a new device.

## The devices

| Feature              | Meaning                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `Online`             | 1 when the app answers with its key, 0 when Dify is down or refuses |
| `Last run succeeded` | 1 when the last run from a scene succeeded, 0 when it failed        |
| `Last run duration`  | in seconds, as Dify measured it                                     |
| `Last run tokens`    | tokens the last run used (0 without a model)                        |
| `Last answer`        | beginning of the last answer (500 characters)                       |

## Dashboard

The **Dify** widget shows Dify (online or not), then one row per app under the name given in
Gladys, with the result and time of its last run, and the beginning of the latest answer. The
**Show the last answer** setting hides that text.

## Scenes

### Triggers

- **A Dify run failed**: a run started by a scene failed (a node in error, a timeout, refused
  inputs, Dify unreachable). Variables: the app and the reason.
- **Dify is offline**: Dify stops answering (two failed readings in a row, 15 seconds apart).
  Variable: the reason.
- **Dify is back online**: Dify answers again. Variable: the length of the outage, in minutes.

### Actions

- **Run a Dify workflow**: runs a workflow app.
  - **App**: its name in Gladys or in Dify; empty when only one configured app is a workflow;
  - **Inputs**: the input variables of the workflow, one `name=value` per line or separated by
    `;` (e.g. `room=kitchen; temperature=21`), or a JSON object; type `{{` to insert scene
    information. A number field accepts a decimal comma;
  - **Longest answer**: in characters (1000 by default, 10 000 at most).

  Its results: **Answer** (the only text output of the workflow, or its `answer`, `text`,
  `result` or `output` output, else all outputs as JSON), **All outputs (JSON)**, **App used**,
  **Run time** (seconds), **Tokens used** and **Answer cut** (yes/no).

- **Send a message to Dify**: sends a message to a chatflow, a chat app, an agent or a text
  generator.
  - **Message**: type `{{` to insert scene information;
  - **App**: as above;
  - **Conversation**: the same name from one run to the next (e.g. `kitchen`) continues the
    conversation, even after a restart; empty, every run is a new conversation;
  - **Inputs**: the input variables of the app, as above;
  - **Longest answer**: as above.

  Its results: **Answer**, **App used**, **Conversation id**, **Run time**, **Tokens used** and
  **Answer cut**.

In a **Send a message** action of Gladys, type `{{` and pick **Answer**. A longer answer is cut
at the end of a sentence (or a word), marked by `…`. A failure (Dify unreachable, key refused,
missing input, run in error, timeout) shows in red with its reason.

### Scene ideas

- **Morning briefing**: at 7 am, **Send a message to Dify** "Sum up the day: outdoor
  temperature `{{…}}`." to an agent, then send the **Answer** to your phone.
- **Report a sensor**: when the humidity of the bathroom rises, **Run a Dify workflow** with
  `room=bathroom; humidity={{…}}` and read the advice aloud.
- **Watch your apps**: on **A Dify run failed**, send yourself a message with the app and the
  reason.

## Troubleshooting

- **"Dify does not answer"**: check the address and the port, and that Dify is started.
- **"API key refused"**: the app was deleted, or the key revoked: create a new key.
- **"Required input missing"**: the workflow asks for this input; add it in **Inputs**.
- **"The app is not ready"**: publish the app in Dify.
- **"The run failed in Dify"**: a node failed (model unreachable, quota, code error); open the
  app and its **Logs** in Dify.
- **"Dify took too long to answer"**: raise the longest wait, or simplify the app.
- Problems and ideas: [GitHub issues](https://github.com/guim31/gladys-dify/issues).

## Limits

- Text only: no image nor file in the inputs.
- Gladys waits two minutes at most for an action; the integration then asks Dify to stop the
  run. The answer is capped at 10 000 characters.
- Every run is made for the Dify user `gladys`: the conversations are shared by your scenes.
- The quotas and prices are the ones of your model providers (and of your Dify Cloud plan).
  Checking an app costs no token.
- Inputs and answers never go to the logs of the integration; the keys never leave the
  configuration.
- Tested against a real Dify 1.20.0 (a workflow and a chatflow without model), without a real
  Gladys instance: feedback welcome.
- Not affiliated with LangGenius or Dify.
