import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { MailAuthority } from "./mail-authorization.client";
jest.mock("./mail.body", () => ({ prepareMailBody: jest.fn() }));
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
  it.each([false, true])(
    "cancels only the upload when its actor is revoked afterRead=%s",
    async (afterRead) => {
      const bytes = Buffer.from("hello");
      const mailbox = {
        id: "mailbox",
        workspaceId: "workspace",
        enabled: true,
        generation: 1,
        connectionId: "connection",
      };
      const file = {
        id: "file",
        mailboxId: mailbox.id,
        workspaceId: mailbox.workspaceId,
        state: "QUARANTINED",
        privateObjectKey: "key",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteSize: bytes.length,
        safeFileName: "hello.txt",
        declaredMime: "text/plain",
        uploadActor: "uploader",
        uploadMembershipId: "membership",
      };
      const authority = {
        membershipId: "delegate-member",
        customer: { subject: "delegate" },
        mailPermissions: ["mail:read"],
      };
      let uploaderChecks = 0;
      const workflow = jest.fn(async (_workspace, actor) => {
        if (actor === "uploader" && ++uploaderChecks > (afterRead ? 1 : 0))
          throw new ForbiddenException();
        return authority;
      });
      const prisma = {
        mailMailbox: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(mailbox),
          update: jest.fn(),
        },
        mailConnection: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            delegatedSubject: "delegate",
            delegatedMembershipId: "delegate-member",
          }),
          update: jest.fn(),
        },
        mailAttachment: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(file),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        mailJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        $transaction: jest.fn(),
      };
      const mail = {
        prisma,
        authorization: { workflow },
        mailbox: jest.fn().mockResolvedValue(mailbox),
        attachment: jest.fn().mockResolvedValue(file),
        objects: {
          assertKey: jest.fn(),
          get: jest.fn().mockResolvedValue(bytes),
        },
        config: { enabled: true, attachmentsAvailable: true },
      };
      const worker = new MailWorker(mail as never);
      await (worker as unknown as { run(job: unknown): Promise<void> }).run({
        id: "job",
        kind: "VALIDATE_ATTACHMENT",
        targetId: file.id,
        mailboxId: mailbox.id,
        workspaceId: mailbox.workspaceId,
        generation: 1,
        leaseVersion: 1,
        attempts: 1,
      });
      expect(mail.objects.get).toHaveBeenCalledTimes(afterRead ? 1 : 0);
      expect(prisma.mailAttachment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { state: "UNAVAILABLE" } }),
      );
      expect(prisma.mailJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            state: "CANCELLED",
            safeErrorCode: "MAIL_UPLOAD_ACTOR_REVOKED",
          }),
        }),
      );
      expect(prisma.mailMailbox.update).not.toHaveBeenCalled();
      expect(prisma.mailConnection.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});

