import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import pg from "pg";

const required = (name) => {
  const value = process.env[name];
  assert.ok(value, `${name} is required`);
  return value;
};
const runtimeUrl = required("CRM_CUSTOMERS_TEST_DATABASE_URL");
const migrationUrl = required("CRM_CUSTOMERS_TEST_MIGRATION_DATABASE_URL");
const runtimeRole = required("CRM_CUSTOMERS_TEST_RUNTIME_ROLE");
assert.equal(process.env.CRM_MAIL_INTEGRATION_ALLOW_MUTATION, "true");
assert.match(runtimeRole, /^[a-z][a-z0-9_]{0,62}$/);
// Keep a synthetic local key and placeholder object-store settings so CI needs
// no mail secrets or external storage; this script never dispatches SMTP or calls S3.
process.env.CRM_MAIL_ENABLED = "true";
process.env.CRM_MAIL_SYNC_ENABLED = "false";
process.env.CRM_MAIL_SEND_ENABLED = "true";
process.env.CRM_MAIL_CREDENTIAL_KEY = Buffer.alloc(32, 0x42).toString("base64");
process.env.CRM_MAIL_CREDENTIAL_KEY_ID = "pg18-fixture-key";
process.env.CRM_MAIL_S3_ENDPOINT = "https://objects.example.invalid";
process.env.CRM_MAIL_S3_REGION = "test-only";
process.env.CRM_MAIL_S3_BUCKET = "test-only";
process.env.CRM_MAIL_S3_ACCESS_KEY_ID = "test-only";
process.env.CRM_MAIL_S3_SECRET_ACCESS_KEY = "test-only";
const local = (value) => {
  const parsed = new URL(value);
  return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    ? `${parsed.hostname}:${parsed.port}${parsed.pathname}`
    : "remote";
};
assert.notEqual(local(runtimeUrl), "remote", "mail fixture must be local");
assert.equal(local(runtimeUrl), local(migrationUrl));

