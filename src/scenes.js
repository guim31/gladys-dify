// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Run a Dify workflow" runs a workflow app with its inputs (scene variables
// included, the core resolves them before the call); "Send a message to
// Dify" talks to a chatflow, a chat app, an agent or a text generator, in a
// conversation kept by name. Both hand the answer to the next actions as
// outputs (`{{<column>.<row>.response}}`): the scene then sends it by
// message, reads it aloud or tests it, with the core's own actions.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async run_workflow(hub, { fields = {} }) {
    return hub.run({
      kind: 'workflow',
      app: fields.app,
      inputs: fields.inputs,
      maxCharacters: fields.max_characters,
    });
  },
  async send_message(hub, { fields = {} }) {
    return hub.run({
      kind: 'message',
      app: fields.app,
      message: fields.message,
      inputs: fields.inputs,
      conversation: fields.conversation,
      maxCharacters: fields.max_characters,
    });
  },
};