describe("mail worker operational status and credential rotation", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  const makeWorker = (
    options: {
      rotationEnabled?: boolean;
      attachmentsAvailable?: boolean;
      transaction?: jest.Mock;
      backlog?: jest.Mock;
      findConnections?: jest.Mock;
      rotateRows?: Record<string, unknown>[];
      changed?: boolean[];
      objects?: Record<string, jest.Mock>;
      config?: Record<string, unknown>;
    } = {},
  ) => {
    process.env.CRM_CUSTOMERS_PROCESS_ROLE = "mail-sync";
    let compareAndSwap = 0;
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(async () => {
        const changed = options.changed?.[compareAndSwap] ?? true;
        compareAndSwap++;
        return [{ changed }];
      }),
      mailJob: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
      },
      mailSendIntent: { updateMany: jest.fn(), findUnique: jest.fn() },
      workspaceClosureFence: { findUnique: jest.fn() },
    };
    const prisma = {
      $transaction:
        options.transaction ||
        jest.fn(async (callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      $queryRaw: options.backlog || jest.fn().mockResolvedValue([]),
      mailConnection: {
        findMany:
          options.findConnections ||
          jest.fn().mockResolvedValue(options.rotateRows || []),
      },
    };
    const objects = {
      candidates:
        options.objects?.candidates ||
        jest.fn().mockResolvedValue({ items: [] }),
      assertKey: options.objects?.assertKey || jest.fn(),
      remove: options.objects?.remove || jest.fn(),
    };
    const config = {
      enabled: true,
      syncEnabled: true,
      sendEnabled: false,
      attachmentsAvailable: options.attachmentsAvailable ?? false,
      rotationEnabled: options.rotationEnabled ?? false,
      keyId: "active-key",
      aad: jest.fn(() => "aad"),
      decrypt: jest.fn(() => ({ password: "secret" })),
      encrypt: jest.fn(() => "active-key.ciphertext"),
      ...(options.config || {}),
    };
    const mail = {
      prisma,
      config,
      objects,
      transport: { smtp: jest.fn(() => ({ sendMail: jest.fn() })) },
    };
    return { worker: new MailWorker(mail as never), mail, prisma, tx, objects };
  };

  it("records database failures without logging error details", async () => {
    const transaction = jest
      .fn()
      .mockRejectedValue(new Error("secret database row contents"));
    const { worker } = makeWorker({ transaction });
    const loggerError = jest
      .spyOn(
        (
          worker as unknown as {
            logger: { error: (...args: unknown[]) => void };
          }
        ).logger,
        "error",
      )
      .mockImplementation(() => undefined);

    await worker.tick();
    expect(worker.progress()).toMatchObject({
      lastErrorCode: "MAIL_BACKGROUND_TICK_FAILED",
      consecutiveFailures: 1,
      totalFailures: 1,
      oldestDueAt: null,
    });
    expect(loggerError).toHaveBeenCalledWith("MAIL_BACKGROUND_TICK_FAILED");
    expect(loggerError.mock.calls.flat().join(" ")).not.toContain(
      "secret database row contents",
    );
    expect(JSON.stringify(worker.progress())).not.toContain(
      "secret database row contents",
    );
  });

  it("reports cleanup failures but continues inspecting and claiming queued work", async () => {
    const candidates = jest
      .fn()
      .mockRejectedValue(new Error("private object listing failure"));
    const backlog = jest.fn().mockResolvedValue([]);
    const h = makeWorker({
      attachmentsAvailable: true,
      objects: { candidates },
      backlog,
    });

    await h.worker.tick();
    expect(candidates).toHaveBeenCalledTimes(1);
    expect(backlog).toHaveBeenCalledTimes(1);
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(h.worker.progress()).toMatchObject({
      cleanup: { failures: 1 },
      lastErrorCode: "MAIL_BACKGROUND_CLEANUP_FAILED",
      totalFailures: 1,
      backlogInspectedAt: expect.any(String),
    });
    expect(JSON.stringify(h.worker.progress())).not.toContain(
      "private object listing failure",
    );
  });

  it("tracks the oldest queued job age and successful backlog inspection", async () => {
    const dueAt = new Date(Date.now() - 5000);
    const backlog = jest.fn().mockResolvedValue([{ dueAt }]);
    const h = makeWorker({ backlog });

    await h.worker.tick();
    expect(h.worker.progress()).toMatchObject({
      oldestDueAt: dueAt.toISOString(),
      oldestDueAgeSeconds: expect.any(Number),
      backlogInspectedAt: expect.any(String),
      lastSuccessAt: expect.any(String),
      lastErrorCode: null,
    });
    expect(h.worker.progress().oldestDueAgeSeconds).toBeGreaterThanOrEqual(5);
  });

  it("does not read credentials or contact SMTP when rotation is disabled", async () => {
    const findConnections = jest.fn();
    const h = makeWorker({ findConnections, rotationEnabled: false });
    const rotate = (
      h.worker as unknown as { rotateCredentials: () => Promise<void> }
    ).rotateCredentials;
    await rotate.call(h.worker);
    expect(findConnections).not.toHaveBeenCalled();
    expect(h.mail.transport.smtp).not.toHaveBeenCalled();
    expect(h.worker.progress().rotation).toMatchObject({
      enabled: false,
      scanned: 0,
      rewrapped: 0,
      skipped: 0,
    });
  });

  it("rotates at most twenty active non-null previous-key rows and counts CAS skips", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: `connection-${index}`,
      workspaceId: "workspace",
      credentialPrincipal: "actor",
      generation: 4,
      transport: { imap: { host: "imap.example.org" } },
      encryptedSecret: `old-ciphertext-${index}`,
      keyId: "old-key",
      version: index + 1,
    }));
    const findConnections = jest.fn().mockResolvedValue(rows.slice(0, 20));
    const smtpSend = jest.fn();
    const h = makeWorker({
      rotationEnabled: true,
      rotateRows: rows.slice(0, 20),
      findConnections,
      changed: Array.from({ length: 20 }, (_, index) => index !== 3),
    });
    h.mail.transport.smtp.mockReturnValue({ sendMail: smtpSend });

    await h.worker.rotateCredentials();
    expect(findConnections).toHaveBeenCalledWith({
      where: {
        state: "ACTIVE",
        encryptedSecret: { not: null },
        keyId: { not: "active-key" },
      },
      orderBy: { id: "asc" },
      take: 20,
    });
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(20);
    expect(h.worker.progress().rotation).toMatchObject({
      enabled: true,
      scanned: 20,
      rewrapped: 19,
      skipped: 1,
      failures: 0,
      lastSuccessAt: expect.any(String),
    });
    expect(smtpSend).not.toHaveBeenCalled();
  });

  it("advances past a damaged first batch so later credentials are not starved", async () => {
    const damagedRows = Array.from({ length: 20 }, (_, index) => ({
      id: `connection-${String(index).padStart(2, "0")}`,
      workspaceId: "workspace",
      credentialPrincipal: "actor",
      generation: 1,
      transport: { imap: { host: "imap.example.org" } },
      encryptedSecret: `damaged-ciphertext-${index}`,
      keyId: "old-key",
      version: 1,
    }));
    const validRow = {
      ...damagedRows[0],
      id: "connection-20",
      encryptedSecret: "valid-old-ciphertext",
    };
    const findConnections = jest
      .fn()
      .mockResolvedValueOnce(damagedRows)
      .mockResolvedValueOnce([validRow]);
    const decrypt = jest.fn((ciphertext: string) => {
      if (ciphertext.startsWith("damaged-"))
        throw new Error("private damaged credential");
      return { password: "synthetic-secret" };
    });
    const h = makeWorker({
      rotationEnabled: true,
      findConnections,
      config: { decrypt },
    });

    await h.worker.rotateCredentials();
    expect(h.worker.progress().rotation).toMatchObject({
      scanned: 20,
      rewrapped: 0,
      failures: 20,
    });

    await h.worker.rotateCredentials();
    expect(findConnections).toHaveBeenNthCalledWith(2, {
      where: {
        state: "ACTIVE",
        encryptedSecret: { not: null },
        keyId: { not: "active-key" },
        id: { gt: "connection-19" },
      },
      orderBy: { id: "asc" },
      take: 20,
    });
    expect(h.worker.progress().rotation).toMatchObject({
      scanned: 21,
      rewrapped: 1,
      failures: 20,
    });
    expect(JSON.stringify(h.worker.progress())).not.toContain(
      "private damaged credential",
    );
  });

  it("treats a concurrent reconnect CAS miss as skipped and supplies the old ciphertext fence", async () => {
    const row = {
      id: "connection-1",
      workspaceId: "workspace",
      credentialPrincipal: "actor",
      generation: 7,
      transport: { imap: { host: "imap.example.org" } },
      encryptedSecret: "ciphertext-before-reconnect",
      keyId: "old-key",
      version: 9,
    };
    const h = makeWorker({
      rotationEnabled: true,
      rotateRows: [row],
      changed: [false],
    });

    await h.worker.rotateCredentials();
    const queryArguments = h.tx.$queryRaw.mock.calls[0];
    expect(queryArguments.slice(1)).toEqual([
      row.id,
      row.version,
      row.encryptedSecret,
      "active-key.ciphertext",
      "active-key",
    ]);
    expect(h.worker.progress().rotation).toMatchObject({
      scanned: 1,
      rewrapped: 0,
      skipped: 1,
      failures: 0,
    });
  });
});
