// -----------------------------------------------------------------------------
// The conversations a scene keeps by name ("kitchen", "morning"…): Dify
// creates the conversation id on the first message, the integration remembers
// it per app in /data/conversations.json, so the conversation survives a
// restart of the container. Ids only: never a message.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'dify-conversations' });

// A scene that invents names (a date, a trigger value) must not grow the file forever.
export const MAX_CONVERSATIONS = 200;

export class ConversationStore {
  /** @param {string|null} [dataDir] null: kept in memory only (tests) */
  constructor(dataDir = process.env.DATA_DIR ?? '/data') {
    this.dataDir = dataDir;
    /** @type {Map<string, string>} `${appId}\n${name}` -> conversation id */
    this.ids = new Map();
  }

  get file() {
    return this.dataDir ? join(this.dataDir, 'conversations.json') : null;
  }

  async load() {
    if (!this.file) {
      return;
    }
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      for (const [key, id] of Object.entries(data ?? {})) {
        if (typeof id === 'string') {
          this.ids.set(key, id);
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Conversations not read, starting afresh: ${err.message}`);
      }
    }
  }

  static key(appId, name) {
    return `${appId}\n${name.toLocaleLowerCase()}`;
  }

  get(appId, name) {
    return this.ids.get(ConversationStore.key(appId, name));
  }

  async set(appId, name, id) {
    const key = ConversationStore.key(appId, name);
    if (this.ids.get(key) === id) {
      return;
    }
    this.ids.delete(key);
    this.ids.set(key, id);
    while (this.ids.size > MAX_CONVERSATIONS) {
      this.ids.delete(this.ids.keys().next().value);
    }
    await this.save();
  }

  async delete(appId, name) {
    if (this.ids.delete(ConversationStore.key(appId, name))) {
      await this.save();
    }
  }

  async save() {
    if (!this.file) {
      return;
    }
    try {
      await mkdir(this.dataDir, { recursive: true });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, JSON.stringify(Object.fromEntries(this.ids)));
      await rename(temporary, this.file);
    } catch (err) {
      // Only the memory of the conversations is lost: the runs go on.
      logger.warn(`Conversations not saved: ${err.message}`);
    }
  }
}
