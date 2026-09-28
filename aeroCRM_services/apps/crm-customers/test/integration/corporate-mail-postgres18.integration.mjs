import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

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
const runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
const migrator = new PrismaClient({
  datasources: { db: { url: migrationUrl } },
});
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
try {
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
  ];
  const guards = await runtime.$queryRawUnsafe(
    `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='crm_customers' AND t.tgname='mail_write_guard' AND NOT t.tgisinternal ORDER BY c.relname`,
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
    { workflow: async () => commandAuthority },
    new MailConfig(),
    {},
    {},
  );
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
  console.log(
    "Corporate mail PG18: 12 table guards, strict runtime role, service cancellation, idempotency, workspace FK, admission/fence races, post-fence settlement, immutable content, and append-only ledgers passed.",
  );
} finally {
  await Promise.all([runtime.$disconnect(), migrator.$disconnect()]);
}
