import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/crm-access-client";
import { TelegramBusinessWebhook } from "./telegram-business.webhook";

const update = { update_id: 91, message: { message_id: 4, text: "synthetic" } };
const rawBody = Buffer.from(JSON.stringify(update));
const secret = "synthetic-webhook-secret";

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
    clientVersion: "5.22.0",
  });
}

describe("Telegram Business webhook admission", () => {
  it("persists the authenticated update before returning success", async () => {
    const order: string[] = [];
    const prisma = {
      telegramWebhookInbox: {
        create: jest.fn(async () => {
          order.push("persist");
          return {};
        }),
      },
    };
    const bot = { enabled: true, secret, botKey: () => "synthetic-bot-key" };
    const webhook = new TelegramBusinessWebhook(prisma as never, bot as never);
    const result = await webhook.admit(
      rawBody,
      ["x-telegram-bot-api-secret-token", secret],
      update,
    );
    order.push("respond");
    expect(result).toEqual({ ok: true });
    expect(order).toEqual(["persist", "respond"]);
    expect(prisma.telegramWebhookInbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        botKey: "synthetic-bot-key",
        updateId: 91n,
        rawBody: rawBody.toString(),
        payload: update,
      }),
    });
  });

  it("deduplicates the same update hash and rejects a conflicting payload for that update id", async () => {
    const hash = await import("node:crypto").then(({ createHash }) =>
      createHash("sha256").update(rawBody).digest("hex"),
    );
    const create = jest.fn().mockRejectedValue(uniqueViolation());
    const findUnique = jest.fn().mockResolvedValue({ payloadHash: hash });
    const webhook = new TelegramBusinessWebhook(
      { telegramWebhookInbox: { create, findUnique } } as never,
      { enabled: true, secret, botKey: () => "synthetic-bot-key" } as never,
    );
    expect(
      await webhook.admit(
        rawBody,
        ["x-telegram-bot-api-secret-token", secret],
        update,
      ),
    ).toEqual({ ok: true });
    findUnique.mockResolvedValue({ payloadHash: "different-payload-hash" });
    await expect(
      webhook.admit(
        rawBody,
        ["x-telegram-bot-api-secret-token", secret],
        update,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects duplicate credential headers before touching durable storage", async () => {
    const create = jest.fn();
    const webhook = new TelegramBusinessWebhook(
      { telegramWebhookInbox: { create } } as never,
      { enabled: true, secret, botKey: () => "synthetic-bot-key" } as never,
    );
    await expect(
      webhook.admit(
        rawBody,
        [
          "x-telegram-bot-api-secret-token",
          secret,
          "X-Telegram-Bot-Api-Secret-Token",
          secret,
        ],
        update,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(create).not.toHaveBeenCalled();
  });

  it("does not acknowledge an update when durable persistence fails", async () => {
    const webhook = new TelegramBusinessWebhook(
      {
        telegramWebhookInbox: {
          create: jest
            .fn()
            .mockRejectedValue(new Error("database unavailable")),
        },
      } as never,
      { enabled: true, secret, botKey: () => "synthetic-bot-key" } as never,
    );
    await expect(
      webhook.admit(
        rawBody,
        ["x-telegram-bot-api-secret-token", secret],
        update,
      ),
    ).rejects.toThrow("database unavailable");
  });
});
