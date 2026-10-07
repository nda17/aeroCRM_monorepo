export class ChatAttachmentsFakeStorage {
  available = true;
  objects = new Map();
  objectDates = new Map();
  calls = { put: 0, get: 0, remove: 0, candidates: 0 };
  beforePut;
  afterPut;
  beforeDelete;

  constructor(clock = () => new Date()) {
    this.clock = clock;
  }

  key(workspaceId, conversationId, id) {
    const key = `messenger/${workspaceId.toLowerCase()}/${conversationId.toLowerCase()}/${id.toLowerCase()}`;
    this.assertKey(key, workspaceId, conversationId);
    return key;
  }

  assertKey(key, workspaceId, conversationId) {
    const match = /^messenger\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(key);
    if (!match || match[1] !== workspaceId.toLowerCase() || match[2] !== conversationId.toLowerCase())
      throw new Error("CHAT_OBJECT_SCOPE");
  }

  assertKeyFromKey(key) {
    const parts = key.split("/");
    this.assertKey(key, parts[1] || "", parts[2] || "");
  }

  async put(key, bytes) {
    this.assertKeyFromKey(key);
    this.calls.put++;
    if (this.beforePut) await this.beforePut(key, bytes);
    this.objects.set(key, Buffer.from(bytes));
    this.objectDates.set(key, new Date(this.clock()));
    if (this.afterPut) await this.afterPut(key, Buffer.from(bytes));
  }

  async get(key, maxBytes) {
    this.assertKeyFromKey(key);
    this.calls.get++;
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error("FAKE_OBJECT_NOT_FOUND");
    if (bytes.length > maxBytes) throw new Error("CHAT_OBJECT_TOO_LARGE");
    return Buffer.from(bytes);
  }

  async remove(key) {
    this.assertKeyFromKey(key);
    this.calls.remove++;
    if (this.beforeDelete) await this.beforeDelete(key);
    this.objects.delete(key);
    this.objectDates.delete(key);
  }

  async candidates(cursor) {
    this.calls.candidates++;
    const keys = [...this.objects.keys()].filter(key => /^messenger\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key)).sort();
    const after = cursor ? keys.findIndex((key) => key > cursor) : 0;
    const start = after < 0 ? keys.length : after;
    const page = keys.slice(start, start + 100);
    const nextCursor =
      start + page.length < keys.length ? page.at(-1) : undefined;
    return {
      items: page.map((key) => ({
        key,
        createdAt: new Date(this.objectDates.get(key) ?? this.clock()),
      })),
      nextCursor,
    };
  }
}
