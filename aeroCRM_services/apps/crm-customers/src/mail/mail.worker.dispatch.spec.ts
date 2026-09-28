import type { MailAuthority } from "./mail-authorization.client";
import { digest } from "./mail.config";
import { MailService } from "./mail.service";
import { MailWorker } from "./mail.worker";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const mailboxId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const contactId = "44444444-4444-4444-8444-444444444444";
const intentId = "55555555-5555-4555-8555-555555555555";
const jobId = "66666666-6666-4666-8666-666666666666";
const folderId = "77777777-7777-4777-8777-777777777777";
const mime = Buffer.from("bounded deterministic MIME fixture");
const authority = {
  schemaVersion: 1,
  customer: {
    workspaceId,
    subject: "sender",
    role: "OWNER",
    state: "ACTIVE",
    dataScope: "ALL",
    teamIds: [],
    permissions: [],
  },
  membershipId: "88888888-8888-4888-8888-888888888888",
  mailPermissions: ["mail:read", "mail:send", "mail:manage"],
} as unknown as MailAuthority;

const harness = (
  options: {
    result?: { accepted: readonly string[]; rejected: readonly string[] };
    sendMail?: () => Promise<{ accepted: string[]; rejected: string[] }>;
    mailboxGeneration?: number;
    folder?: Record<string, unknown>;
  } = {},
) => {
  const events: string[] = [];
  const intent: Record<string, any> = {
    id: intentId,
    workspaceId,
    mailboxId,
    contactId,
    scopeMessageId: null,
    html: null,
    actorSubject: "sender",
    membershipId: authority.membershipId,
    mailboxGeneration: options.mailboxGeneration ?? 1,
    state: "QUEUED",
    dispatchAdmittedAt: null,
    attachmentIds: [],
    to: [{ email: "recipient@example.org", name: null }],
    cc: [],
    bcc: [],
    subject: "Fixture",
    text: "Fixture body",
    messageId: "<fixture@example.org>",
    mimeObjectKey: `mail/${workspaceId}/${mailboxId}/mime-${intentId}`,
    mimeHash: digest(mime),
    envelope: { from: "mailbox@example.org", to: ["recipient@example.org"] },
    version: 1,
  };
  const mailbox: Record<string, any> = {
    id: mailboxId,
    workspaceId,
    connectionId,
    kind: "PERSONAL",
    ownerSubject: "sender",
    ownerMembershipId: authority.membershipId,
    canonicalAddress: "mailbox@example.org",
    displayName: "Fixture",
    enabled: true,
    generation: options.mailboxGeneration ?? 1,
    version: 1,
  };
  const connection = {
    id: connectionId,
    workspaceId,
    delegatedSubject: "sender",
    delegatedMembershipId: authority.membershipId,
    state: "ACTIVE",
  };
  let folder = {
    id: folderId,
    workspaceId,
    mailboxId,
    exactPath: "INBOX",
    kind: "INBOX",
    selected: true,
    uidValidity: 4n,
    generation: 1,
    liveLastUid: 20n,
    backfillLastUid: 0n,
    backfillUpperUid: null,
    completedAt: null,
    cutoff: new Date("2025-01-01T00:00:00.000Z"),
    ...(options.folder || {}),
  };
  const updateIntent = (
    where: Record<string, unknown>,
    data: Record<string, any>,
  ) => {
    if (where.state && where.state !== intent.state) return { count: 0 };
    if (where.dispatchAdmittedAt === null && intent.dispatchAdmittedAt !== null)
      return { count: 0 };
    Object.assign(intent, data);
    if (data.state === "SENDING") events.push("admitted");
    return { count: 1 };
  };
  const updateJob = jest.fn(async () => ({ count: 1 }));
  const job = {
    id: jobId,
    workspaceId,
    mailboxId,
    generation: 1,
    kind: "SEND",
    targetId: intentId,
    state: "RUNNING",
    attempts: 4,
    leaseVersion: 2,
    leaseUntil: new Date(Date.now() - 1000),
  } as any;
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ id: jobId }]),
    mailMailbox: {
      findFirst: jest.fn().mockResolvedValue(mailbox),
      findUniqueOrThrow: jest.fn().mockResolvedValue(mailbox),
      update: jest.fn().mockResolvedValue(mailbox),
    },
    mailMailboxGrant: { findUnique: jest.fn().mockResolvedValue(null) },
    mailConnection: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(connection),
    },
    contact: { findFirst: jest.fn().mockResolvedValue({ id: contactId }) },
    mailSendIntent: {
      findUniqueOrThrow: jest.fn(async () => intent),
      findUnique: jest.fn(async () => intent),
      updateMany: jest.fn(async ({ where, data }) => updateIntent(where, data)),
    },
    mailJob: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: updateJob,
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn(async (args) => {
        events.push(`enqueue:${args.create.kind}`);
        return args.create;
      }),
    },
    mailFolder: {
      findFirst: jest.fn(async () => folder),
      findUniqueOrThrow: jest.fn(async () => folder),
      update: jest.fn(async ({ data }) => {
        folder = {
          ...folder,
          ...data,
          ...(data.generation?.increment
            ? { generation: folder.generation + data.generation.increment }
            : {}),
        };
        return folder;
      }),
    },
    workspaceClosureFence: {
      findUnique: jest.fn().mockResolvedValue({ fencedAt: null }),
    },
    mailAttachment: {
      findUniqueOrThrow: jest.fn(),
    },
  };
  const rawSendMail =
    options.sendMail ||
    jest.fn().mockResolvedValue(
      options.result || {
        accepted: ["recipient@example.org"],
        rejected: [],
      },
    );
  const smtp = {
    sendMail: jest.fn(async (...args: any[]) => {
      events.push("smtp-send");
      return rawSendMail(...args);
    }),
    close: jest.fn(),
  };
  const imap = {
    mailboxOpen: jest.fn().mockResolvedValue({
      uidValidity: 4n,
      uidNext: 21,
    }),
    search: jest.fn().mockResolvedValue([]),
    logout: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => {
        const result = await callback(tx);
        events.push("transaction-committed");
        return result;
      },
    ),
    mailMailbox: tx.mailMailbox,
    mailMailboxGrant: tx.mailMailboxGrant,
    mailConnection: tx.mailConnection,
    contact: tx.contact,
    mailSendIntent: tx.mailSendIntent,
    mailJob: tx.mailJob,
    mailFolder: tx.mailFolder,
    workspaceClosureFence: tx.workspaceClosureFence,
    mailAttachment: tx.mailAttachment,
  };
  const mail = new MailService(
    prisma as never,
    { workflow: jest.fn().mockResolvedValue(authority) } as never,
    { enabled: true, sendEnabled: true, attachmentsAvailable: true } as never,
    {
      credentials: jest
        .fn()
        .mockReturnValue({ password: "secret", smtpPassword: "secret" }),
      configuration: jest.fn().mockReturnValue({ imap: {}, smtp: {} }),
      imap: jest.fn().mockResolvedValue(imap),
      smtp: jest.fn().mockResolvedValue(smtp),
    } as never,
    {
      assertKey: jest.fn(),
      get: jest.fn().mockResolvedValue(mime),
      key: jest.fn(() => `mail/${workspaceId}/${mailboxId}/mime-${intentId}`),
      put: jest.fn(),
    } as never,
  );
  const worker = new MailWorker(mail);
  return {
    worker,
    mail,
    job,
    intent,
    mailbox,
    folder: () => folder,
    events,
    smtp,
    imap,
    prisma,
    tx,
    updateJob,
  };
};

