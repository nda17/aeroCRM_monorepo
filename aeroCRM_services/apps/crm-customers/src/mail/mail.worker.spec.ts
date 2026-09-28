import { NotFoundException } from "@nestjs/common";
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
