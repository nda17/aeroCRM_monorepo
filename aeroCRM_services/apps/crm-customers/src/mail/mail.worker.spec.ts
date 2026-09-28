import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { MailAuthority } from "./mail-authorization.client";
import { MailWorker } from "./mail.worker";

describe("mail worker authorization at dispatch time", () => {
  it("rechecks current mailbox ACL before processing a queued job", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const membershipId = "22222222-2222-4222-8222-222222222222";
    const mailboxId = "33333333-3333-4333-8333-333333333333";
    const connectionId = "44444444-4444-4444-8444-444444444444";
    const currentAuthority = {
      schemaVersion: 1,
      customer: {
        workspaceId,
        subject: "delegated-user",
        state: "ACTIVE",
      },
      membershipId,
      mailPermissions: ["mail:read"],
    } as unknown as MailAuthority;
    const mailbox = {
      id: mailboxId,
      workspaceId,
      connectionId,
      enabled: true,
      generation: 3,
    };
    const connection = {
      delegatedSubject: "delegated-user",
      delegatedMembershipId: membershipId,
    };
    const workflow = jest.fn().mockResolvedValue(currentAuthority);
    const prisma = {
      mailMailbox: { findUniqueOrThrow: jest.fn().mockResolvedValue(mailbox) },
      mailConnection: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(connection),
      },
    };
    const mailboxAcl = jest.fn().mockRejectedValue(new NotFoundException());
    const mail = {
      prisma,
      authorization: { workflow },
      mailbox: mailboxAcl,
      config: { enabled: true, sendEnabled: true, attachmentsAvailable: true },
    };
    const worker = new MailWorker(mail as never);
    const job = {
      workspaceId,
      mailboxId,
      generation: 3,
    };
    const fresh = (
      worker as unknown as {
        fresh: (
          job: { workspaceId: string; mailboxId: string; generation: number },
          purpose: "MAIL_SYNC" | "MAIL_SEND",
        ) => Promise<unknown>;
      }
    ).fresh;
    await expect(fresh.call(worker, job, "MAIL_SYNC")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(workflow).toHaveBeenCalledWith(
      workspaceId,
      "delegated-user",
      membershipId,
      "MAIL_SYNC",
    );
    expect(mailboxAcl).toHaveBeenCalledWith(
      currentAuthority,
      mailboxId,
      "read",
    );
  });
});


describe("upload validation actor revocation", () => {
  it.each([false, true])("cancels only the upload when its actor is revoked afterRead=%s", async (afterRead) => {
    const bytes = Buffer.from("hello");
    const mailbox = { id: "mailbox", workspaceId: "workspace", enabled: true, generation: 1, connectionId: "connection" };
    const file = { id: "file", mailboxId: mailbox.id, workspaceId: mailbox.workspaceId, state: "QUARANTINED", privateObjectKey: "key", sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.length, safeFileName: "hello.txt", declaredMime: "text/plain", uploadActor: "uploader", uploadMembershipId: "membership" };
    const authority = { membershipId: "delegate-member", customer: { subject: "delegate" } };
    let uploaderChecks = 0;
    const workflow = jest.fn(async (_workspace, actor) => {
      if (actor === "uploader" && (++uploaderChecks > (afterRead ? 1 : 0))) throw new ForbiddenException();
      return authority;
    });
    const prisma = {
      mailMailbox: { findUniqueOrThrow: jest.fn().mockResolvedValue(mailbox), update: jest.fn() },
      mailConnection: { findUniqueOrThrow: jest.fn().mockResolvedValue({ delegatedSubject: "delegate", delegatedMembershipId: "delegate-member" }), update: jest.fn() },
      mailAttachment: { findUniqueOrThrow: jest.fn().mockResolvedValue(file), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      mailJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn(),
    };
    const mail = { prisma, authorization: { workflow }, mailbox: jest.fn().mockResolvedValue(mailbox), attachment: jest.fn().mockResolvedValue(file), objects: { assertKey: jest.fn(), get: jest.fn().mockResolvedValue(bytes) }, config: { enabled: true, attachmentsAvailable: true } };
    const worker = new MailWorker(mail as never);
    await (worker as unknown as { run(job: unknown): Promise<void> }).run({ id: "job", kind: "VALIDATE_ATTACHMENT", targetId: file.id, mailboxId: mailbox.id, workspaceId: mailbox.workspaceId, generation: 1, leaseVersion: 1, attempts: 1 });
    expect(mail.objects.get).toHaveBeenCalledTimes(afterRead ? 1 : 0);
    expect(prisma.mailAttachment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { state: "UNAVAILABLE" } }));
    expect(prisma.mailJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "CANCELLED", safeErrorCode: "MAIL_UPLOAD_ACTOR_REVOKED" }) }));
    expect(prisma.mailMailbox.update).not.toHaveBeenCalled();
    expect(prisma.mailConnection.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