const { PrismaClient } = await import("@prisma/crm-customers-client");
const { MailConfig } = await import("../../dist/src/mail/mail.config.js");
const { MailService } = await import("../../dist/src/mail/mail.service.js");
const { MailWorker } = await import("../../dist/src/mail/mail.worker.js");
const { MailAuthorityRevokedException } = await import("../../dist/src/mail/mail-authorization.client.js");
const { ForbiddenException } = await import("@nestjs/common");
const runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
const migrator = new PrismaClient({
  datasources: { db: { url: migrationUrl } },
});
const listener = new pg.Client({ connectionString: runtimeUrl });
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const subject = "corporate-mail-pg18-fixture";
const membershipId = randomUUID();
const ids = Object.fromEntries(
  [
    "connection",
    "mailbox",
    "grant",
    "folder",
    "message",
    "link",
    "attachment",
    "intent",
    "job",
    "command",
  ].map((name) => [name, randomUUID()]),
);
const contactId = randomUUID();
const commandId = randomUUID();
const commandAuthority = {
  schemaVersion: 1,
  customer: {
    workspaceId,
    subject,
    role: "OWNER",
    state: "ACTIVE",
    dataScope: "ALL",
    teamIds: [],
    permissions: [],
  },
  membershipId,
  mailPermissions: ["mail:read", "mail:send", "mail:manage"],
};
const authorities = new Map([[workspaceId, commandAuthority]]);
try {
  await listener.connect();
  await listener.query("LISTEN crm_live_changes_v1");
  const liveChanges = [];
  listener.on("notification", (event) => liveChanges.push(event.payload));
  // This isolated test database is reused between local runs; retire only
  // queued synthetic worker jobs owned by this fixture before claiming jobs.
  await runtime.mailJob.updateMany({
    where: {
      state: { in: ["QUEUED", "RUNNING"] },
      mailbox: { connection: { delegatedSubject: subject } },
    },
    data: {
      state: "CANCELLED",
      leaseOwner: null,
      leaseUntil: null,
      safeErrorCode: "INTEGRATION_FIXTURE_RESET",
    },
  });
  const [server] = await runtime.$queryRawUnsafe(
    "SELECT current_setting('server_version_num')::int AS version",
  );
  assert.equal(Math.floor(server.version / 10000), 18);
  const [role] = await runtime.$queryRawUnsafe(
    "SELECT current_user AS name, NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolbypassrls AS restricted FROM pg_roles r WHERE r.rolname=current_user",
  );
  assert.equal(role.name, runtimeRole);
  assert.equal(role.restricted, true);

  const guardedTables = [
    "mail_connections",
    "mail_mailboxes",
    "mail_mailbox_grants",
    "mail_folders",
    "mail_messages",
    "mail_contact_links",
    "mail_attachments",
    "mail_send_intents",
    "mail_send_attachments",
    "mail_jobs",
    "mail_commands",
    "mail_audit",
    "mail_notifications",
    "mail_notification_reads",
  ];
  const guards = await runtime.$queryRawUnsafe(
    `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='crm_customers' AND p.proname='mail_write_guard' AND t.tgenabled='O' AND NOT t.tgisinternal ORDER BY c.relname`,
  );
  assert.deepEqual(
    guards.map((row) => row.relname).sort(),
    [...guardedTables].sort(),
  );

  await migrator.workspaceClosureFence.upsert({
    where: { workspaceId },
    create: { workspaceId },
    update: { fencedAt: null },
  });
  await runtime.contact.create({
    data: {
      id: contactId,
      workspaceId,
      name: "Mail integration contact",
      createdBySubject: subject,
    },
  });
  await runtime.mailConnection.create({
    data: {
      id: ids.connection,
      workspaceId,
      delegatedSubject: subject,
      delegatedMembershipId: membershipId,
      provider: "IMAP_SMTP",
      transport: { imap: {}, smtp: {} },
      authMode: "PASSWORD",
      credentialPrincipal: "mail@example.org",
      keyId: "fixture-key",
      state: "ACTIVE",
    },
  });
  await runtime.mailMailbox.create({
    data: {
      id: ids.mailbox,
      workspaceId,
      connectionId: ids.connection,
      kind: "SHARED",
      canonicalAddress: `mail-${workspaceId}@example.org`,
      displayName: "Integration mailbox",
      imapLogin: "mail@example.org",
      smtpLogin: "mail@example.org",
      sendMode: "AS",
      enabled: true,
    },
  });
  await runtime.mailMailboxGrant.create({
    data: {
      id: ids.grant,
      workspaceId,
      mailboxId: ids.mailbox,
      subject,
      membershipId,
      canRead: true,
      canSend: true,
      canManage: true,
    },
  });
  await runtime.mailFolder.create({
    data: {
      id: ids.folder,
      workspaceId,
      mailboxId: ids.mailbox,
      exactPath: "INBOX",
      kind: "INBOX",
      selected: true,
      uidValidity: 7n,
    },
  });
  await runtime.mailMessage.create({
    data: {
      id: ids.message,
      workspaceId,
      mailboxId: ids.mailbox,
      folderId: ids.folder,
      folderGeneration: 1,
      uidValidity: 7n,
      uid: 1n,
      direction: "INBOUND",
      references: [],
      from: [{ email: "sender@example.org", name: null }],
      to: [{ email: `mail-${workspaceId}@example.org`, name: null }],
      cc: [],
      bcc: [],
      subject: "Fixture message",
      receivedAt: new Date(),
      plainText: "Fixture body",
      bodyStatus: "COMPLETE",
    },
  });
  await runtime.mailContactLink.create({
    data: {
      id: ids.link,
      workspaceId,
      mailboxId: ids.mailbox,
      messageId: ids.message,
      externalEmail: "sender@example.org",
      state: "UNMATCHED",
      method: "EXACT",
      actorSubject: subject,
    },
  });
  await runtime.mailAttachment.create({
    data: {
      id: ids.attachment,
      workspaceId,
      mailboxId: ids.mailbox,
      safeFileName: "fixture.txt",
      contactId,
      declaredMime: "text/plain",
      detectedMime: "text/plain",
      byteSize: 8,
      sha256: "a".repeat(64),
      privateObjectKey: `mail/${workspaceId}/${ids.mailbox}/${ids.attachment}`,
      state: "VALIDATED",
    },
  });
  await runtime.mailSendIntent.create({
    data: {
      id: ids.intent,
      workspaceId,
      mailboxId: ids.mailbox,
      contactId,
      actorSubject: subject,
      membershipId,
      commandId: randomUUID(),
      requestHash: "b".repeat(64),
      mailboxGeneration: 1,
      to: [{ email: "recipient@example.org", name: null }],
      cc: [],
      bcc: [],
      subject: "Fixture send",
      text: "Fixture body",
      attachmentIds: [ids.attachment],
      messageId: `<${randomUUID()}@example.org>`,
      state: "QUEUED",
    },
  });
  await runtime.mailSendAttachment.create({
    data: {
      workspaceId,
      sendId: ids.intent,
      attachmentId: ids.attachment,
    },
  });
  await runtime.mailJob.create({
    data: {
      id: ids.job,
      workspaceId,
      mailboxId: ids.mailbox,
      generation: 1,
      kind: "SEND",
      targetId: ids.intent,
      workKey: `fixture:${ids.job}`,
      state: "QUEUED",
    },
  });
  await runtime.mailCommand.create({
    data: {
      commandId: ids.command,
      workspaceId,
      actorSubject: subject,
      requestHash: "c".repeat(64),
      response: { schemaVersion: 1, sendId: ids.intent },
    },
  });
  await runtime.mailAudit.create({
    data: {
      workspaceId,
      mailboxId: ids.mailbox,
      actorSubject: subject,
      action: "FIXTURE",
      entityId: ids.command,
      commandId: ids.command,
      metadata: {},
    },
  });

  const mail = new MailService(
    runtime,
    { workflow: async (id) => authorities.get(id) ?? commandAuthority },
    new MailConfig(),
    {},
    {},
  );
  let syncMailForNotifications;
  let generatedNotificationId;
  let secondMembershipAuthority;
  const idempotentCommandId = randomUUID();
  const response = { schemaVersion: 1, workspaceId, item: { state: "QUEUED" } };
  const runCommand = () =>
    mail.command(
      commandAuthority,
      { workspaceId, commandId: idempotentCommandId },
      "SEND",
      "d".repeat(64),
      async () => response,
    );
  const repeated = await Promise.all(Array.from({ length: 6 }, runCommand));
  for (const result of repeated) assert.deepEqual(result, response);
  assert.equal(
    await runtime.mailCommand.count({
      where: { commandId: idempotentCommandId },
    }),
    1,
  );
  assert.equal(
    await runtime.mailAudit.count({
      where: { commandId: idempotentCommandId },
    }),
    1,
  );

  // Exercise actual SEND writes against both supported reply source types.
  // The imported message must already be linked to this contact.
  await runtime.mailContactLink.update({
    where: { id: ids.link },
    data: { state: "LINKED", contactId, version: { increment: 1 } },
  });

  // Run the production worker sync method against a synthetic IMAP transport.
  // This exercises LIVE_SYNC, duplicate UID, BACKFILL, SENT, and UIDVALIDITY
  // reset paths without external mail access or send operations.
  const syncContactId = randomUUID();
  const syncConnectionId = randomUUID();
  const syncMailboxId = randomUUID();
  const syncInboxId = randomUUID();
  const syncSentId = randomUUID();
  const syncMembershipId = randomUUID();
  await runtime.contact.create({
    data: {
      id: syncContactId,
      workspaceId,
      name: "Mail notification worker contact",
      email: "worker-contact@example.org",
      createdBySubject: subject,
    },
  });
  await runtime.mailConnection.create({
    data: {
      id: syncConnectionId,
      workspaceId,
      delegatedSubject: subject,
      delegatedMembershipId: membershipId,
      provider: "IMAP_SMTP",
      transport: { imap: {}, smtp: {} },
      authMode: "PASSWORD",
      credentialPrincipal: "worker@example.org",
      keyId: "fixture-key",
      state: "ACTIVE",
    },
  });
  await runtime.mailMailbox.create({
    data: {
      id: syncMailboxId,
      workspaceId,
      connectionId: syncConnectionId,
      kind: "SHARED",
      canonicalAddress: `worker-${workspaceId}@example.org`,
      displayName: "Worker notification fixture",
      imapLogin: "worker@example.org",
      smtpLogin: "worker@example.org",
      sendMode: "AS",
      enabled: true,
    },
  });
  await runtime.mailMailboxGrant.create({
    data: {
      id: randomUUID(),
      workspaceId,
      mailboxId: syncMailboxId,
      subject,
      membershipId,
      canRead: true,
      canSend: true,
      canManage: true,
    },
  });
  await runtime.mailFolder.createMany({
    data: [
      {
        id: syncInboxId,
        workspaceId,
        mailboxId: syncMailboxId,
        exactPath: "INBOX",
        kind: "INBOX",
        selected: true,
        uidValidity: 7n,
        cutoff: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
      {
        id: syncSentId,
        workspaceId,
        mailboxId: syncMailboxId,
        exactPath: "Sent",
        kind: "SENT",
        selected: true,
        uidValidity: 7n,
        cutoff: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    ],
  });

  let openedPath = "INBOX";
  let imapValidity = 7n;
  let imapUidNext = 2;
  let imapUids = [1];
  const fakeImap = {
    mailboxOpen: async (path) => {
      openedPath = path;
      return { uidNext: imapUidNext, uidValidity: imapValidity };
    },
    search: async () => imapUids,
    fetchOne: async (uid) => ({
      uid: Number(uid),
      internalDate: new Date(),
      size: 5,
      envelope: {
        date: new Date(),
        messageId: `<worker-${openedPath}-${uid}@example.org>`,
        subject: `Worker ${openedPath} ${uid}`,
        from: [{ address: "worker-contact@example.org", name: null }],
        to: [{ address: `worker-${workspaceId}@example.org`, name: null }],
        cc: [],
        bcc: [],
      },
      bodyStructure: { type: "text/plain", size: 5, part: "1" },
      headers: Buffer.alloc(0),
    }),
    download: async () => ({
      content: Readable.from([Buffer.from("hello")]),
      meta: { charset: "utf-8" },
    }),
    logout: async () => undefined,
    close: () => undefined,
  };
  syncMailForNotifications = new MailService(
    runtime,
    { workflow: async () => commandAuthority },
    new MailConfig(),
    {
      credentials: () => ({ password: "synthetic" }),
      configuration: () => ({ imap: {} }),
      imap: async () => fakeImap,
    },
    {},
  );
  const previousProcessRole = process.env.CRM_CUSTOMERS_PROCESS_ROLE;
  process.env.CRM_CUSTOMERS_PROCESS_ROLE = "mail-sync";
  const worker = new MailWorker(syncMailForNotifications);
  const syncJob = async (kind, folderId, key) =>
    runtime.mailJob.create({
      data: {
        id: randomUUID(),
        workspaceId,
        mailboxId: syncMailboxId,
        generation: 1,
        kind,
        targetId: folderId,
        workKey: `notification-worker:${key}:${randomUUID()}`,
        state: "QUEUED",
        dueAt: new Date(Date.now() - 1000),
      },
    });
  const processSyncJob = async (kind) => {
    let job = null;
    const deadline = Date.now() + 2000;
    while (!job && Date.now() < deadline) {
      job = await worker.claim();
      if (!job) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(job?.kind, kind);
    await worker.sync(job);
    await runtime.mailJob.updateMany({
      where: { id: job.id, state: "QUEUED" },
      data: { dueAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    return job;
  };
  try {
    liveChanges.length = 0;
    await syncJob("LIVE_SYNC", syncInboxId, "live");
    await processSyncJob("LIVE_SYNC");
    const notificationDeadline = Date.now() + 1500;
    while (
      !liveChanges.includes(workspaceId) &&
      Date.now() < notificationDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(
      liveChanges.includes(workspaceId),
      "LIVE_SYNC emits a committed mail event",
    );
    const liveMessage = await runtime.mailMessage.findFirstOrThrow({
      where: { workspaceId, mailboxId: syncMailboxId, uid: 1n },
    });
    const liveLink = await runtime.mailContactLink.findFirstOrThrow({
      where: { workspaceId, messageId: liveMessage.id },
    });
    assert.equal(liveLink.state, "LINKED");
    assert.equal(liveLink.contactId, syncContactId);
    assert.equal(
      await runtime.mailNotification.count({ where: { workspaceId } }),
      1,
      "a new LIVE_SYNC INBOX message creates one notification",
    );

    await runtime.mailFolder.update({
      where: { id: syncInboxId },
      data: { liveLastUid: 0n },
    });
    await syncJob("LIVE_SYNC", syncInboxId, "duplicate-uid");
    await processSyncJob("LIVE_SYNC");
    assert.equal(
      await runtime.mailNotification.count({ where: { workspaceId } }),
      1,
      "reprocessing the same folder generation and UID does not duplicate the event",
    );

    imapUidNext = 3;
    imapUids = [1, 2];
    await runtime.mailFolder.update({
      where: { id: syncInboxId },
      data: { backfillUpperUid: 2n, backfillLastUid: 0n, completedAt: null },
    });
    await syncJob("BACKFILL", syncInboxId, "history");
    await processSyncJob("BACKFILL");
    assert.equal(
      await runtime.mailMessage.count({
        where: { workspaceId, mailboxId: syncMailboxId, folderId: syncInboxId },
      }),
      2,
      "backfill imports historical messages",
    );
    assert.equal(await runtime.mailNotification.count({ where: { workspaceId } }), 1);

    // A row-trigger notification is visible to listeners only after commit.
    liveChanges.length = 0;
    const rolledBackMessageId = randomUUID();
    await assert.rejects(
      () =>
        runtime.$transaction(async (tx) => {
          await tx.mailMessage.create({
            data: {
              id: rolledBackMessageId,
              workspaceId,
              mailboxId: syncMailboxId,
              folderId: syncInboxId,
              folderGeneration: 1,
              uidValidity: 7n,
              uid: 777n,
              direction: "INBOUND",
              references: [],
              from: [{ email: "rollback@example.org", name: null }],
              to: [{ email: `worker-${workspaceId}@example.org`, name: null }],
              cc: [],
              bcc: [],
              subject: "Rolled back event",
              receivedAt: new Date(),
              plainText: "This transaction must not signal",
              bodyStatus: "COMPLETE",
            },
          });
          throw new Error("rollback fixture");
        }),
      /rollback fixture/,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      liveChanges.includes(workspaceId),
      false,
      "a rolled-back message insert does not publish its transactional notification",
    );

    imapUidNext = 2;
    imapUids = [1];
    await syncJob("LIVE_SYNC", syncSentId, "sent");
    await processSyncJob("LIVE_SYNC");
    assert.equal(
      await runtime.mailMessage.findFirstOrThrow({
        where: { workspaceId, mailboxId: syncMailboxId, folderId: syncSentId },
      }).then((message) => message.direction),
      "OUTBOUND",
    );
    assert.equal(
      await runtime.mailNotification.count({ where: { workspaceId } }),
      1,
      "live SENT messages do not create incoming notifications",
    );

    imapValidity = 8n;
    imapUidNext = 3;
    imapUids = [1, 2];
    await runtime.mailFolder.update({
      where: { id: syncInboxId },
      data: {
        uidValidity: 7n,
        liveLastUid: 0n,
        backfillLastUid: 0n,
        backfillUpperUid: null,
        completedAt: null,
      },
    });
    await syncJob("LIVE_SYNC", syncInboxId, "uid-reset");
    await processSyncJob("LIVE_SYNC");
    assert.equal(await runtime.mailNotification.count({ where: { workspaceId } }), 1);
    await processSyncJob("BACKFILL");
    assert.equal(
      await runtime.mailMessage.count({
        where: {
          workspaceId,
          mailboxId: syncMailboxId,
          folderId: syncInboxId,
          folderGeneration: 2,
        },
      }),
      2,
      "UIDVALIDITY reset reimports history as the new folder generation",
    );
    assert.equal(
      await runtime.mailNotification.count({ where: { workspaceId } }),
      1,
      "UIDVALIDITY reset and its generated BACKFILL do not notify historical mail",
    );

  const notifications = await syncMailForNotifications.notifications(commandAuthority, {
      workspaceId,
      page: 1,
      pageSize: 10,
      unreadOnly: "false",
    });
    assert.equal(notifications.total, 1);
    assert.equal(notifications.unreadCount, 1);
  assert.equal(notifications.items[0].messageId, liveMessage.id);
  assert.equal(notifications.items[0].contactId, syncContactId);
  generatedNotificationId = notifications.items[0].id;
    const readInput = { schemaVersion: 1, workspaceId, read: true };
  const firstRead = await syncMailForNotifications.readNotification(
      commandAuthority,
      notifications.items[0].id,
      readInput,
    );
  const repeatedRead = await syncMailForNotifications.readNotification(
      commandAuthority,
      notifications.items[0].id,
      readInput,
    );
  assert.equal(repeatedRead.readAt, firstRead.readAt);
  await assert.rejects(() =>
    runtime.mailNotification.update({
      where: { id: notifications.items[0].id },
      data: { createdAt: new Date() },
    }),
  );
  await assert.rejects(() =>
    runtime.mailNotification.delete({
      where: { id: notifications.items[0].id },
    }),
  );
  const readRow = await runtime.mailNotificationRead.findFirstOrThrow({
    where: {
      workspaceId,
      notificationId: notifications.items[0].id,
      recipientSubject: subject,
      recipientMembershipId: membershipId,
    },
  });
  await assert.rejects(() =>
    runtime.mailNotificationRead.update({
      where: { id: readRow.id },
      data: { recipientMembershipId: randomUUID() },
    }),
  );
    assert.equal(
      (await syncMailForNotifications.notifications(commandAuthority, {
        workspaceId,
        page: 1,
        pageSize: 10,
        unreadOnly: "true",
      })).total,
      0,
    );

    const secondMembership = randomUUID();
    await runtime.mailMailboxGrant.create({
      data: {
        id: randomUUID(),
        workspaceId,
        mailboxId: syncMailboxId,
        subject,
        membershipId: secondMembership,
        canRead: true,
        canSend: false,
        canManage: false,
      },
    });
  secondMembershipAuthority = {
      ...commandAuthority,
      customer: {
        ...commandAuthority.customer,
        role: "MANAGER",
        dataScope: "OWN",
      },
      membershipId: secondMembership,
    };

    // V1 remains linked-only, while v2 shows unmatched and ambiguous mail with
    // its mailbox binding and hides mail linked outside the caller's data scope.
    const foreignContactId = randomUUID();
    await runtime.contact.create({
      data: {
        id: foreignContactId,
        workspaceId,
        name: "Foreign linked contact",
        createdBySubject: "another-employee",
      },
    });
    const notificationFixtures = [
      { state: "UNMATCHED", uid: 801n, subject: "Unmatched notification" },
      { state: "AMBIGUOUS", uid: 802n, subject: "Ambiguous notification" },
      {
        state: "LINKED",
        uid: 803n,
        subject: "Foreign linked notification",
        contactId: foreignContactId,
      },
    ];
    const fixtureIds = [];
    for (const fixture of notificationFixtures) {
      const messageId = randomUUID();
      fixtureIds.push({ ...fixture, messageId });
      await runtime.mailMessage.create({
        data: {
          id: messageId,
          workspaceId,
          mailboxId: syncMailboxId,
          folderId: syncInboxId,
          folderGeneration: 2,
          uidValidity: 8n,
          uid: fixture.uid,
          direction: "INBOUND",
          references: [],
          from: [{ email: `fixture-${fixture.uid}@example.org`, name: null }],
          to: [{ email: `worker-${workspaceId}@example.org`, name: null }],
          cc: [],
          bcc: [],
          subject: fixture.subject,
          receivedAt: new Date(),
          plainText: fixture.subject,
          bodyStatus: "COMPLETE",
        },
      });
      await runtime.mailContactLink.create({
        data: {
          workspaceId,
          mailboxId: syncMailboxId,
          messageId,
          externalEmail: `fixture-${fixture.uid}@example.org`,
          state: fixture.state,
          method: "EXACT",
          actorSubject: subject,
          ...(fixture.contactId ? { contactId: fixture.contactId } : {}),
        },
      });
      await runtime.mailNotification.create({
        data: { workspaceId, messageId },
      });
    }
    const personalConnectionId = randomUUID();
    const personalMailboxId = randomUUID();
    const personalFolderId = randomUUID();
    const personalMessageId = randomUUID();
    await runtime.mailConnection.create({
      data: {
        id: personalConnectionId,
        workspaceId,
        delegatedSubject: subject,
        delegatedMembershipId: membershipId,
        provider: "IMAP_SMTP",
        transport: { imap: {}, smtp: {} },
        authMode: "PASSWORD",
        credentialPrincipal: "personal@example.org",
        keyId: "fixture-key",
        state: "ACTIVE",
      },
    });
    await runtime.mailMailbox.create({
      data: {
        id: personalMailboxId,
        workspaceId,
        connectionId: personalConnectionId,
        kind: "PERSONAL",
        ownerSubject: subject,
        ownerMembershipId: membershipId,
        canonicalAddress: `personal-${workspaceId}@example.org`,
        displayName: "Membership-bound personal mailbox",
        imapLogin: "personal@example.org",
        smtpLogin: "personal@example.org",
        sendMode: "AS",
        enabled: true,
      },
    });
    await runtime.mailFolder.create({
      data: {
        id: personalFolderId,
        workspaceId,
        mailboxId: personalMailboxId,
        exactPath: "INBOX",
        kind: "INBOX",
        selected: true,
        uidValidity: 3n,
      },
    });
    await runtime.mailMessage.create({
      data: {
        id: personalMessageId,
        workspaceId,
        mailboxId: personalMailboxId,
        folderId: personalFolderId,
        folderGeneration: 1,
        uidValidity: 3n,
        uid: 1n,
        direction: "INBOUND",
        references: [],
        from: [{ email: "personal-sender@example.org", name: null }],
        to: [{ email: "personal@example.org", name: null }],
        cc: [],
        bcc: [],
        subject: "Personal membership event",
        receivedAt: new Date(),
        plainText: "Visible only to the owning membership",
        bodyStatus: "COMPLETE",
      },
    });
    await runtime.mailContactLink.create({
      data: {
        workspaceId,
        mailboxId: personalMailboxId,
        messageId: personalMessageId,
        externalEmail: "personal-sender@example.org",
        state: "UNMATCHED",
        method: "EXACT",
        actorSubject: subject,
      },
    });
    await runtime.mailNotification.create({
      data: { workspaceId, messageId: personalMessageId },
    });
    const ownScopeAuthority = {
      ...commandAuthority,
      customer: {
        ...commandAuthority.customer,
        role: "MANAGER",
        dataScope: "OWN",
      },
    };
    const v2 = await mail.notifications(
      ownScopeAuthority,
      {
        workspaceId,
        page: 1,
        pageSize: 10,
        unreadOnly: "false",
      },
      2,
    );
    assert.equal(v2.schemaVersion, 2);
    assert.equal(v2.total, 4);
    assert(v2.items.every((item) =>
      [syncMailboxId, personalMailboxId].includes(item.mailboxId),
    ));
    assert.equal(
      v2.items.find((item) => item.messageId === fixtureIds[0].messageId)
        ?.contactId,
      null,
    );
    assert.equal(
      v2.items.find((item) => item.messageId === fixtureIds[1].messageId)
        ?.contactId,
      null,
    );
    assert.equal(
      v2.items.find((item) => item.messageId === personalMessageId)?.mailboxId,
      personalMailboxId,
      "PERSONAL notifications follow the exact owner membership",
    );
    assert.equal(
      v2.items.some((item) => item.messageId === fixtureIds[2].messageId),
      false,
      "v2 hides a notification when its linked contact is outside the caller's data scope",
    );
    const legacyNotifications = await mail.notifications(ownScopeAuthority, {
      workspaceId,
      page: 1,
      pageSize: 10,
      unreadOnly: "false",
    });
    assert.equal(legacyNotifications.schemaVersion, 1);
    assert.equal(
      legacyNotifications.total,
      1,
      "v1 keeps its historical linked-only visibility",
    );
    assert.equal(
      Object.hasOwn(legacyNotifications.items[0], "mailboxId"),
      false,
    );
    assert.equal(
      (
        await mail.notifications(
          secondMembershipAuthority,
          {
            workspaceId,
            page: 1,
            pageSize: 10,
            unreadOnly: "false",
          },
          2,
        )
      ).total,
      3,
      "a shared mailbox grant is bound to the exact active membership",
    );
    const noGrantAuthority = {
      ...secondMembershipAuthority,
      membershipId: randomUUID(),
    };
    assert.equal(
      (
        await mail.notifications(
          noGrantAuthority,
          {
            workspaceId,
            page: 1,
            pageSize: 10,
            unreadOnly: "false",
          },
          2,
        )
      ).total,
      0,
      "another membership of the same subject cannot reuse the mailbox grant",
    );
    assert.equal(
      (
        await syncMailForNotifications.notifications(
          secondMembershipAuthority,
          {
        workspaceId,
        page: 1,
        pageSize: 10,
        unreadOnly: "true",
      })).unreadCount,
      1,
      "a new membership does not inherit another membership's read state",
    );
  const unread = await syncMailForNotifications.readNotification(
      commandAuthority,
      notifications.items[0].id,
      { ...readInput, read: false },
    );
    assert.equal(unread.readAt, null);
    assert.equal(
      (await syncMailForNotifications.notifications(secondMembershipAuthority, {
        workspaceId,
        page: 1,
        pageSize: 10,
        unreadOnly: "true",
      })).unreadCount,
      1,
    );
  await runtime.contact.update({
    where: { id: syncContactId },
    data: { archivedAt: new Date() },
  });
  assert.equal(
    (await syncMailForNotifications.notifications(secondMembershipAuthority, {
      workspaceId,
      page: 1,
      pageSize: 10,
      unreadOnly: "false",
    })).total,
    0,
    "archived contacts fall outside current notification scope and counts",
  );
  await assert.rejects(() =>
    syncMailForNotifications.readNotification(
      secondMembershipAuthority,
      generatedNotificationId,
      { schemaVersion: 1, workspaceId, read: true },
    ),
  );
  await runtime.contact.update({
    where: { id: syncContactId },
    data: { archivedAt: null },
  });
    await runtime.mailMailboxGrant.update({
      where: {
        workspaceId_mailboxId_subject_membershipId: {
          workspaceId,
          mailboxId: syncMailboxId,
          subject,
          membershipId,
        },
      },
      data: { revokedAt: new Date() },
    });
    const revokedList = await syncMailForNotifications.notifications(commandAuthority, {
      workspaceId,
      page: 1,
      pageSize: 10,
      unreadOnly: "false",
    });
    assert.equal(revokedList.total, 0);
    assert.equal(
      (
        await syncMailForNotifications.notifications(
          commandAuthority,
          {
            workspaceId,
            page: 1,
            pageSize: 10,
            unreadOnly: "false",
          },
          2,
        )
      ).items.filter((item) => item.mailboxId === syncMailboxId).length,
      0,
      "revoking the exact membership grant removes shared-mail v2 events immediately",
    );
    await assert.rejects(() =>
      syncMailForNotifications.readNotification(commandAuthority, notifications.items[0].id, {
        ...readInput,
        read: false,
      }),
    );
  } finally {
    if (previousProcessRole === undefined)
      delete process.env.CRM_CUSTOMERS_PROCESS_ROLE;
    else process.env.CRM_CUSTOMERS_PROCESS_ROLE = previousProcessRole;
  }

  // Durable pause/retry/revocation use the real worker and restricted runtime SQL.
  const pauseConnectionId = randomUUID();
  const pauseMailboxId = randomUUID();
  await runtime.mailConnection.create({
    data: {
      id: pauseConnectionId,
      workspaceId,
      delegatedSubject: subject,
      delegatedMembershipId: membershipId,
      provider: "IMAP_SMTP",
      transport: {},
      authMode: "PASSWORD",
      credentialPrincipal: "pause@example.org",
      keyId: "fixture-key",
      encryptedSecret: "encrypted-fixture-preserved",
      state: "ACTIVE",
    },
  });
  await runtime.mailMailbox.create({
    data: {
      id: pauseMailboxId,
      workspaceId,
      connectionId: pauseConnectionId,
      kind: "PERSONAL",
      ownerSubject: subject,
      ownerMembershipId: membershipId,
      canonicalAddress: `pause-${workspaceId}@example.org`,
      displayName: "Pause fixture",
      imapLogin: "pause@example.org",
      smtpLogin: "pause@example.org",
      sendMode: "AS",
      enabled: true,
    },
  });
  const pauseFolderId = randomUUID();
  await runtime.mailFolder.create({ data: {
    id: pauseFolderId, workspaceId, mailboxId: pauseMailboxId, exactPath: "INBOX", kind: "INBOX", selected: true,
    uidValidity: 7n, liveLastUid: 42n, backfillLastUid: 13n,
    cutoff: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  } });
  let pauseAuthority = {
    ...commandAuthority,
    customer: { ...commandAuthority.customer, state: "READ_ONLY" },
  };
  let authorityError = null;
  let imapOpened = 0;
  const pauseMail = new MailService(
    runtime,
    {
      workflow: async () => {
        if (authorityError) throw authorityError;
        return pauseAuthority;
      },
    },
    new MailConfig(),
    {
      imap: async () => {
        imapOpened++;
        throw new Error("UNEXPECTED_IMAP");
      },
    },
    {},
  );
  const pauseWorker = new MailWorker(pauseMail);
  const leasedJob = async (generation = 1) =>
    runtime.mailJob.create({
      data: {
        id: randomUUID(),
        workspaceId,
        mailboxId: pauseMailboxId,
        generation,
        kind: "LIVE_SYNC",
        targetId: pauseFolderId,
        workKey: `pause-fixture:${randomUUID()}`,
        state: "RUNNING",
        leaseOwner: pauseWorker.owner,
        leaseVersion: 1,
        leaseUntil: new Date(Date.now() + 120000),
        attempts: 1,
      },
    });
  const firstPause = await leasedJob();
  await pauseWorker.run(firstPause);
  let pausedMailbox = await runtime.mailMailbox.findUniqueOrThrow({
    where: { id: pauseMailboxId },
  });
  let pausedConnection = await runtime.mailConnection.findUniqueOrThrow({
    where: { id: pauseConnectionId },
  });
  assert.equal(imapOpened, 0);
  assert.equal(pausedMailbox.enabled, true);
  assert.equal(pausedMailbox.generation, 1);
  assert.equal(pausedMailbox.disconnectedAt, null);
  assert.equal(pausedMailbox.safeErrorCode, "MAIL_WORKSPACE_READ_ONLY");
  assert.equal(pausedConnection.state, "ACTIVE");
  const pausedFolder = await runtime.mailFolder.findUniqueOrThrow({ where: { id: pauseFolderId } });
  assert.equal(pausedFolder.uidValidity, 7n);
  assert.equal(pausedFolder.liveLastUid, 42n);
  assert.equal(pausedFolder.backfillLastUid, 13n);
  assert.equal(pausedFolder.generation, 1);

  assert.equal(pausedConnection.encryptedSecret, "encrypted-fixture-preserved");
  const pausedJob = await runtime.mailJob.findUniqueOrThrow({
    where: { id: firstPause.id },
  });
  assert.equal(pausedJob.state, "QUEUED");
  assert.equal(pausedJob.attempts, 0);
  assert.equal(pausedJob.leaseOwner, null);
  assert.ok(pausedJob.dueAt.getTime() >= Date.now() + 50000);
  await pauseWorker.run(await leasedJob());
  assert.equal(
    await runtime.mailAudit.count({
      where: { mailboxId: pauseMailboxId, action: "SYNC_PAUSED" },
    }),
    1,
  );
  authorityError = new ForbiddenException(
    "Untyped service credential rejection",
  );
  const ambiguousJob = await leasedJob();
  await pauseWorker.run(ambiguousJob);
  assert.equal(
    (
      await runtime.mailJob.findUniqueOrThrow({
        where: { id: ambiguousJob.id },
      })
    ).state,
    "QUEUED",
  );
  assert.equal(
    (
      await runtime.mailConnection.findUniqueOrThrow({
        where: { id: pauseConnectionId },
      })
    ).encryptedSecret,
    "encrypted-fixture-preserved",
  );
  assert.equal(
    (
      await runtime.mailMailbox.findUniqueOrThrow({
        where: { id: pauseMailboxId },
      })
    ).safeErrorCode,
    "MAIL_WORKSPACE_READ_ONLY",
  );
  authorityError = null;
  pauseAuthority = commandAuthority;
  await pauseWorker.fresh(await leasedJob(), "MAIL_SYNC");
  assert.equal(
    await runtime.mailAudit.count({
      where: { mailboxId: pauseMailboxId, action: "SYNC_RESUMED" },
    }),
    1,
  );
  assert.equal(
    (
      await runtime.mailMailbox.findUniqueOrThrow({
        where: { id: pauseMailboxId },
      })
    ).safeErrorCode,
    null,
  );
  const staleJob = await leasedJob();
  await runtime.mailMailbox.update({
    where: { id: pauseMailboxId },
    data: { generation: { increment: 1 } },
  });
  await pauseWorker.revoke(staleJob);
  assert.equal(
    (
      await runtime.mailConnection.findUniqueOrThrow({
        where: { id: pauseConnectionId },
      })
    ).encryptedSecret,
    "encrypted-fixture-preserved",
  );
  authorityError = new MailAuthorityRevokedException("MEMBERSHIP_REVOKED");
  await pauseWorker.run(await leasedJob(2));
  pausedMailbox = await runtime.mailMailbox.findUniqueOrThrow({
    where: { id: pauseMailboxId },
  });
  pausedConnection = await runtime.mailConnection.findUniqueOrThrow({
    where: { id: pauseConnectionId },
  });
  assert.equal(pausedMailbox.enabled, false);
  assert.equal(pausedConnection.encryptedSecret, null);
  assert.equal(pausedConnection.state, "REAUTH_REQUIRED");
  assert.equal(
    await runtime.mailAudit.count({
      where: { mailboxId: pauseMailboxId, action: "AUTHORITY_REVOKED" },
    }),
    1,
  );

  const otherContactId = randomUUID();
  await runtime.contact.create({
    data: {
      id: otherContactId,
      workspaceId,
      name: "Other mail contact",
      createdBySubject: subject,
    },
  });
  const otherMailboxId = randomUUID();
  await runtime.mailMailbox.create({
    data: {
      id: otherMailboxId,
      workspaceId,
      connectionId: ids.connection,
      kind: "SHARED",
      canonicalAddress: `other-${workspaceId}@example.org`,
      displayName: "Other integration mailbox",
      imapLogin: "mail@example.org",
      smtpLogin: "mail@example.org",
      sendMode: "AS",
      enabled: true,
    },
  });
  await runtime.mailMailboxGrant.create({
    data: {
      id: randomUUID(),
      workspaceId,
      mailboxId: otherMailboxId,
      subject,
      membershipId,
      canRead: true,
      canSend: true,
      canManage: true,
    },
  });

  const replyDto = (replyToMessageId, overrides = {}) => ({
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    mailboxId: ids.mailbox,
    contactId,
    to: [{ email: "sender@example.org", name: null }],
    cc: [],
    bcc: [],
    subject: "Reply regression",
    text: "Synthetic reply body",
    attachmentIds: [],
    replyToMessageId,
    ...overrides,
  });
  const importedReply = replyDto(ids.message);
  const importedReceipt = await mail.send(commandAuthority, importedReply);
  assert.equal(importedReceipt.state, "QUEUED");
  assert.equal(
    (
      await runtime.mailSendIntent.findUniqueOrThrow({
        where: { id: importedReceipt.sendId },
      })
    ).replyToMessageId,
    ids.message,
  );
  assert.deepEqual(
    await mail.send(commandAuthority, importedReply),
    importedReceipt,
  );
  assert.equal(
    await runtime.mailSendIntent.count({
      where: { commandId: importedReply.commandId },
    }),
    1,
    "replaying an imported-message reply reuses its idempotent receipt",
  );

  const priorIntentReply = replyDto(ids.intent);
  const priorIntentReceipt = await mail.send(
    commandAuthority,
    priorIntentReply,
  );
  assert.equal(priorIntentReceipt.state, "QUEUED");
  assert.equal(
    (
      await runtime.mailSendIntent.findUniqueOrThrow({
        where: { id: priorIntentReceipt.sendId },
      })
    ).replyToMessageId,
    ids.intent,
  );

  for (const [label, dto] of [
    [
      "imported message linked to another contact",
      replyDto(ids.message, { contactId: otherContactId }),
    ],
    [
      "prior CRM intent owned by another contact",
      replyDto(ids.intent, { contactId: otherContactId }),
    ],
    [
      "imported message in another mailbox",
      replyDto(ids.message, { mailboxId: otherMailboxId }),
    ],
    [
      "prior CRM intent in another mailbox",
      replyDto(ids.intent, { mailboxId: otherMailboxId }),
    ],
  ]) {
    const before = await runtime.mailSendIntent.count({
      where: { commandId: dto.commandId },
    });
    await assert.rejects(() => mail.send(commandAuthority, dto), label);
    assert.equal(
      await runtime.mailSendIntent.count({
        where: { commandId: dto.commandId },
      }),
      before,
      `${label} must not create an intent`,
    );
  }

  // Standalone mail uses the same mailbox ACL without treating hidden linked
  // mail as unlinked. Use real relational filters, cursor, command and guards.
  const standaloneSource = randomUUID();
  const standaloneLink = randomUUID();
  const hiddenSource = randomUUID();
  const hiddenContact = randomUUID();
  const localUpload = randomUUID();
  const ownAuthority = {
    ...commandAuthority,
    customer: { ...commandAuthority.customer, role: "MANAGER", dataScope: "OWN" },
  };
  await runtime.contact.create({ data: {
    id: hiddenContact, workspaceId, name: "Standalone hidden contact",
    createdBySubject: "another-employee",
  } });
  for (const [id, uid, createdAt] of [
    [standaloneSource, 301n, "2030-01-01T00:00:00.000Z"],
    [hiddenSource, 302n, "2030-01-02T00:00:00.000Z"],
  ]) await runtime.mailMessage.create({ data: {
    id, workspaceId, mailboxId: ids.mailbox, folderId: ids.folder,
    folderGeneration: 1, uidValidity: 7n, uid, direction: "INBOUND",
    references: [], from: [{ email: "standalone@example.org", name: null }],
    to: [{ email: "mail@example.org", name: null }], cc: [], bcc: [],
    subject: "Standalone source", plainText: "Synthetic source",
    receivedAt: new Date(createdAt), createdAt: new Date(createdAt), bodyStatus: "COMPLETE",
  } });
  await runtime.mailContactLink.create({ data: {
    id: standaloneLink, workspaceId, mailboxId: ids.mailbox,
    messageId: standaloneSource, externalEmail: "standalone@example.org",
    state: "UNMATCHED", method: "EXACT", actorSubject: subject,
  } });
  await runtime.mailContactLink.create({ data: {
    workspaceId, mailboxId: ids.mailbox, messageId: hiddenSource,
    externalEmail: "standalone@example.org", contactId: hiddenContact,
    state: "LINKED", method: "MANUAL", actorSubject: subject,
  } });
  const standaloneQuery = { workspaceId, mailboxId: ids.mailbox, folder: "INBOX", limit: 1 };
  const standalonePage = await mail.messages(ownAuthority, standaloneQuery);
  assert.deepEqual(standalonePage.items.map(row => row.id), [standaloneSource],
    "hidden newer mail must be filtered before LIMIT, not create an empty visible page");
  assert(standalonePage.nextCursor);
  const nextStandalonePage = await mail.messages(ownAuthority, {
    ...standaloneQuery, cursor: standalonePage.nextCursor,
  });
  assert(!nextStandalonePage.items.some(row => [standaloneSource, hiddenSource].includes(row.id)));
  await assert.rejects(() => mail.messages(ownAuthority, {
    ...standaloneQuery, folder: "SENT", cursor: standalonePage.nextCursor,
  }), "a cursor cannot be reused for another mail folder");
  await assert.rejects(() => mail.message(ownAuthority, hiddenSource));
  assert.equal((await mail.message(ownAuthority, standaloneSource)).item.id, standaloneSource);

  await runtime.mailAttachment.create({ data: {
    id: localUpload, workspaceId, mailboxId: ids.mailbox, contactId: null,
    uploadActor: subject, uploadMembershipId: membershipId,
    safeFileName: "standalone.txt", declaredMime: "text/plain", detectedMime: "text/plain",
    byteSize: 8, sha256: "e".repeat(64),
    privateObjectKey: `mail/${workspaceId}/${ids.mailbox}/${localUpload}`, state: "VALIDATED",
  } });
  const otherReader = { ...commandAuthority, membershipId: randomUUID(),
    customer: { ...commandAuthority.customer, subject: "standalone-reader" } };
  await runtime.mailMailboxGrant.create({ data: {
    workspaceId, mailboxId: ids.mailbox, subject: otherReader.customer.subject,
    membershipId: otherReader.membershipId, canRead: true, canSend: false, canManage: false,
  } });
  await assert.rejects(() => mail.attachmentMetadata(otherReader, localUpload),
    "mailbox readers cannot read another author's unbound upload");
  const standaloneDto = replyDto(standaloneSource, { contactId: null, attachmentIds: [localUpload] });
  const standaloneReply = await mail.send(commandAuthority, standaloneDto);
  assert.deepEqual(await mail.send(commandAuthority, standaloneDto), standaloneReply);
  await assert.rejects(() => mail.send(commandAuthority, replyDto(null, {
    contactId: null, attachmentIds: [localUpload],
  })), "a bound reply upload cannot be reused to discard its inherited contact scope");
  await assert.rejects(() => mail.send(commandAuthority, { ...standaloneDto, contactId }),
    "the same command cannot change its nullable contact binding");
  const standaloneChild = await mail.send(commandAuthority, replyDto(standaloneReply.sendId, { contactId: null }));
  for (const sendId of [standaloneReply.sendId, standaloneChild.sendId]) {
    const row = await runtime.mailSendIntent.findUniqueOrThrow({ where: { id: sendId } });
    assert.equal(row.contactId, null);
    assert.equal(row.scopeMessageId, standaloneSource);
    assert.equal((await mail.sendStatus(ownAuthority, sendId)).item.state, "QUEUED");
  }
  assert.equal((await mail.attachmentMetadata(otherReader, localUpload)).item.id, localUpload,
    "bound files follow the readable intent rather than remaining uploader-private");
  await assert.rejects(() => mail.send(commandAuthority, replyDto(ids.message, { contactId: null })),
    "null contact cannot downgrade a linked reply source");
  await assert.rejects(() => mail.send(commandAuthority, replyDto(null, {
    contactId: null, attachmentIds: [ids.attachment],
  })), "null send cannot copy a contact-bound file into mailbox-wide scope");
  await assert.rejects(() => runtime.mailSendIntent.update({
    where: { id: standaloneReply.sendId },
    data: { scopeMessageId: null, version: { increment: 1 } },
  }), "SQL protects the immutable inherited source binding");

  await mail.link(commandAuthority, standaloneSource, {
    schemaVersion: 1, workspaceId, commandId: randomUUID(),
    expectedVersion: 1, externalEmail: "standalone@example.org", contactId: hiddenContact,
  });
  for (const sendId of [standaloneReply.sendId, standaloneChild.sendId])
    await assert.rejects(() => mail.sendStatus(ownAuthority, sendId),
      "later source linking must hide every inherited reply from out-of-scope staff");
  await assert.rejects(() => mail.attachmentMetadata(ownAuthority, localUpload),
    "even the uploader cannot bypass lost source scope after binding");
  const ownSent = await mail.messages(ownAuthority, {
    workspaceId, mailboxId: ids.mailbox, folder: "SENT", limit: 100,
  });
  assert(!ownSent.items.some(row => [standaloneReply.sendId, standaloneChild.sendId].includes(row.id)));
  await assert.rejects(() => mail.replySource(commandAuthority, ids.mailbox, null, standaloneSource),
    "queued null replies require source-context revalidation before admission");
  console.log("Standalone mail actual database checks passed: pre-pagination scope, nullable replies, flat inherited ACL, upload binding and immutable guard");

  const richDto = replyDto(null, { contactId: null, text: "client fallback", html: '<p><strong>Привет</strong><img src="https://tracker.example/x"></p>' });
  const richReceipt = await mail.send(commandAuthority, richDto);
  assert.deepEqual(await mail.send(commandAuthority, richDto), richReceipt);
  const richRow = await runtime.mailSendIntent.findUniqueOrThrow({ where: { id: richReceipt.sendId } });
  assert.equal(richRow.html, "<p><strong>Привет</strong></p>");
  assert.equal(richRow.text, "Привет");
  assert(!Object.hasOwn((await mail.message(commandAuthority, richReceipt.sendId)).item, "html"));
  assert.equal((await mail.message(commandAuthority, richReceipt.sendId, undefined, "html")).item.html, richRow.html);
  assert.equal((await mail.message(commandAuthority, standaloneSource, undefined, "html")).item.html, null);
  await assert.rejects(() => mail.send(commandAuthority, { ...richDto, html: "<p>Changed</p>" }));
  await assert.rejects(() => runtime.mailSendIntent.update({ where: { id: richReceipt.sendId }, data: { html: "<p>Changed</p>", version: { increment: 1 } } }));
  console.log("HTML mail actual database checks passed: normalization, immutable body, idempotency and opt-in legacy-compatible detail");

  const foreignWorkspaceContactId = randomUUID();
  const foreignWorkspaceConnectionId = randomUUID();
  const foreignWorkspaceMailboxId = randomUUID();
  await migrator.workspaceClosureFence.upsert({
    where: { workspaceId: otherWorkspaceId },
    create: { workspaceId: otherWorkspaceId },
    update: { fencedAt: null },
  });
  await runtime.contact.create({
    data: {
      id: foreignWorkspaceContactId,
      workspaceId: otherWorkspaceId,
      name: "Foreign workspace mail contact",
      createdBySubject: subject,
    },
  });
  await runtime.mailConnection.create({
    data: {
      id: foreignWorkspaceConnectionId,
      workspaceId: otherWorkspaceId,
      delegatedSubject: subject,
      delegatedMembershipId: membershipId,
      provider: "IMAP_SMTP",
      transport: { imap: {}, smtp: {} },
      authMode: "PASSWORD",
      credentialPrincipal: "foreign@example.org",
      keyId: "fixture-key",
      state: "ACTIVE",
    },
  });
  await runtime.mailMailbox.create({
    data: {
      id: foreignWorkspaceMailboxId,
      workspaceId: otherWorkspaceId,
      connectionId: foreignWorkspaceConnectionId,
      kind: "SHARED",
      canonicalAddress: `reply-foreign-${otherWorkspaceId}@example.org`,
      displayName: "Foreign workspace mailbox",
      imapLogin: "foreign@example.org",
      smtpLogin: "foreign@example.org",
      sendMode: "AS",
      enabled: true,
    },
  });
  await runtime.mailMailboxGrant.create({
    data: {
      id: randomUUID(),
      workspaceId: otherWorkspaceId,
      mailboxId: foreignWorkspaceMailboxId,
      subject,
      membershipId,
      canRead: true,
      canSend: true,
      canManage: true,
    },
  });
  const foreignAuthority = {
    ...commandAuthority,
    customer: { ...commandAuthority.customer, workspaceId: otherWorkspaceId },
  };
  authorities.set(otherWorkspaceId, foreignAuthority);
  for (const sourceId of [ids.message, ids.intent]) {
    const dto = replyDto(sourceId, {
      workspaceId: otherWorkspaceId,
      mailboxId: foreignWorkspaceMailboxId,
      contactId: foreignWorkspaceContactId,
    });
    await assert.rejects(() => mail.send(foreignAuthority, dto));
    assert.equal(
      await runtime.mailSendIntent.count({
        where: { commandId: dto.commandId },
      }),
      0,
      "a reply source from another workspace must not create an intent",
    );
  }

  const auditRow = await runtime.mailAudit.findFirstOrThrow({
    where: { commandId: ids.command },
  });
  for (const mutation of [
    () =>
      runtime.mailMessage.update({
        where: { id: ids.message },
        data: { subject: "tampered" },
      }),
    () => runtime.mailCommand.delete({ where: { commandId: ids.command } }),
    () => runtime.mailAudit.delete({ where: { id: auditRow.id } }),
    () =>
      runtime.mailSendAttachment.delete({
        where: {
          workspaceId_sendId_attachmentId: {
            workspaceId,
            sendId: ids.intent,
            attachmentId: ids.attachment,
          },
        },
      }),
  ])
    await assert.rejects(mutation);

  const otherConnectionId = randomUUID();
  await runtime.mailConnection.create({
    data: {
      id: otherConnectionId,
      workspaceId: otherWorkspaceId,
      delegatedSubject: subject,
      delegatedMembershipId: membershipId,
      provider: "IMAP_SMTP",
      transport: {},
      authMode: "PASSWORD",
      credentialPrincipal: "other@example.org",
      keyId: "fixture-key",
      state: "ACTIVE",
    },
  });
  await assert.rejects(() =>
    runtime.mailMailbox.create({
      data: {
        workspaceId: otherWorkspaceId,
        connectionId: ids.connection,
        kind: "SHARED",
        canonicalAddress: `foreign-${otherWorkspaceId}@example.org`,
        displayName: "Wrong workspace",
        imapLogin: "mail@example.org",
        smtpLogin: "mail@example.org",
        sendMode: "AS",
      },
    }),
  );

  // Exercise the actual service cancellation path: an unadmitted queued send
  // is cancelled when its mailbox is disconnected.
  await mail.disconnect(commandAuthority, ids.mailbox, {
    schemaVersion: 1,
    workspaceId,
    commandId: randomUUID(),
    expectedVersion: 1,
  });
  assert.equal(
    (
      await runtime.mailSendIntent.findUniqueOrThrow({
        where: { id: ids.intent },
      })
    ).state,
    "CANCELLED",
  );
  assert.equal(
    (await runtime.mailJob.findUniqueOrThrow({ where: { id: ids.job } })).state,
    "CANCELLED",
  );

  const createSendFixture = async (id) => {
    const contact = randomUUID();
    const connection = randomUUID();
    const mailbox = randomUUID();
    const intent = randomUUID();
    await migrator.workspaceClosureFence.upsert({
      where: { workspaceId: id },
      create: { workspaceId: id },
      update: { fencedAt: null },
    });
    await runtime.contact.create({
      data: {
        id: contact,
        workspaceId: id,
        name: "Send race contact",
        createdBySubject: subject,
      },
    });
    await runtime.mailConnection.create({
      data: {
        id: connection,
        workspaceId: id,
        delegatedSubject: subject,
        delegatedMembershipId: membershipId,
        provider: "IMAP_SMTP",
        transport: { imap: {}, smtp: {} },
        authMode: "PASSWORD",
        credentialPrincipal: "sender@example.org",
        keyId: "fixture-key",
        state: "ACTIVE",
      },
    });
    await runtime.mailMailbox.create({
      data: {
        id: mailbox,
        workspaceId: id,
        connectionId: connection,
        kind: "PERSONAL",
        ownerSubject: subject,
        ownerMembershipId: membershipId,
        canonicalAddress: `sender-${id}@example.org`,
        displayName: "Send race fixture",
        imapLogin: "sender@example.org",
        smtpLogin: "sender@example.org",
        sendMode: "AS",
        enabled: true,
      },
    });
    await runtime.mailSendIntent.create({
      data: {
        id: intent,
        workspaceId: id,
        mailboxId: mailbox,
        contactId: contact,
        actorSubject: subject,
        membershipId,
        commandId: randomUUID(),
        requestHash: "e".repeat(64),
        mailboxGeneration: 1,
        to: [{ email: "recipient@example.org", name: null }],
        cc: [],
        bcc: [],
        subject: "Admission race",
        text: "Immutable body",
        attachmentIds: [],
        messageId: `<${randomUUID()}@example.org>`,
        state: "QUEUED",
      },
    });
    return { intent, mailbox };
  };

  // Admission locks the fence row before committing SENDING; closure waits.
  const raceWorkspaceId = randomUUID();
  const admitted = await createSendFixture(raceWorkspaceId);
  let admissionHasFenceLock;
  let releaseAdmission;
  const locked = new Promise((resolve) => {
    admissionHasFenceLock = resolve;
  });
  const release = new Promise((resolve) => {
    releaseAdmission = resolve;
  });
  const admission = runtime.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT crm_customers.assert_workspace_open(${raceWorkspaceId}::uuid)`;
    admissionHasFenceLock();
    await release;
    const changed = await tx.mailSendIntent.updateMany({
      where: { id: admitted.intent, state: "QUEUED", dispatchAdmittedAt: null },
      data: {
        state: "SENDING",
        dispatchAdmittedAt: new Date(),
        mimeHash: "f".repeat(64),
        mimeObjectKey: `mail/${raceWorkspaceId}/${admitted.mailbox}/mime-admitted`,
        envelope: { from: "sender@example.org", to: ["recipient@example.org"] },
        version: { increment: 1 },
      },
    });
    assert.equal(changed.count, 1);
  });
  await locked;
  const fenceAfterAdmission = migrator.workspaceClosureFence.update({
    where: { workspaceId: raceWorkspaceId },
    data: {
      closureId: randomUUID(),
      generation: 1n,
      ownerSubject: subject,
      requestedAt: new Date(),
      fencedAt: new Date(),
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  releaseAdmission();
  await Promise.all([admission, fenceAfterAdmission]);
  assert.equal(
    (
      await runtime.mailSendIntent.findUniqueOrThrow({
        where: { id: admitted.intent },
      })
    ).state,
    "SENDING",
  );
  await assert.rejects(() =>
    runtime.mailSendIntent.update({
      where: { id: admitted.intent },
      data: { text: "tampered after admission" },
    }),
  );
  const settled = await runtime.mailSendIntent.updateMany({
    where: { id: admitted.intent, state: "SENDING" },
    data: {
      state: "ACCEPTED",
      accepted: ["recipient@example.org"],
      rejected: [],
      settledAt: new Date(),
      version: { increment: 1 },
    },
  });
  assert.equal(
    settled.count,
    1,
    "admitted SMTP outcome may settle after closure fence",
  );

  // If closure gets the row lock first, later admission fails and stays QUEUED.
  const fenceWorkspaceId = randomUUID();
  const blocked = await createSendFixture(fenceWorkspaceId);
  await migrator.workspaceClosureFence.update({
    where: { workspaceId: fenceWorkspaceId },
    data: {
      closureId: randomUUID(),
      generation: 1n,
      ownerSubject: subject,
      requestedAt: new Date(),
      fencedAt: new Date(),
    },
  });
  await assert.rejects(() =>
    runtime.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT crm_customers.assert_workspace_open(${fenceWorkspaceId}::uuid)`;
      await tx.mailSendIntent.updateMany({
        where: {
          id: blocked.intent,
          state: "QUEUED",
          dispatchAdmittedAt: null,
        },
        data: {
          state: "SENDING",
          dispatchAdmittedAt: new Date(),
          mimeHash: "f".repeat(64),
          mimeObjectKey: `mail/${fenceWorkspaceId}/${blocked.mailbox}/mime-blocked`,
          envelope: {
            from: "sender@example.org",
            to: ["recipient@example.org"],
          },
        },
      });
    }),
  );
  assert.equal(
    (
      await runtime.mailSendIntent.findUniqueOrThrow({
        where: { id: blocked.intent },
      })
    ).state,
    "QUEUED",
  );

  await migrator.workspaceClosureFence.update({
    where: { workspaceId },
    data: {
      closureId: randomUUID(),
      generation: 1n,
      ownerSubject: subject,
      requestedAt: new Date(),
      fencedAt: new Date(),
    },
  });
  await assert.rejects(() =>
    runtime.mailJob.create({
      data: {
        workspaceId,
        mailboxId: ids.mailbox,
        generation: 1,
        kind: "LIVE_SYNC",
        workKey: `fenced:${randomUUID()}`,
        state: "QUEUED",
      },
    }),
  );
  await assert.rejects(
    () =>
      syncMailForNotifications.readNotification(
        secondMembershipAuthority,
        generatedNotificationId,
        { schemaVersion: 1, workspaceId, read: true },
      ),
    /crm_workspace_closed|CRM_WORKSPACE_CLOSED/,
  );
  console.log(
    "Corporate mail PG18: 14 table guards, worker notification eligibility and deduplication, notification scope/read idempotence, strict runtime role, service cancellation, idempotency, workspace FK, admission/fence races, post-fence settlement, immutable content, and append-only ledgers passed.",
  );
} finally {
  await Promise.all([
    runtime.$disconnect(),
    migrator.$disconnect(),
    listener.end(),
  ]);
}