const invoke = <K extends "send" | "recover" | "sync" | "fetchAttachment">(
  worker: MailWorker,
  method: K,
  ...args: K extends "recover" ? [] : [Record<string, any>]
) =>
  (worker as unknown as Record<K, (...input: any[]) => Promise<unknown>>)[
    method
  ](...args);

describe("mail send admission and dispatch outcomes", () => {
  it.each([
    [{ accepted: ["a@example.org"], rejected: [] }, "ACCEPTED"],
    [
      { accepted: ["a@example.org"], rejected: ["b@example.org"] },
      "PARTIAL_ACCEPTED",
    ],
  ] as const)(
    "commits admission before SMTP and records RCPT outcome %s",
    async (result, expected) => {
      const h = harness({ result });
      await invoke(h.worker, "send", h.job);
      expect(h.events.indexOf("admitted")).toBeGreaterThanOrEqual(0);
      expect(h.events.indexOf("transaction-committed")).toBeLessThan(
        h.events.indexOf("smtp-send") === -1
          ? Infinity
          : h.events.indexOf("smtp-send"),
      );
      expect(h.intent.dispatchAdmittedAt).toBeInstanceOf(Date);
      expect(h.intent.state).toBe(expected);
      expect(h.intent.accepted).toEqual(result.accepted);
      expect(h.intent.rejected).toEqual(result.rejected);
      expect(h.smtp.sendMail).toHaveBeenCalledTimes(1);
    },
  );

  it("records UNKNOWN after a lost SMTP response and never retries the admitted message", async () => {
    const h = harness({
      sendMail: jest.fn(async () => {
        h.events.push("smtp-send");
        throw new Error("connection lost after DATA");
      }),
    });
    await invoke(h.worker, "send", h.job);
    expect(h.intent.state).toBe("UNKNOWN");
    expect(h.intent.safeErrorCode).toBe("MAIL_DISPATCH_OUTCOME_UNKNOWN");
    expect(h.smtp.sendMail).toHaveBeenCalledTimes(1);
    await invoke(h.worker, "send", h.job);
    expect(h.smtp.sendMail).toHaveBeenCalledTimes(1);
  });

  it("keeps an expired admitted send UNKNOWN when its original SMTP call returns after recovery", async () => {
    let smtpStarted!: () => void;
    let finishSmtp!: (result: {
      accepted: string[];
      rejected: string[];
    }) => void;
    const started = new Promise<void>((resolve) => {
      smtpStarted = resolve;
    });
    const h = harness({
      sendMail: jest.fn(
        () =>
          new Promise((resolve) => {
            finishSmtp = resolve;
            smtpStarted();
          }),
      ),
    });
    const originalDispatch = invoke(h.worker, "send", h.job);
    await started;
    expect(h.intent.state).toBe("SENDING");
    expect(h.intent.dispatchAdmittedAt).toBeInstanceOf(Date);

    h.mailbox.enabled = false;
    h.mailbox.generation = 2;
    h.tx.mailJob.findMany.mockResolvedValue([h.job] as never);
    await invoke(h.worker, "recover");
    expect(h.intent.state).toBe("UNKNOWN");
    expect(h.intent.safeErrorCode).toBe("MAIL_DISPATCH_OUTCOME_UNKNOWN");
    await expect(invoke(h.worker, "send", h.job)).rejects.toThrow(
      "MAIL_GENERATION_CHANGED",
    );
    expect(h.smtp.sendMail).toHaveBeenCalledTimes(1);

    finishSmtp({ accepted: ["recipient@example.org"], rejected: [] });
    await originalDispatch;
    expect(h.intent.state).toBe("UNKNOWN");
    expect(h.smtp.sendMail).toHaveBeenCalledTimes(1);
  });
});

