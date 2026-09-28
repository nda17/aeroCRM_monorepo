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
