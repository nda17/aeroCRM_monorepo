import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { MailAuthority } from "./mail-authorization.client";
import { MailService } from "./mail.service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const currentMembership = "22222222-2222-4222-8222-222222222222";
const previousMembership = "33333333-3333-4333-8333-333333333333";
const mailboxId = "44444444-4444-4444-8444-444444444444";
const authority = (
  role: "OWNER" | "MANAGER" | "MEMBER" = "MEMBER",
  membershipId = currentMembership,
) =>
  ({
    schemaVersion: 1,
    customer: {
      workspaceId,
      subject: "same-person",
      role,
      state: "ACTIVE",
      dataScope: "ALL",
      teamIds: [],
      permissions: [],
    },
    membershipId,
    mailPermissions: ["mail:read", "mail:send", "mail:manage"],
  }) as unknown as MailAuthority;

const service = (prisma: object, authorization: object = {}) =>
  new MailService(
    prisma as never,
    authorization as never,
    {} as never,
    {} as never,
    {} as never,
  );

describe("mailbox access follows the current membership and explicit grants", () => {
  it("does not let a re-invited subject inherit a previous personal mailbox owner binding", async () => {
    const personal = {
      id: mailboxId,
      workspaceId,
      kind: "PERSONAL",
      ownerSubject: "same-person",
      ownerMembershipId: previousMembership,
    };
    const grantLookup = jest.fn();
    const svc = service({
      mailMailbox: { findFirst: jest.fn().mockResolvedValue(personal) },
      mailMailboxGrant: { findUnique: grantLookup },
    });
    await expect(
      svc.mailbox(authority(), mailboxId, "read"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(grantLookup).not.toHaveBeenCalled();
  });

	it("allows shared read without a per-user grant and still requires current membership for sending", async () => {
    const shared = {
      id: mailboxId,
      workspaceId,
      kind: "SHARED",
      ownerSubject: null,
      ownerMembershipId: null,
    };
    const findUnique = jest.fn().mockResolvedValue(null);
    const svc = service({
      mailMailbox: { findFirst: jest.fn().mockResolvedValue(shared) },
      mailMailboxGrant: { findUnique },
    });
		await expect(svc.mailbox(authority(), mailboxId, "read")).resolves.toEqual(
			shared,
		);
		await expect(
			svc.mailbox(authority(), mailboxId, "send"),
		).rejects.toBeInstanceOf(NotFoundException);
		expect(findUnique).toHaveBeenCalledWith({
      where: {
        workspaceId_mailboxId_subject_membershipId: {
          workspaceId,
          mailboxId,
          subject: "same-person",
          membershipId: currentMembership,
        },
      },
    });
  });

	it("lists shared and personal read mailboxes, while send grants stay membership-bound", async () => {
		const grantRows = [{ mailboxId }];
		const personalRows = [{ id: "66666666-6666-4666-8666-666666666666" }];
		const sharedRows = [{ id: mailboxId }];
		const grantFindMany = jest.fn().mockResolvedValue(grantRows);
		const mailboxFindMany = jest.fn((args) =>
			Promise.resolve(args.where.kind === "SHARED" ? sharedRows : personalRows),
		);
    const svc = service({
      mailMailboxGrant: { findMany: grantFindMany },
      mailMailbox: { findMany: mailboxFindMany },
    });
		expect(await svc.visibleMailboxIds(authority(), "read")).toEqual([
			personalRows[0].id,
			sharedRows[0].id,
		]);
		expect(grantFindMany).not.toHaveBeenCalled();
		expect(mailboxFindMany.mock.calls[0][0].where.ownerMembershipId).toBe(
			currentMembership,
		);
		expect(mailboxFindMany.mock.calls[1][0].where).toEqual({
			workspaceId,
			kind: "SHARED",
		});
		await svc.visibleMailboxIds(authority(), "send");
		expect(grantFindMany.mock.calls[0][0].where).toMatchObject({
			workspaceId,
			subject: "same-person",
			membershipId: currentMembership,
			revokedAt: null,
			canSend: true,
		});
	});

	it("keeps a personal mailbox bound to the subject's current membership", async () => {
		const personal = {
			id: mailboxId,
			workspaceId,
			kind: "PERSONAL",
			ownerSubject: "same-person",
			ownerMembershipId: currentMembership,
		};
		const findUnique = jest.fn();
		const svc = service({
			mailMailbox: { findFirst: jest.fn().mockResolvedValue(personal) },
			mailMailboxGrant: { findUnique },
		});
		await expect(svc.mailbox(authority(), mailboxId, "read")).resolves.toEqual(
			personal,
		);
		expect(findUnique).not.toHaveBeenCalled();
	});

  it("rechecks the owner role after provider probing before creating a shared mailbox", async () => {
    const initial = authority("OWNER");
    const changedRole = authority("MEMBER");
    const workflow = jest.fn().mockResolvedValue(changedRole);
    const probe = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      mailCommand: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    const svc = new MailService(
      prisma as never,
      { workflow } as never,
      {
        enabled: true,
        keyId: "test-key",
        key: Buffer.alloc(32),
        keyedDigest: () => "same-hash",
      } as never,
      { probe } as never,
      {} as never,
    );
    await expect(
      svc.connect(initial, {
        schemaVersion: 1,
        workspaceId,
        commandId: "77777777-7777-4777-8777-777777777777",
        kind: "SHARED",
        address: "shared@example.org",
        displayName: "Shared mailbox",
        imap: {
          host: "imap.example.org",
          port: 993,
          security: "TLS",
          username: "shared@example.org",
        },
        smtp: {
          host: "smtp.example.org",
          port: 587,
          security: "STARTTLS",
          username: "shared@example.org",
        },
        password: "application-password",
        smtpPassword: null,
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(workflow).toHaveBeenCalledWith(
      workspaceId,
      "same-person",
      currentMembership,
      "MAIL_SEND",
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