describe("mail worker recovery and sync checkpoints", () => {
  it("settles an admitted SENDING intent to UNKNOWN after an expired lease, even after access or mailbox changes", async () => {
    const h = harness();
    h.intent.state = "SENDING";
    h.intent.dispatchAdmittedAt = new Date();
    h.mailbox.enabled = false;
    h.mailbox.generation = 2;
    const stale = { ...h.job, kind: "SEND", state: "RUNNING" };
    h.tx.mailJob.findMany.mockResolvedValue([stale] as never);
    h.tx.workspaceClosureFence = {
      findUnique: jest.fn().mockResolvedValue({ fencedAt: null }),
    } as never;
    await invoke(h.worker, "recover");
    expect(h.intent.state).toBe("UNKNOWN");
    expect(h.intent.safeErrorCode).toBe("MAIL_DISPATCH_OUTCOME_UNKNOWN");
    expect(h.intent.state).not.toBe("CANCELLED");
    expect(h.tx.mailJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "CANCELLED" }),
      }),
    );
    h.tx.mailJob.findMany.mockResolvedValue([] as never);
    await invoke(h.worker, "recover");
    expect(h.intent.state).toBe("UNKNOWN");
    expect(h.smtp.sendMail).not.toHaveBeenCalled();
  });

  it("requeues bounded BACKFILL when LIVE_SYNC detects a new UIDVALIDITY", async () => {
    const h = harness({
      folder: {
        uidValidity: 3n,
        liveLastUid: 40n,
        generation: 4,
      },
    });
    h.imap.mailboxOpen.mockResolvedValue({
      uidValidity: 9n,
      uidNext: 1001,
    } as never);
    const liveJob = {
      ...(h.job as object),
      kind: "LIVE_SYNC",
      targetId: folderId,
      attempts: 5,
    };
    await invoke(h.worker, "sync", liveJob);
    expect(h.folder()).toMatchObject({
      uidValidity: 9n,
      generation: 5,
      backfillLastUid: 0n,
      backfillUpperUid: 1000n,
      liveLastUid: 1000n,
      completedAt: null,
    });
    expect(h.events).toContain("enqueue:BACKFILL");
    expect(h.tx.mailJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          kind: "BACKFILL",
          targetId: folderId,
        }),
      }),
    );
    expect(h.tx.mailJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempts: 0 }),
      }),
    );
  });

  it("clears retry attempts after a successful empty LIVE_SYNC poll", async () => {
    const h = harness();
    const liveJob = {
      ...(h.job as object),
      kind: "LIVE_SYNC",
      targetId: folderId,
      attempts: 5,
    };
    await invoke(h.worker, "sync", liveJob);
    expect(h.imap.search).not.toHaveBeenCalled();
    expect(h.tx.mailJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempts: 0, state: "QUEUED" }),
      }),
    );
  });

  it("refuses old-generation attachment fetches after mailbox reconnect", async () => {
    const h = harness({ mailboxGeneration: 2 });
    const oldJob = {
      ...(h.job as object),
      kind: "FETCH_ATTACHMENT",
      generation: 1,
    };
    await expect(invoke(h.worker, "fetchAttachment", oldJob)).rejects.toThrow(
      "MAIL_GENERATION_CHANGED",
    );
    expect(h.prisma.mailAttachment.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(h.mail.transport.imap).not.toHaveBeenCalled();
  });
});
