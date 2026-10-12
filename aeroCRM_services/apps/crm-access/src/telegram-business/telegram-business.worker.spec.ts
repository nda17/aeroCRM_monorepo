import { TelegramBusinessWorker } from "./telegram-business.worker";
import { TelegramTransportError } from "./telegram-business.bot";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const commandId = "22222222-2222-4222-8222-222222222222";
const channelId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";
const dialogId = "55555555-5555-4555-8555-555555555555";

function deliveryHarness(error: TelegramTransportError) {
  let claimedToken = "";
  const row = {
    commandId,
    workspaceId,
    actorSubject: "employee-a",
    actorMembershipId: "member-a",
    messageId,
    channelId,
    channelGeneration: 2,
    dialogId,
    connectionId: "connection-7",
    providerChatId: "9001",
    state: "QUEUED",
    leaseToken: null,
    leaseUntil: null,
    attempts: 0,
    nextRunAt: new Date(),
  };
  const channel = {
    id: channelId,
    workspaceId,
    ownerUserId: "7001",
    generation: 2,
    status: "ACTIVE",
    canReply: true,
    connectionId: "connection-7",
  };
  const dialog = {
    id: dialogId,
    providerChatId: "9001",
    lastInboundAt: new Date(Date.now() - 60_000),
  };
  const message = { id: messageId, text: "synthetic reply" };
  const updateMany = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      if (typeof data.leaseToken === "string") claimedToken = data.leaseToken;
      return { count: 1 };
    },
  );
  const tx = {
    $queryRaw: jest.fn(),
    telegramChannel: {
      findUnique: jest.fn().mockResolvedValue(channel),
      updateMany: jest.fn(),
    },
    telegramDialog: {
      findUnique: jest.fn().mockResolvedValue(dialog),
    },
    telegramDelivery: { updateMany },
    telegramMessage: { update: jest.fn() },
    $executeRaw: jest.fn(),
  };
  const latest = () => ({
    ...row,
    state: "SENDING",
    leaseToken: claimedToken,
    attempts: 1,
  });
  const prisma = {
    $transaction: jest.fn(async (operation: (value: unknown) => unknown) =>
      operation(tx),
    ),
    telegramDelivery: {
      updateMany: jest.fn(
        async ({ data }: { data: Record<string, unknown> }) => {
          if (typeof data.leaseToken === "string")
            claimedToken = data.leaseToken;
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: jest.fn(async () => ({
        ...row,
        leaseToken: claimedToken,
        attempts: 1,
      })),
      findUnique: jest.fn(async () => latest()),
    },
    telegramChannel: { findUnique: jest.fn().mockResolvedValue(channel) },
    telegramDialog: { findUnique: jest.fn().mockResolvedValue(dialog) },
    telegramMessage: { findUnique: jest.fn().mockResolvedValue(message) },
  };
  const bot = {
    getConnection: jest.fn().mockResolvedValue({
      is_enabled: true,
      user: { id: 7001 },
      rights: { can_reply: true },
    }),
    sendMessage: jest.fn().mockRejectedValue(error),
  };
  const auth = {
    assignmentSubject: jest
      .fn()
      .mockResolvedValue({ membershipId: "member-a", state: "ACTIVE" }),
  };
  const worker = new TelegramBusinessWorker(
    prisma as never,
    auth as never,
    {} as never,
    bot as never,
    {} as never,
  );
  return { worker, prisma, tx, bot, row };
}

describe("Telegram Business delivery outcomes after dispatch admission", () => {
  it("marks ambiguous transport results UNKNOWN and never resends them automatically", async () => {
    const { worker, bot, tx, row } = deliveryHarness(
      new TelegramTransportError("AMBIGUOUS", 503, null),
    );
    await (
      worker as unknown as { deliver: (row: unknown) => Promise<void> }
    ).deliver({
      ...row,
    });
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(tx.telegramDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: "SENDING" }),
        data: expect.objectContaining({
          state: "UNKNOWN",
          lastErrorCode: "AMBIGUOUS_SEND",
        }),
      }),
    );
  });

  it("requeues a definite Telegram 429 only at the provider retry deadline", async () => {
    const { worker, bot, tx, row } = deliveryHarness(
      new TelegramTransportError("REJECTED", 429, 30),
    );
    await (
      worker as unknown as { deliver: (row: unknown) => Promise<void> }
    ).deliver({
      ...row,
    });
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(tx.telegramDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: "SENDING" }),
        data: expect.objectContaining({
          state: "QUEUED",
          leaseToken: null,
          dispatchAdmittedAt: null,
          lastErrorCode: "RATE_LIMITED",
          nextRunAt: expect.any(Date),
        }),
      }),
    );
    expect(tx.telegramMessage.update).toHaveBeenCalledWith({
      where: { id: messageId },
      data: { deliveryStatus: "QUEUED" },
    });
  });
});

