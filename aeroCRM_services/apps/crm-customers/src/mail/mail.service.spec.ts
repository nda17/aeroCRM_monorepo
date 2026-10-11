import { ConflictException } from "@nestjs/common";
import type { MailAuthority } from "./mail-authorization.client";
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
  it("replays the original command response without rerunning writes or adding duplicate audit rows", async () => {
    const oldResponse = { schemaVersion: 1, sendId: "queued-once" };
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
      mailCommand: {
        findUnique: jest.fn().mockResolvedValue({
          workspaceId: authority.customer.workspaceId,
          actorSubject: authority.customer.subject,
          requestHash: "same-request",
          response: oldResponse,
        }),
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
    const write = jest.fn();
    await expect(
      service.command(
        authority,
        {
          workspaceId: authority.customer.workspaceId,
          commandId: "33333333-3333-4333-8333-333333333333",
        },
        "SEND",
        "same-request",
        write,
      ),
    ).resolves.toEqual(oldResponse);
    expect(write).not.toHaveBeenCalled();
    expect(tx.mailCommand.create).not.toHaveBeenCalled();
    expect(tx.mailAudit.create).not.toHaveBeenCalled();
  });

  it("rejects reuse of a command id when its normalized request hash differs", async () => {
    const tx = {
      mailCommand: {
        findUnique: jest.fn().mockResolvedValue({
          workspaceId: authority.customer.workspaceId,
          actorSubject: authority.customer.subject,
          requestHash: "original-hash",
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
        "changed-hash",
        tx as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("includes actor, membership, workspace and operation in idempotency digest", () => {
    const config = { keyedDigest: jest.fn((value) => JSON.stringify(value)) };
    const service = new MailService(
      {} as never,
      {} as never,
      config as never,
      {} as never,
      {} as never,
    );
    service.hash(authority, "CONNECT", { address: "team@example.org" });
    expect(config.keyedDigest).toHaveBeenCalledWith([
      "user-1",
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
      "CONNECT",
      { address: "team@example.org" },
    ]);
  });
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
