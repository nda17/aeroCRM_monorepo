import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { ChatAttachmentsFakeStorage } from './chat-attachments-fake-storage.mjs';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/crm-access-client');
const { Client } = require('pg');
const { ForbiddenException } = require('@nestjs/common');
const {
	ChatAttachmentsService
} = require('../../dist/src/workspace-chat/chat-attachments.service.js');
const {
	WorkspaceChatService
} = require('../../dist/src/workspace-chat/workspace-chat.service.js');
const {
	validateChatBytes
} = require('../../dist/src/workspace-chat/chat.objects.js');
assert.equal(process.env.CRM_ACCESS_INTEGRATION_ALLOW_MUTATION, 'true');
const databaseUrl = process.env.CRM_ACCESS_TEST_DATABASE_URL;
const url = new URL(databaseUrl);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.match(url.pathname, /^\/aerocrm_crm_access_test(?:_[a-z0-9]+)*$/);
assert.equal(
	decodeURIComponent(url.username),
	process.env.CRM_ACCESS_TEST_RUNTIME_ROLE
);
assert.equal(url.searchParams.get('schema'), 'crm_access');
const migrationDatabaseUrl = process.env.CRM_ACCESS_TEST_MIGRATION_DATABASE_URL;
assert.ok(migrationDatabaseUrl, 'An isolated migration-role URL is required for PostgreSQL upgrade fixtures');
const migrationUrl = new URL(migrationDatabaseUrl);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(migrationUrl.hostname));
assert.equal(migrationUrl.hostname, url.hostname);
assert.equal(migrationUrl.port, url.port);
assert.equal(migrationUrl.pathname, url.pathname);
assert.equal(migrationUrl.searchParams.get('schema'), 'crm_access');
assert.match(decodeURIComponent(migrationUrl.username), /_migration$/);
assert.notEqual(decodeURIComponent(migrationUrl.username), process.env.CRM_ACCESS_TEST_RUNTIME_ROLE);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const legacyMigration = fs.readFileSync(new URL('../../prisma/migrations/20261007010000_chat_attachments/migration.sql', import.meta.url));
const messengerMigration = fs.readFileSync(new URL('../../prisma/migrations/20261008010000_messenger_storage_prefix/migration.sql', import.meta.url), 'utf8');
const legacyMigrationHash = createHash('sha256').update(legacyMigration).digest('hex');
const messengerMigrationSql = messengerMigration.replaceAll('crm_access.', 'pg_temp.');
const workspaceId = randomUUID();
const owner = {
	workspaceId,
	subject: `attachment-owner-${randomUUID()}`,
	membershipId: randomUUID(),
	role: 'OWNER',
	state: 'ACTIVE',
	permissions: []
};
const first = {
	...owner,
	subject: `attachment-first-${randomUUID()}`,
	membershipId: randomUUID(),
	role: 'MANAGER'
};
const second = {
	...owner,
	subject: `attachment-second-${randomUUID()}`,
	membershipId: randomUUID(),
	role: 'MANAGER'
};
let actor = owner;
const auth = {
	async authorize(_token, id, permission, tx = prisma) {
		if (id !== workspaceId) throw new ForbiddenException();
		if (actor.role !== 'OWNER') {
			const member = await tx.crmWorkspaceMember.findUnique({
				where: { workspaceId_subject: { workspaceId, subject: actor.subject } }
			});
			if (
				!member ||
				member.disabledAt ||
				member.membershipId !== actor.membershipId
			)
				throw new ForbiddenException();
		}
		return { ...actor };
	},
	async assignmentSubject(id, subject) {
		if (id !== workspaceId) throw new ForbiddenException();
		if (subject === owner.subject) return owner;
		const member = await prisma.crmWorkspaceMember.findUnique({
			where: { workspaceId_subject: { workspaceId, subject } }
		});
		if (!member || member.disabledAt) throw new ForbiddenException();
		return {
			...actor,
			subject,
			membershipId: member.membershipId,
			role: member.role
		};
	}
};
const storage = new ChatAttachmentsFakeStorage();
const attachments = new ChatAttachmentsService(prisma, auth, storage);
const chat = new WorkspaceChatService(prisma, auth, attachments);
const token = 'Bearer isolated-fixture';
const cmd = (extra = {}) => ({
	schemaVersion: 1,
	workspaceId,
	commandId: randomUUID(),
	...extra
});
const file = (value = 'attachment contents') => ({
	buffer: Buffer.from(value),
	originalname: 'fixture.txt',
	mimetype: 'text/plain'
});
const statuses =
	(...expected) =>
	error =>
		expected.includes(error.status);