function updateWorkerHarness(createMessage = jest.fn()) {
  const channel = {
    id: channelId,
    workspaceId,
    ownerUserId: "7001",
    ownerName: "Synthetic account",
    generation: 2,
    status: "ACTIVE",
    canReply: true,
    connectionId: "connection-7",
    connectedAt: new Date(Date.now() - 60_000),
    lastInboundAt: null,
  };
  const dialog = {
    id: dialogId,
    workspaceId,
    channelId,
    providerChatId: "9001",
    peerName: "Synthetic customer",
    lastInboundAt: null,
  };
  let stored: Record<string, unknown> | null = null;
  const tx = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    telegramChannel: {
      findUnique: jest.fn().mockResolvedValue(channel),
      update: jest.fn(),
    },
    telegramMessage: {
      findUnique: jest.fn(async () => stored),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const result = { id: messageId, ...data };
        await createMessage(result);
        stored = result;
        return result;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        stored = { ...stored, ...data };
        return stored;
      }),
      findMany: jest.fn(async () =>
        stored ? [{ providerMessageId: stored.providerMessageId }] : [],
      ),
      updateMany: jest.fn(
        async ({ data }: { data: Record<string, unknown> }) => {
          if (stored) stored = { ...stored, ...data };
          return { count: stored ? 1 : 0 };
        },
      ),
    },
    telegramDialog: {
      upsert: jest.fn().mockResolvedValue(dialog),
      update: jest.fn().mockResolvedValue(dialog),
    },
    workspaceMessengerStream: {
      upsert: jest.fn().mockResolvedValue({ lastSequence: 1 }),
    },
    workspaceMessengerEntry: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn(async (operation: (value: unknown) => unknown) =>
      operation(tx),
    ),
    telegramChannel: { findUnique: jest.fn().mockResolvedValue(channel) },
    telegramMessage: tx.telegramMessage,
  };
  const worker = new TelegramBusinessWorker(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { worker, prisma, tx, getStored: () => stored };
}

const customerBusinessMessage = (fields: Record<string, unknown> = {}) => ({
  business_connection_id: "connection-7",
  message_id: 88,
  date: Math.floor(Date.now() / 1000) - 30,
  chat: { id: 9001, type: "private", first_name: "Customer" },
  from: { id: 9002, first_name: "Customer" },
  text: "Incoming question",
  ...fields,
});

describe("Telegram Business update ordering", () => {
  it("keeps a delete pending until a previously failed original message can be retried", async () => {
    let failFirstCreate = true;
    const harness = updateWorkerHarness(
      jest.fn(async () => {
        if (failFirstCreate) {
          failFirstCreate = false;
          throw new Error("transient database failure");
        }
      }),
    );
    const businessMessage = (
      harness.worker as unknown as {
        businessMessage: (value: unknown, edited: boolean) => Promise<void>;
      }
    ).businessMessage.bind(harness.worker);
    const deletedMessages = (
      harness.worker as unknown as {
        deletedMessages: (value: unknown) => Promise<void>;
      }
    ).deletedMessages.bind(harness.worker);
    const original = customerBusinessMessage();
    await expect(businessMessage(original, false)).rejects.toThrow(
      "transient database failure",
    );
    const deletion = {
      business_connection_id: "connection-7",
      chat: { id: 9001 },
      message_ids: [88],
    };
    await expect(deletedMessages(deletion)).rejects.toThrow();
    await businessMessage(original, false);
    await deletedMessages(deletion);
    expect(harness.tx.telegramMessage.create).toHaveBeenCalledTimes(2);
    expect(harness.tx.telegramMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ providerMessageId: { in: ["88"] } }),
        data: expect.objectContaining({
          text: "[Сообщение удалено]",
          deletedAt: expect.any(Date),
        }),
      }),
    );
    expect(harness.getStored()).toMatchObject({ text: "[Сообщение удалено]" });
  });

  it("applies a newer Telegram edit to a known CRM outbound row without creating a second feed entry", async () => {
    const existing = {
      id: messageId,
      workspaceId,
      channelId,
      dialogId,
      providerChatId: "9001",
      providerMessageId: "88",
      direction: "OUTBOUND",
      origin: "CRM",
      contentKind: "TEXT",
      text: "Original CRM answer",
      editedAt: new Date(Date.now() - 60_000),
      deletedAt: null,
    };
    const harness = updateWorkerHarness();
    // Seed the persisted CRM outbound mirror that Telegram later edits.
    await harness.tx.telegramMessage.create({ data: existing });
    const businessMessage = (
      harness.worker as unknown as {
        businessMessage: (value: unknown, edited: boolean) => Promise<void>;
      }
    ).businessMessage.bind(harness.worker);
    await businessMessage(
      customerBusinessMessage({
        message_id: 88,
        edit_date: Math.floor(Date.now() / 1000),
        text: "Edited CRM answer",
        sender_business_bot: { id: 77, name: "aeroCRM" },
      }),
      true,
    );
    expect(harness.tx.telegramMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: messageId },
        data: expect.objectContaining({
          text: "Edited CRM answer",
          editedAt: expect.any(Date),
        }),
      }),
    );
    expect(harness.tx.telegramMessage.create).toHaveBeenCalledTimes(1);
    expect(harness.tx.workspaceMessengerEntry.create).not.toHaveBeenCalled();
  });
});

