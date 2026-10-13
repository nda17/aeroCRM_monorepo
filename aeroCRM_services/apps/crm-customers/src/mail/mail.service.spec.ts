import { BadRequestException, ConflictException } from "@nestjs/common";
import type { MailAuthority } from "./mail-authorization.client";
import type { MailRequestHash } from "./mail.config";
jest.mock("./mail.body", () => ({ prepareMailBody: jest.fn() }));
import { MailConfig } from "./mail.config";
import { MailService } from "./mail.service";

const authority = {
  schemaVersion: 1,
  customer: {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    subject: "user-1",
  },
  membershipId: "22222222-2222-4222-8222-222222222222",
  mailPermissions: [],
} as unknown as MailAuthority;

describe("mail command receipts and fresh authorization", () => {
  const legacyHash: MailRequestHash = {
    value: "active-hash",
    keyId: "hmac-new",
    candidates: new Map([
      [null, "legacy-hash"],
      ["hmac-old", "old-hash"],
      ["hmac-new", "active-hash"],
    ]),
  };

  async function replay(row: Record<string, unknown>, actor = authority) {
    const oldResponse = { schemaVersion: 1, sendId: "queued-once" };
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
      mailCommand: {
        findUnique: jest.fn().mockResolvedValue({
          workspaceId: authority.customer.workspaceId,
          actorSubject: authority.customer.subject,
          ...row,
          response: oldResponse,
        }),
        create: jest.fn(),
      },
      mailAudit: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const authorization = { workflow: jest.fn().mockResolvedValue(actor) };
    const service = new MailService(
      prisma as never,
      authorization as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const write = jest.fn();
    const result = service.command(
      actor,
      {
        workspaceId: authority.customer.workspaceId,
        commandId: "33333333-3333-4333-8333-333333333333",
      },
      "SEND",
      legacyHash,
      write,
    );
    return { result, write, tx };
  }

  it("replays a legacy receipt during rotation without rerunning writes or duplicating audit", async () => {
    const { result, write, tx } = await replay({
      requestHash: "legacy-hash",
      requestHashKeyId: null,
    });
    await expect(result).resolves.toEqual({
      schemaVersion: 1,
      sendId: "queued-once",
    });
    expect(write).not.toHaveBeenCalled();
    expect(tx.mailCommand.create).not.toHaveBeenCalled();
    expect(tx.mailAudit.create).not.toHaveBeenCalled();
  });

  it("replays a previous-key command receipt after rotation without repeating effects", async () => {
    const { result, write, tx } = await replay({
      requestHash: "old-hash",
      requestHashKeyId: "hmac-old",
    });
    await expect(result).resolves.toMatchObject({ sendId: "queued-once" });
    expect(write).not.toHaveBeenCalled();
    expect(tx.mailCommand.create).not.toHaveBeenCalled();
    expect(tx.mailAudit.create).not.toHaveBeenCalled();
  });

  it("persists the active digest and key id for a new command receipt", async () => {
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
      mailCommand: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      mailAudit: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const authorization = { workflow: jest.fn().mockResolvedValue(authority) };
    const service = new MailService(
      prisma as never,
      authorization as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const write = jest.fn().mockResolvedValue({ queued: true });

    await service.command(
      authority,
      {
        workspaceId: authority.customer.workspaceId,
        commandId: "33333333-3333-4333-8333-333333333333",
      },
      "SEND",
      legacyHash,
      write,
    );
    expect(tx.mailCommand.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestHash: "active-hash",
        requestHashKeyId: "hmac-new",
      }),
    });
    expect(tx.mailAudit.create).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of a command id when its normalized request hash differs", async () => {
    const tx = {
      mailCommand: {
        findUnique: jest.fn().mockResolvedValue({
          workspaceId: authority.customer.workspaceId,
          actorSubject: authority.customer.subject,
          requestHash: "original-hash",
          requestHashKeyId: "hmac-old",
          response: { id: "old" },
        }),
      },
    };
    const service = new MailService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.receipt(
        authority,
        "33333333-3333-4333-8333-333333333333",
        {
          value: "changed-hash",
          keyId: "hmac-new",
          candidates: new Map([["hmac-old", "different-hash"]]),
        },
        tx as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("fails closed when a stored command references a key outside the retained keyring", async () => {
    const tx = {
      mailCommand: {
        findUnique: jest.fn().mockResolvedValue({
          workspaceId: authority.customer.workspaceId,
          actorSubject: authority.customer.subject,
          requestHash: "unknown-key-hash",
          requestHashKeyId: "removed-key",
          response: { id: "must-not-replay" },
        }),
      },
    };
    const service = new MailService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.receipt(
        authority,
        "33333333-3333-4333-8333-333333333333",
        {
          value: "new-key-hash",
          keyId: "hmac-new",
          candidates: new Map([["hmac-new", "new-key-hash"]]),
        },
        tx as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("includes actor, membership, workspace and operation in idempotency digest", () => {
    const config = {
      requestHash: jest.fn((value: unknown) => ({
        value: JSON.stringify(value),
        keyId: "hmac-new",
        candidates: new Map([["hmac-new", JSON.stringify(value)]]),
      })),
    };
    const service = new MailService(
      {} as never,
      {} as never,
      config as never,
      {} as never,
      {} as never,
    );
    service.hash(authority, "CONNECT", { address: "team@example.org" });
    expect(config.requestHash).toHaveBeenCalledWith([
      "user-1",
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
      "CONNECT",
      { address: "team@example.org" },
    ]);
  });

  it("does not replay a matching receipt for a different actor", async () => {
    const anotherActor = {
      ...authority,
      customer: { ...authority.customer, subject: "user-2" },
    } as MailAuthority;
    const { result, write } = await replay(
      {
        requestHash: "legacy-hash",
        requestHashKeyId: null,
      },
      anotherActor,
    );
    await expect(result).rejects.toBeInstanceOf(ConflictException);
    expect(write).not.toHaveBeenCalled();
  });

  it.each(["legacy", "rotated"])(
    "preserves %s cursor signing while binding it to workspace, actor, membership and filter",
    (mode) => {
      const original = { ...process.env };
      try {
        const legacyKey = Buffer.alloc(32, 7);
        process.env.CRM_MAIL_ENABLED = "true";
        process.env.CRM_MAIL_CREDENTIAL_KEY = legacyKey.toString("base64");
        process.env.CRM_MAIL_CREDENTIAL_KEY_ID = "legacy-1";
        if (mode === "rotated") {
          process.env.CRM_MAIL_CREDENTIAL_KEYRING = JSON.stringify({
            "legacy-1": legacyKey.toString("base64"),
            "credential-2": Buffer.alloc(32, 8).toString("base64"),
          });
          process.env.CRM_MAIL_CREDENTIAL_ACTIVE_KEY_ID = "credential-2";
          process.env.CRM_MAIL_HMAC_KEYRING = JSON.stringify({
            "legacy-1": legacyKey.toString("base64"),
            "hmac-2": Buffer.alloc(32, 9).toString("base64"),
          });
          process.env.CRM_MAIL_HMAC_ACTIVE_KEY_ID = "hmac-2";
        } else {
          delete process.env.CRM_MAIL_CREDENTIAL_KEYRING;
          delete process.env.CRM_MAIL_CREDENTIAL_ACTIVE_KEY_ID;
          delete process.env.CRM_MAIL_HMAC_KEYRING;
          delete process.env.CRM_MAIL_HMAC_ACTIVE_KEY_ID;
        }
        const config = new MailConfig();
        const service = new MailService(
          {} as never,
          {} as never,
          config,
          {} as never,
          {} as never,
        );
        const row = {
          id: "33333333-3333-4333-8333-333333333333",
          createdAt: new Date("2026-10-12T10:00:00.000Z"),
        };
        const cursor = service.cursor(authority, "inbox", row);
        expect(service.parseCursor(authority, "inbox", cursor)).toEqual(row);
        if (mode === "legacy") expect(cursor.split(".")).toHaveLength(2);
        else expect(cursor.startsWith("v1.hmac-2.")).toBe(true);

        const anotherActor = {
          ...authority,
          customer: { ...authority.customer, subject: "user-2" },
        } as MailAuthority;
        const anotherMembership = {
          ...authority,
          membershipId: "44444444-4444-4444-8444-444444444444",
        } as MailAuthority;
        const anotherWorkspace = {
          ...authority,
          customer: {
            ...authority.customer,
            workspaceId: "55555555-5555-4555-8555-555555555555",
          },
        } as MailAuthority;
        expect(() =>
          service.parseCursor(anotherActor, "inbox", cursor),
        ).toThrow(BadRequestException);
        expect(() =>
          service.parseCursor(anotherMembership, "inbox", cursor),
        ).toThrow(BadRequestException);
        expect(() =>
          service.parseCursor(anotherWorkspace, "inbox", cursor),
        ).toThrow(BadRequestException);
        expect(() => service.parseCursor(authority, "sent", cursor)).toThrow(
          BadRequestException,
        );
      } finally {
        process.env = { ...original };
      }
    },
  );
});

describe("shared mail reply processing", () => {
  it("returns bounded reply actor and delivery state facts without message payloads", async () => {
    const messageId = "33333333-3333-4333-8333-333333333333";
    const mailboxId = "44444444-4444-4444-8444-444444444444";
    const createdAt = new Date("2026-10-12T10:00:00.000Z");
    const states = [
      "QUEUED",
      "SENDING",
      "ACCEPTED",
      "PARTIAL_ACCEPTED",
      "FAILED",
      "UNKNOWN",
      "CANCELLED",
    ];
    const rows = Array.from({ length: 101 }, (_, index) => ({
      state: states[index % states.length],
      id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, "0")}`,
      actorSubject: `staff-${index}`,
      membershipId: authority.membershipId,
      createdAt,
      dispatchAdmittedAt: index === 0 ? null : createdAt,
      settledAt: index > 1 ? createdAt : null,
      safeErrorCode:
        states[index % states.length] === "FAILED" ? "SMTP_REJECTED" : null,
      body: "must not be returned",
    }));
    const tx = {
      mailMessage: { findFirst: jest.fn().mockResolvedValue({ mailboxId }) },
      mailSendIntent: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const config = { enabled: true };
    const service = new MailService(
      prisma as never,
      {} as never,
      config as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(service, "readableMessage")
      .mockResolvedValue({ mailboxId } as never);

    const result = await service.messageProcessing(authority, messageId);
    expect(result).toMatchObject({
      schemaVersion: 1,
      workspaceId: authority.customer.workspaceId,
      messageId,
      hasMore: true,
    });
    expect(result.replies).toHaveLength(100);
    for (const state of states)
      expect(result.replies.some((reply) => reply.state === state)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("must not be returned");
    expect(tx.mailSendIntent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: authority.customer.workspaceId,
          mailboxId,
          replyToMessageId: messageId,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 101,
      }),
    );
  });
});