const expiryPast = new Date(Date.now() - 10000);
let room;
async function seedPending(overrides = {}) {
	const id = randomUUID();
	const bytes = Buffer.from('fixture');
	const commandId = randomUUID();
	const row = await prisma.crmChatAttachment.create({
		data: {
			id,
			workspaceId,
			conversationId: room,
			uploadActorMembershipId: owner.membershipId,
			uploadCommandId: commandId,
			subject: owner.subject,
			requestHash: 'a'.repeat(64),
			fileName: 'fixture.txt',
			declaredMime: 'text/plain',
			detectedMime: 'text/plain',
			byteSize: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			privateObjectKey: storage.key(workspaceId, room, id),
			state: 'UPLOADING',
			expiresAt: new Date(Date.now() + 86400000),
			...overrides
		}
	});
	return row;
}
async function expireLease(id) {
	const row = await prisma.crmChatAttachment.findUniqueOrThrow({
		where: { id }
	});
	return prisma.crmChatAttachment.update({
		where: { id, version: row.version },
		data: { version: { increment: 1 }, leaseUntil: expiryPast }
	});
}
try {
	const rows =
		await prisma.$queryRaw`SELECT current_user AS name,current_setting('server_version_num')::int AS version,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,pg_get_userbyid(nspowner)<>current_user AS not_owner FROM pg_roles JOIN pg_namespace ON nspname='crm_access' WHERE rolname=current_user`;
	assert.equal(rows[0].name, process.env.CRM_ACCESS_TEST_RUNTIME_ROLE);
	assert.ok(rows[0].version >= 180000 && rows[0].version < 190000);
	assert.equal(legacyMigrationHash, '20fd09e316cc877c0b2424be269f4fe7ca56e1b8996bc083bd631087d88eb019', 'the original Chat attachment migration is immutable');
	// Run the additive upgrade against temporary tables on PostgreSQL, leaving the
	// migrated application schema and its data untouched.
	const migrationConnectionUrl = new URL(migrationDatabaseUrl);
	migrationConnectionUrl.searchParams.delete('schema');
	const migrationDb = new Client({ connectionString: migrationConnectionUrl.toString() });
	await migrationDb.connect();
	try {
		await migrationDb.query(`CREATE TEMP TABLE crm_chat_attachments (
			id uuid NOT NULL, workspace_id uuid NOT NULL, conversation_id uuid NOT NULL,
			private_object_key varchar(200) NOT NULL,
			CONSTRAINT crm_chat_attachments_private_object_key_check CHECK(private_object_key='chat/'||workspace_id::text||'/'||conversation_id::text||'/'||id::text),
			state varchar(16) NOT NULL
		)`);
		await migrationDb.query('CREATE TEMP TABLE crm_team_command_receipts (command_type varchar(64) NOT NULL)');
		for (const state of ['UPLOADING', 'READY', 'ATTACHED', 'DELETING', 'DELETED']) {
			const id = randomUUID();
			await migrationDb.query('INSERT INTO pg_temp.crm_chat_attachments (id,workspace_id,conversation_id,private_object_key,state) VALUES ($1,$2,$3,$4,$5)', [id, workspaceId, owner.membershipId, `chat/${workspaceId}/${owner.membershipId}/${id}`, state]);
			await assert.rejects(migrationDb.query(messengerMigrationSql), /requires empty attachment history/);
			await migrationDb.query('ROLLBACK');
			await migrationDb.query('DELETE FROM pg_temp.crm_chat_attachments');
		}
		await migrationDb.query("INSERT INTO pg_temp.crm_team_command_receipts(command_type) VALUES ('chat.upload')");
		await assert.rejects(migrationDb.query(messengerMigrationSql), /requires no chat.upload receipts/);
		await migrationDb.query('ROLLBACK');
		await migrationDb.query('DELETE FROM pg_temp.crm_team_command_receipts');
		await migrationDb.query(messengerMigrationSql);
		const check = await migrationDb.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='pg_temp.crm_chat_attachments'::regclass AND conname='crm_chat_attachments_private_object_key_check'");
		assert.match(check.rows[0].definition, /messenger/);
		const rejectedId = randomUUID();
		await assert.rejects(migrationDb.query('INSERT INTO pg_temp.crm_chat_attachments (id,workspace_id,conversation_id,private_object_key,state) VALUES ($1,$2,$3,$4,$5)', [rejectedId, workspaceId, owner.membershipId, `chat/${workspaceId}/${owner.membershipId}/${rejectedId}`, 'UPLOADING']));
		const acceptedId = randomUUID();
		await migrationDb.query('INSERT INTO pg_temp.crm_chat_attachments (id,workspace_id,conversation_id,private_object_key,state) VALUES ($1,$2,$3,$4,$5)', [acceptedId, workspaceId, owner.membershipId, `messenger/${workspaceId}/${owner.membershipId}/${acceptedId}`, 'UPLOADING']);
	} finally {
		await migrationDb.end();
	}
	for (const key of [
		'rolsuper',
		'rolcreatedb',
		'rolcreaterole',
		'rolinherit',
		'rolreplication',
		'rolbypassrls'
	])
		assert.equal(rows[0][key], false);
	assert.equal(rows[0].not_owner, true);
	const grants =
		await prisma.$queryRaw`SELECT has_table_privilege(current_user,'crm_access.crm_chat_attachments','SELECT') AS can_read,has_table_privilege(current_user,'crm_access.crm_chat_attachments','INSERT') AS can_insert,has_table_privilege(current_user,'crm_access.crm_chat_attachments','UPDATE') AS can_update,has_table_privilege(current_user,'crm_access.crm_chat_attachments','DELETE') AS can_delete`;
	assert.deepEqual(grants[0], {
		can_read: true,
		can_insert: true,
		can_update: true,
		can_delete: false
	});
	await prisma.crmWorkspaceAccess.create({
		data: {
			workspaceId,
			lifecycle: 'ACTIVE',
			activatedBySubject: owner.subject,
			billingEntitlementId: randomUUID(),
			provisioningCommandId: randomUUID(),
			provisioningCommandType: 'START_TRIAL',
			onboardingCommandId: randomUUID(),
			onboardingTemplateKey: 'universal-sales',
			onboardingTemplateVersion: 1,
			onboardingTemplateFingerprint: 'b'.repeat(64),
			onboardingPipelineId: randomUUID(),
			onboardingCompletedAt: new Date()
		}
	});
	await prisma.crmWorkspaceMember.createMany({
		data: [first, second].map(person => ({
			workspaceId,
			subject: person.subject,
			membershipId: person.membershipId,
			role: person.role
		}))
	});
	room = (
		await prisma.crmChatConversation.findFirstOrThrow({
			where: { workspaceId, kind: 'WORKSPACE' }
		})
	).id;
	const caps = await attachments.capabilities(token, workspaceId);
	assert.equal(caps.enabled, true);
	assert.equal(caps.maxFileBytes, 5242880);
	// Admission rejects validation/READ_ONLY before storage and quota reservation.
	const putStart = storage.calls.put;
	await assert.rejects(
		attachments.upload(token, room, cmd(), {
			...file(),
			originalname: 'x.html',
			mimetype: 'text/html'
		}),
		statuses(400)
	);
	await assert.rejects(
		validateChatBytes(Buffer.from('MZ executable'), 'x.txt', 'text/plain')
	);
	await assert.rejects(
		validateChatBytes(Buffer.alloc(5242881), 'x.txt', 'text/plain')
	);
	actor = { ...owner, state: 'READ_ONLY' };
	await assert.rejects(
		attachments.upload(token, room, cmd(), file()),
		statuses(403)
	);
	assert.equal(storage.calls.put, putStart);
	actor = owner;
	const uploadCommand = cmd();
	let storedKey;
	storage.afterPut = async key => {
		storedKey = key;
		throw new Error('PUT_STORED_RESPONSE_UNKNOWN');
	};
	await assert.rejects(
		attachments.upload(token, room, uploadCommand, file()),
		/PUT_STORED_RESPONSE_UNKNOWN/
	);
	storage.afterPut = undefined;
	const pending = await attachments.lookup(
		token,
		workspaceId,
		uploadCommand.commandId
	);
	assert.equal(pending.attachment.state, 'UPLOADING');
	assert.ok(storage.objects.has(storedKey));
	await assert.rejects(
		attachments.upload(token, room, uploadCommand, file()),
		statuses(409)
	);
	await expireLease(pending.attachment.id);
	const ready = await attachments.upload(token, room, uploadCommand, file());
	assert.equal(ready.attachment.id, pending.attachment.id);
	assert.equal(storage.objects.size, 1);
	assert.equal(storage.key(workspaceId, room, ready.attachment.id), storedKey);
	const puts = storage.calls.put;
	assert.deepEqual(
		await attachments.upload(token, room, uploadCommand, file()),
		ready
	);
	assert.equal(storage.calls.put, puts);
	await assert.rejects(
		attachments.upload(token, room, uploadCommand, file('changed')),
		statuses(409)
	);
	assert.equal(
		await prisma.crmTeamCommandReceipt.count({
			where: { commandId: uploadCommand.commandId }
		}),
		1
	);
	actor = first;
	assert.equal(
		(await attachments.lookup(token, workspaceId, uploadCommand.commandId))
			.attachment,
		null
	);
	await assert.rejects(
		chat.send(token, room, {
			...cmd(),
			schemaVersion: 2,
			text: 'foreign',
			attachmentIds: [ready.attachment.id]
		}),
		statuses(409)
	);
	await assert.rejects(
		attachments.content(token, workspaceId, ready.attachment.id),
		statuses(404)
	);
	actor = owner;
	const messageCommand = {
		...cmd(),
		schemaVersion: 2,
		text: '',
		attachmentIds: [ready.attachment.id]
	};
	const sent = await chat.send(token, room, messageCommand);
	assert.equal(sent.schemaVersion, 2);
	assert.equal(sent.item.text, 'Вложения');
	assert.equal(sent.item.attachments.length, 1);
	assert.deepEqual(await chat.send(token, room, messageCommand), sent);
	assert.equal(
		(await chat.sendLookup(token, room, workspaceId, messageCommand.commandId))
			.status,
		'COMMITTED'
	);
	assert.equal(
		(await chat.messages(token, room, { workspaceId, limit: 50 })).items.at(-1)
			.text,
		'Вложения'
	);
	assert.equal(
		(await chat.messagesV2(token, room, { workspaceId, limit: 50 })).items.at(
			-1
		).attachments[0].id,
		ready.attachment.id
	);
	assert.equal(
		(
			await attachments.content(token, workspaceId, ready.attachment.id)
		).bytes.toString(),
		'attachment contents'
	);
	storage.objects.set(storedKey, Buffer.from('corrupt'));
	await assert.rejects(
		attachments.content(token, workspaceId, ready.attachment.id),
		statuses(503)
	);
	storage.objects.set(storedKey, file().buffer);
	await assert.rejects(
		attachments.discard(token, ready.attachment.id, cmd()),
		statuses(409)
	);
	await assert.rejects(
		prisma.crmChatAttachment.update({
			where: { id: ready.attachment.id },
			data: { version: { increment: 1 }, state: 'DELETED', messageId: null }
		})
	);
	// An owner cannot open employees' private DM; reinvitation does not inherit binding.
	actor = first;
	const direct = await chat.direct(
		token,
		cmd({ recipientSubject: second.subject })
	);
	const dm = direct.conversation.id;
	const privateUpload = await attachments.upload(
		token,
		dm,
		cmd(),
		file('private DM')
	);
	const privateMessage = await chat.send(token, dm, {
		...cmd(),
		schemaVersion: 2,
		text: '',
		attachmentIds: [privateUpload.attachment.id]
	});
	actor = owner;
	const beforeGet = storage.calls.get;
	await assert.rejects(
		attachments.content(token, workspaceId, privateUpload.attachment.id),
		statuses(404)
	);
	await assert.rejects(
		attachments.upload(token, dm, cmd(), file()),
		statuses(404)
	);
	assert.equal(storage.calls.get, beforeGet);
	actor = second;
	assert.equal(
		(
			await attachments.content(token, workspaceId, privateUpload.attachment.id)
		).bytes.toString(),
		'private DM'
	);
	const newMembership = randomUUID();
	await prisma.crmWorkspaceMember.update({
		where: { workspaceId_subject: { workspaceId, subject: second.subject } },
		data: { membershipId: newMembership }
	});
	actor = { ...second, membershipId: newMembership };
	await assert.rejects(
		attachments.content(token, workspaceId, privateUpload.attachment.id),
		statuses(404)
	);
	actor = first;
	await assert.rejects(
		chat.send(token, dm, {
			...cmd(),
			schemaVersion: 2,
			text: 'peer changed',
			attachmentIds: []
		}),
		statuses(403)
	);
	actor = { ...owner, state: 'READ_ONLY' };
	await assert.rejects(chat.send(token, room, messageCommand), statuses(403));
	assert.equal(
		(
			await attachments.content(token, workspaceId, ready.attachment.id)
		).bytes.toString(),
		'attachment contents'
	);
	await assert.rejects(
		attachments.discard(token, privateUpload.attachment.id, cmd()),
		statuses(403)
	);
	await assert.rejects(
		attachments.capabilities(token, randomUUID()),
		statuses(403)
	);
	actor = owner;
	// Actor/workspace quotas are durable admission constraints, before PUT.
	const quotaRows = [];
	for (let n = 0; n < 19; n++) quotaRows.push(await seedPending());
	const quotaRace = await Promise.allSettled([
		attachments.upload(token, room, cmd(), file()),
		attachments.upload(token, room, cmd(), file())
	]);
	assert.equal(
		quotaRace.filter(result => result.status === 'fulfilled').length,
		1,
		JSON.stringify(
			quotaRace.map(result =>
				result.status === 'rejected'
					? {
							status: result.reason.status,
							code: result.reason.code,
							message: result.reason.message
						}
					: result.status
			)
		)
	);
	assert.equal(
		quotaRace.filter(
			result => result.status === 'rejected' && result.reason.status === 409
		).length,
		1,
		JSON.stringify(
			quotaRace.map(result =>
				result.status === 'rejected'
					? {
							status: result.reason.status,
							code: result.reason.code,
							message: result.reason.message
						}
					: result.status
			)
		)
	);
	quotaRows.push(
		await prisma.crmChatAttachment.findUniqueOrThrow({
			where: {
				id: quotaRace.find(result => result.status === 'fulfilled').value
					.attachment.id
			}
		})
	);
	const quotaPuts = storage.calls.put;
	await assert.rejects(
		attachments.upload(token, room, cmd(), file()),
		statuses(409)
	);
	assert.equal(storage.calls.put, quotaPuts);
	for (const row of quotaRows) {
		await prisma.crmChatAttachment.update({
			where: { id: row.id, version: row.version },
			data: { state: 'DELETING', version: { increment: 1 } }
		});
	}
	await attachments.sweep();
	assert.equal(
		await prisma.crmChatAttachment.count({
			where: { id: { in: quotaRows.map(row => row.id) }, state: 'DELETED' }
		}),
		20
	);
	// 50MiB actor reservation is independent from 20-file count.
	const byteQuota = [];
	for (let n = 0; n < 10; n++)
		byteQuota.push(await seedPending({ byteSize: 5242880 }));
	const byteQuotaPuts = storage.calls.put;
	await assert.rejects(
		attachments.upload(token, room, cmd(), file()),
		statuses(409)
	);
	assert.equal(storage.calls.put, byteQuotaPuts);
	for (const row of byteQuota)
		await prisma.crmChatAttachment.update({
			where: { id: row.id, version: row.version },
			data: { state: 'DELETING', version: { increment: 1 } }
		});
	await attachments.sweep();
	// Expired READY loses send race, is deleted, and ATTACHED rows remain retained.
	const expired = await seedPending({ expiresAt: expiryPast });
	await prisma.crmChatAttachment.update({
		where: { id: expired.id, version: 1 },
		data: { state: 'READY', version: { increment: 1 } }
	});
	storage.objects.set(expired.privateObjectKey, Buffer.from('fixture'));
	const [sendRace] = await Promise.allSettled([
		chat.send(token, room, {
			...cmd(),
			schemaVersion: 2,
			text: 'expired',
			attachmentIds: [expired.id]
		}),
		attachments.sweep()
	]);
	assert.equal(sendRace.status, 'rejected');
	assert.equal(
		(
			await prisma.crmChatAttachment.findUniqueOrThrow({
				where: { id: expired.id }
			})
		).state,
		'DELETED'
	);
	assert.equal(
		(
			await prisma.crmChatAttachment.findUniqueOrThrow({
				where: { id: ready.attachment.id }
			})
		).state,
		'ATTACHED'
	);
	assert.ok(storage.objects.has(storedKey));
	const discarded = await attachments.upload(
		token,
		room,
		cmd(),
		file('discarded')
	);
	await attachments.discard(token, discarded.attachment.id, cmd());
	storage.beforeDelete = async () => {
		throw new Error('DELETE_FAILED');
	};
	await attachments.sweep();
	assert.equal(
		(
			await prisma.crmChatAttachment.findUniqueOrThrow({
				where: { id: discarded.attachment.id }
			})
		).state,
		'DELETING'
	);
	storage.beforeDelete = undefined;
	await expireLease(discarded.attachment.id);
	await attachments.sweep();
	assert.equal(
		(
			await prisma.crmChatAttachment.findUniqueOrThrow({
				where: { id: discarded.attachment.id }
			})
		).state,
		'DELETED'
	);
	// Cancel after PUT starts fences READY and preserves lease until safe deletion.
	const lateCommand = cmd();
	let unblock;
	const blocked = new Promise(resolve => {
		unblock = resolve;
	});
	let entered;
	const started = new Promise(resolve => {
		entered = resolve;
	});
	storage.beforePut = async () => {
		entered();
		await blocked;
	};
	const lateUpload = attachments.upload(
		token,
		room,
		lateCommand,
		file('late PUT')
	);
	await started;
	const late = (
		await attachments.lookup(token, workspaceId, lateCommand.commandId)
	).attachment;
	assert.equal(
		(await attachments.discard(token, late.id, cmd())).attachment.state,
		'DELETING'
	);
	await attachments.sweep();
	assert.equal(
		(
			await prisma.crmChatAttachment.findUniqueOrThrow({
				where: { id: late.id }
			})
		).state,
		'DELETING'
	);
	unblock();
	await assert.rejects(lateUpload, statuses(409));
	storage.beforePut = undefined;
	await expireLease(late.id);
	await attachments.sweep();
	assert.equal(
		(
			await prisma.crmChatAttachment.findUniqueOrThrow({
				where: { id: late.id }
			})
		).state,
		'DELETED'
	);
	assert.equal(
		storage.objects.has(storage.key(workspaceId, room, late.id)),
		false
	);

	// Fenced expired metadata is excluded before LIMIT and cannot starve eligible rows.
	const closedWorkspaceId = randomUUID();
	await prisma.crmWorkspaceAccess.create({
		data: {
			workspaceId: closedWorkspaceId,
			lifecycle: 'ACTIVE',
			activatedBySubject: owner.subject,
			billingEntitlementId: randomUUID(),
			provisioningCommandId: randomUUID(),
			provisioningCommandType: 'START_TRIAL',
			onboardingCommandId: randomUUID(),
			onboardingTemplateKey: 'universal-sales',
			onboardingTemplateVersion: 1,
			onboardingTemplateFingerprint: 'b'.repeat(64),
			onboardingPipelineId: randomUUID(),
			onboardingCompletedAt: new Date()
		}
	});
	const closedRoom = (
		await prisma.crmChatConversation.findFirstOrThrow({
			where: { workspaceId: closedWorkspaceId, kind: 'WORKSPACE' }
		})
	).id;
	const closedRows = [];
	for (let n = 0; n < 101; n++) {
		const id = randomUUID();
		const row = await seedPending({
			id,
			workspaceId: closedWorkspaceId,
			conversationId: closedRoom,
			expiresAt: new Date(Date.now() - 86400000),
			privateObjectKey: storage.key(closedWorkspaceId, closedRoom, id)
		});
		closedRows.push(row);
		storage.objects.set(row.privateObjectKey, Buffer.from('fixture'));
	}
	const fence = await prisma.workspaceClosureFence.findUniqueOrThrow({
		where: { workspaceId: closedWorkspaceId }
	});
	await prisma.workspaceClosureFence.update({
		where: { workspaceId: closedWorkspaceId },
		data: {
			revision: fence.revision + 1n,
			closureId: randomUUID(),
			generation: 1n,
			ownerSubject: owner.subject,
			requestedAt: new Date(),
			fencedAt: new Date()
		}
	});
	const eligible = await seedPending({ expiresAt: expiryPast });
	storage.objects.set(eligible.privateObjectKey, Buffer.from('fixture'));
	const listBefore = storage.calls.candidates;
	await attachments.sweep();
	assert.ok(storage.calls.candidates > listBefore);
	assert.equal(
		(
			await prisma.crmChatAttachment.findUniqueOrThrow({
				where: { id: eligible.id }
			})
		).state,
		'DELETED'
	);
	assert.equal(
		await prisma.crmChatAttachment.count({
			where: { workspaceId: closedWorkspaceId, state: 'UPLOADING' }
		}),
		101
	);
	assert.ok(storage.objects.has(closedRows[0].privateObjectKey));
	await assert.rejects(
		prisma.crmChatAttachment.update({
			where: { id: closedRows[0].id, version: closedRows[0].version },
			data: { state: 'DELETING', version: { increment: 1 } }
		})
	);

	// Bounded paged orphan scan removes only old unowned chat objects.
	const oldDate = new Date(Date.now() - 90000000);
	const oldOrphan = storage.key(workspaceId, room, randomUUID());
	const currentOrphan = storage.key(workspaceId, room, randomUUID());
	const foreignKey = `mail/${workspaceId}/${room}/${randomUUID()}`;
	const malformedChat = 'chat/foreign-prefix/secret';
	for (const key of [
		oldOrphan,
		currentOrphan,
		foreignKey,
		malformedChat,
		expired.privateObjectKey
	])
		storage.objects.set(key, Buffer.from('orphan fixture'));
	for (const key of [
		oldOrphan,
		foreignKey,
		malformedChat,
		expired.privateObjectKey,
		storedKey
	])
		storage.objectDates.set(key, oldDate);
	storage.objectDates.set(currentOrphan, new Date());
	for (let page = 0; page < 4; page++) await attachments.sweep();
	assert.equal(storage.objects.has(oldOrphan), false);
	assert.equal(
		storage.objects.has(expired.privateObjectKey),
		false,
		'late PUT to DELETED metadata is not live'
	);
	assert.equal(
		storage.objects.has(storedKey),
		true,
		'ATTACHED retention wins even for old object'
	);
	assert.equal(
		storage.objects.has(currentOrphan),
		true,
		'fresh orphan remains within 24h upload window'
	);
	assert.equal(
		storage.objects.has(foreignKey),
		true,
		'mail prefix never touched'
	);
	assert.equal(
		storage.objects.has(malformedChat),
		true,
		'unknown malformed chat prefix never touched'
	);
	// Metadata cannot be rebound or point outside the chat private prefix.
	const legacyPrefixId = randomUUID();
	await assert.rejects(
		seedPending({
			id: legacyPrefixId,
			privateObjectKey: `chat/${workspaceId}/${room}/${legacyPrefixId}`
		})
	);
	await assert.rejects(
		seedPending({ privateObjectKey: 'mail/foreign/secret' })
	);
	await assert.rejects(
		prisma.crmChatAttachment.update({
			where: { id: ready.attachment.id },
			data: { version: { increment: 1 }, fileName: 'rebound.txt' }
		})
	);
	// Retained workspace quota is enforced across distinct upload memberships.
	const workspaceRows = [];
	for (let n = 0; n < 205; n++)
		workspaceRows.push(
			await seedPending({
				uploadActorMembershipId: randomUUID(),
				byteSize: 5242880
			})
		);
	const workspaceQuotaPuts = storage.calls.put;
	await assert.rejects(
		attachments.upload(token, room, cmd(), file()),
		statuses(409)
	);
	assert.equal(storage.calls.put, workspaceQuotaPuts);
	for (const row of workspaceRows)
		await prisma.crmChatAttachment.update({
			where: { id: row.id, version: row.version },
			data: { state: 'DELETING', version: { increment: 1 } }
		});
	await attachments.sweep();
	await attachments.sweep();
	await attachments.sweep();
	assert.equal(
		await prisma.crmChatAttachment.count({
			where: { id: { in: workspaceRows.map(row => row.id) }, state: 'DELETED' }
		}),
		205
	);
	assert.equal(
		await prisma.crmChatMessage.count({ where: { id: sent.item.id } }),
		1
	);
	assert.equal(
		await prisma.crmChatMessage.count({
			where: { id: privateMessage.item.id }
		}),
		1
	);
	console.log(
		'PASS chat attachments PostgreSQL 18: runtime ACL, validation/admission, durable quota, unknown PUT replay stable identity, atomic READY send/file-only/v1/replay, private DM/owner/current membership/READ_ONLY, expiry/send race, cancel/late PUT fencing, delete retry, immutable metadata/private key'
	);
} catch (error) {
	console.error({
		name: error.name,
		code: error.code,
		sqlState: error.meta?.code,
		message: String(error.message)
			.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted-url]')
			.slice(-1000)
	});
	process.exitCode = 1;
} finally {
	attachments.onModuleDestroy();
	await prisma.$disconnect();
}