describe("Telegram delivery tenant isolation", () => {
  it("filters a closed tenant before the queue limit and still advances an active tenant", async () => {
    const active = {
      commandId: "active-delivery-command",
      workspaceId: "active-workspace",
      state: "QUEUED",
    };
    const queryTexts: string[] = [];
    const prisma = {
      $queryRaw: jest.fn(async (parts: TemplateStringsArray, state: string) => {
        const query = Array.from(parts).join("?");
        queryTexts.push(query);
        return state === "QUEUED" ? [{ commandId: active.commandId }] : [];
      }),
      telegramDelivery: {
        findMany: jest.fn().mockResolvedValue([active]),
      },
    };
    const worker = new TelegramBusinessWorker(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const deliver = jest.fn().mockResolvedValue(undefined);
    (worker as unknown as { deliver: typeof deliver }).deliver = deliver;
    await (
      worker as unknown as { processDeliveries: () => Promise<void> }
    ).processDeliveries();
    expect(queryTexts).toHaveLength(2);
    expect(
      queryTexts.every((query) => query.includes("workspace_closure_fences")),
    ).toBe(true);
    expect(
      queryTexts.every(
        (query) =>
          query.indexOf("workspace_closure_fences") < query.indexOf("LIMIT 20"),
      ),
    ).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(active);
  });

  it("does not reload an SENDING SQL candidate after its lease has already reached a terminal state", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ commandId: "settled-command" }]),
      telegramDelivery: { findMany },
    };
    const worker = new TelegramBusinessWorker(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const rows = await (
      worker as unknown as {
        deliveryCandidates: (state: "SENDING" | "QUEUED") => Promise<unknown[]>;
      }
    ).deliveryCandidates("SENDING");
    expect(rows).toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: "SENDING",
          leaseUntil: { lt: expect.any(Date) },
        }),
      }),
    );
  });
});

describe("Telegram connection reconciliation", () => {
  it("fails closed on a low update id after a quiet week when Telegram reports the previous connection revoked", async () => {
    const channel = {
      id: channelId,
      workspaceId,
      ownerUserId: "7001",
      status: "ACTIVE",
      canReply: true,
    };
    const tx = {
      $executeRaw: jest.fn(),
      telegramConnection: {
        findUnique: jest.fn().mockResolvedValue({
          connectionId: "connection-7",
          telegramUserId: "7001",
          enabled: true,
          canReply: true,
          lastUpdateId: 900n,
        }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      telegramConnectSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      telegramChannel: {
        findMany: jest.fn().mockResolvedValue([channel]),
        update: jest.fn().mockResolvedValue({}),
      },
      telegramDelivery: {
        findMany: jest.fn().mockResolvedValue([{ messageId }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      telegramMessage: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (operation: (value: unknown) => unknown) =>
        operation(tx),
      ),
    };
    const bot = {
      getConnection: jest
        .fn()
        .mockRejectedValue(new TelegramTransportError("REJECTED", 403, null)),
    };
    const worker = new TelegramBusinessWorker(
      prisma as never,
      {} as never,
      {} as never,
      bot as never,
      {} as never,
    );
    await (
      worker as unknown as {
        connectionUpdate: (value: unknown, updateId: bigint) => Promise<void>;
      }
    ).connectionUpdate(
      {
        id: "connection-7",
        user: { id: 7001 },
        is_enabled: true,
        can_reply: true,
      },
      10n,
    );
    expect(bot.getConnection).toHaveBeenCalledWith("connection-7");
    expect(tx.telegramConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          enabled: false,
          canReply: false,
          lastUpdateId: 10n,
        }),
      }),
    );
    expect(tx.telegramChannel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: channelId },
        data: expect.objectContaining({ status: "REVOKED", canReply: false }),
      }),
    );
    expect(tx.telegramDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId, state: "QUEUED" },
        data: expect.objectContaining({
          state: "CANCELLED",
          lastErrorCode: "CONNECTION_REVOKED",
        }),
      }),
    );
    expect(tx.telegramMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: "CANCELLED" }),
      }),
    );
  });
});
