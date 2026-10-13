import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { ChatAttachmentsFakeStorage } from './chat-attachments-fake-storage.mjs';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/crm-access-client');
const { Client } = require('pg');
const {
	TelegramBusinessWebhook
} = require('../../dist/src/telegram-business/telegram-business.webhook.js');
const {
	TelegramBusinessService
} = require('../../dist/src/telegram-business/telegram-business.service.js');
const {
	ChatAttachmentsService
} = require('../../dist/src/workspace-chat/chat-attachments.service.js');
const {
	CrmAccessHealthService
} = require('../../dist/src/health/crm-access-health.service.js');
assert.equal(process.env.CRM_ACCESS_INTEGRATION_ALLOW_MUTATION, 'true');
const url = new URL(process.env.CRM_ACCESS_TEST_DATABASE_URL);
const migrationUrl = new URL(
	process.env.CRM_ACCESS_TEST_MIGRATION_DATABASE_URL
);
for (const candidate of [url, migrationUrl]) {
	assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(candidate.hostname));
	assert.match(
		candidate.pathname,
		/^\/aerocrm_crm_access_test(?:_[a-z0-9]+)*$/
	);
	assert.equal(candidate.searchParams.get('schema'), 'crm_access');
}
assert.equal(url.username, process.env.CRM_ACCESS_TEST_RUNTIME_ROLE);
assert.match(migrationUrl.username, /_migration$/);
assert.equal(url.host, migrationUrl.host);
assert.equal(url.pathname, migrationUrl.pathname);
const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
const migration = new Client({ connectionString: migrationUrl.href });
const daysAgo = days => new Date(Date.now() - days * 86400000);
const hash = value => createHash('sha256').update(value).digest('hex');
const fixtureId = randomUUID();
let sequence = BigInt(Date.now()) * 1000n;
const objects = new ChatAttachmentsFakeStorage();
const previousGate = process.env.CRM_ACCESS_RETENTION_ENABLED;
process.env.CRM_ACCESS_RETENTION_ENABLED = 'true';
const attachments = new ChatAttachmentsService(prisma, {}, objects);
const claim = () =>
	prisma.$queryRaw`SELECT id,workspace_id AS "workspaceId",private_object_key AS "key",version,lease_owner AS "leaseOwner" FROM crm_access.claim_closed_chat_attachments()`;
const complete = async row =>
	(
		await prisma.$queryRaw`SELECT crm_access.complete_closed_chat_attachment(${row.id}::uuid,${row.leaseOwner}::uuid,${row.version}::integer) AS completed`
	)[0].completed;
const retire = async () => {
	const result = (
		await prisma.$queryRaw`SELECT crm_access.retire_telegram_technical_data() AS result`
	)[0].result;
	for (const value of Object.values(result))
		assert.ok(Number.isInteger(value) && value >= 0 && value <= 100);
	return result;
};
async function workspace() {
	const id = randomUUID();
	const actor = {
		workspaceId: id,
		subject: `retention-${randomUUID()}`,
		membershipId: randomUUID(),
		role: 'OWNER',
		state: 'ACTIVE',
		permissions: []
	};
	await prisma.crmWorkspaceAccess.create({
		data: {
			workspaceId: id,
			lifecycle: 'ACTIVE',
			activatedBySubject: actor.subject,
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
	const room = await prisma.crmChatConversation.findFirstOrThrow({
		where: { workspaceId: id, kind: 'WORKSPACE' }
	});
	const channel = await prisma.telegramChannel.create({
		data: {
			workspaceId: id,
			ownerUserId: randomUUID().replaceAll('-', ''),
			ownerName: 'Fixture owner',
			connectionId: randomUUID(),
			status: 'ACTIVE',
			canReply: true
		}
	});
	const dialog = await prisma.telegramDialog.create({
		data: {
			workspaceId: id,
			channelId: channel.id,
			providerChatId: randomUUID().slice(0, 30),
			peerName: 'Fixture peer'
		}
	});
	return { id, actor, room: room.id, channel, dialog };
}
async function close(space, age, state = 'CLOSED') {
	const id = randomUUID();
	const at = daysAgo(age);
	await prisma.$executeRaw`INSERT INTO crm_access.crm_workspace_closures(id,workspace_id,command_id,owner_subject,owner_membership_id,request_hash,state,participants,requested_at,closed_at)
  VALUES(${id}::uuid,${space.id}::uuid,${randomUUID()}::uuid,${space.actor.subject},${space.actor.membershipId}::uuid,${'a'.repeat(64)},${state},'{}'::jsonb,${at},${state === 'CLOSED' ? at : null})`;
	await prisma.$executeRaw`UPDATE crm_access.workspace_closure_fences SET revision=revision+1,closure_id=${id}::uuid,generation=1,owner_subject=${space.actor.subject},requested_at=${at},fenced_at=${at} WHERE workspace_id=${space.id}::uuid`;
}
async function attachment(
	space,
	state = 'READY',
	messageId = null,
	leaseUntil = null
) {
	const id = randomUUID();
	const key = objects.key(space.id, space.room, id);
	await prisma.crmChatAttachment.create({
		data: {
			id,
			workspaceId: space.id,
			conversationId: space.room,
			uploadActorMembershipId: space.actor.membershipId,
			uploadCommandId: randomUUID(),
			subject: space.actor.subject,
			requestHash: 'b'.repeat(64),
			fileName: 'retention.txt',
			declaredMime: 'text/plain',
			detectedMime: 'text/plain',
			byteSize: 7,
			sha256: hash('fixture'),
			privateObjectKey: key,
			state,
			messageId,
			expiresAt: daysAgo(40),
			leaseOwner: leaseUntil ? randomUUID() : null,
			leaseUntil
		}
	});
	objects.objects.set(key, Buffer.from('fixture'));
	objects.objectDates.set(key, daysAgo(40));
	return { id, key };
}
async function dispatch(space, state) {
	const source = await prisma.telegramMessage.create({
		data: {
			workspaceId: space.id,
			channelId: space.channel.id,
			dialogId: space.dialog.id,
			providerChatId: space.dialog.providerChatId,
			providerMessageId: randomUUID().slice(0, 30),
			direction: 'INBOUND',
			origin: 'CUSTOMER',
			contentKind: 'TEXT',
			authorName: 'Fixture peer',
			text: 'source'
		}
	});
	const message = await prisma.telegramMessage.create({
		data: {
			workspaceId: space.id,
			channelId: space.channel.id,
			dialogId: space.dialog.id,
			providerChatId: space.dialog.providerChatId,
			direction: 'OUTBOUND',
			origin: 'CRM',
			contentKind: 'TEXT',
			authorName: 'Fixture owner',
			text: 'outbound',
			deliveryStatus: state
		}
	});
	const row = await prisma.telegramDelivery.create({
		data: {
			commandId: randomUUID(),
			workspaceId: space.id,
			actorSubject: space.actor.subject,
			actorMembershipId: space.actor.membershipId,
			requestHash: 'c'.repeat(64),
			sourceMessageId: source.id,
			messageId: message.id,
			channelId: space.channel.id,
			channelGeneration: 1,
			dialogId: space.dialog.id,
			connectionId: space.channel.connectionId,
			providerChatId: space.dialog.providerChatId,
			state,
			leaseToken: state === 'SENDING' ? randomUUID() : null,
			leaseUntil: state === 'SENDING' ? daysAgo(1) : null,
			dispatchAdmittedAt:
				state === 'SENDING' || state === 'UNKNOWN' ? daysAgo(32) : null
		}
	});
	return { row, message, source };
}
// Only the fixture owner can simulate elapsed lease time. The ordinary runtime
// is explicitly denied both this DDL and direct closed-workspace mutation.
async function elapseLease(id) {
	await migration.query('BEGIN');
	try {
		await migration.query(
			'ALTER TABLE crm_access.crm_chat_attachments DISABLE TRIGGER workspace_closure_business_guard'
		);
		await migration.query(
			"UPDATE crm_access.crm_chat_attachments SET lease_until=now()-interval '1 minute',version=version+1 WHERE id=$1 AND state='DELETING'",
			[id]
		);
		await migration.query(
			'ALTER TABLE crm_access.crm_chat_attachments ENABLE TRIGGER workspace_closure_business_guard'
		);
		await migration.query('COMMIT');
	} catch (error) {
		await migration.query('ROLLBACK');
		throw error;
	}
}
try {
	await prisma.$connect();
	await migration.connect();
	const health = new CrmAccessHealthService(
		prisma,
		{ isReady: () => true },
		{ isReady: () => true },
		undefined,
		attachments
	);
	assert.equal((await health.readiness()).status, 'ready');
	const [identity] =
		await prisma.$queryRaw`SELECT current_user AS role,current_setting('server_version_num')::integer AS version,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
	assert.equal(identity.role, url.username);
	assert.ok(identity.version >= 180000 && identity.version < 190000);
	for (const key of [
		'rolsuper',
		'rolcreatedb',
		'rolcreaterole',
		'rolinherit',
		'rolreplication',
		'rolbypassrls'
	])
		assert.equal(identity[key], false);
	const [permissions] = await prisma.$queryRaw`SELECT
  has_function_privilege(current_user,'crm_access.retire_telegram_technical_data()','EXECUTE') AS retire,
  has_function_privilege(current_user,'crm_access.claim_closed_chat_attachments()','EXECUTE') AS claim,
  has_function_privilege(current_user,'crm_access.complete_closed_chat_attachment(uuid,uuid,integer)','EXECUTE') AS complete,
  has_table_privilege(current_user,'crm_access.telegram_webhook_inbox','DELETE') AS inbox_delete,
  has_table_privilege(current_user,'crm_access.crm_chat_attachments','DELETE') AS attachment_delete`;
	assert.deepEqual(permissions, {
		retire: true,
		claim: true,
		complete: true,
		inbox_delete: false,
		attachment_delete: false
	});
	const unexpectedGrants =
		await prisma.$queryRaw`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
  LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  WHERE n.nspname='crm_access' AND p.proname IN ('retire_telegram_technical_data','claim_closed_chat_attachments','complete_closed_chat_attachment')
  AND (acl.grantee=0 OR pg_get_userbyid(acl.grantee) LIKE '%_backup')`;
	assert.deepEqual(unexpectedGrants, []);
	await assert.rejects(
		prisma.$executeRaw`ALTER TABLE crm_access.crm_chat_attachments DISABLE TRIGGER workspace_closure_business_guard`
	);
	await assert.rejects(
		prisma.$queryRaw`SELECT * FROM foreign_service_guard.sentinel`
	);

	const open = await workspace();
	const closed = await workspace();
	const young = await workspace();
	const closing = await workspace();
	const auth = {
		authorize: async () => open.actor,
		assignmentSubject: async () => open.actor
	};
	const bot = {
		configured: true,
		secret: 'synthetic-retention-only',
		username: 'fixture_bot',
		enabled: true,
		botKey: () => fixtureId
	};
	const telegram = new TelegramBusinessService(prisma, auth, bot);
	const createCommand = { workspaceId: open.id, commandId: randomUUID() };
	const created = await telegram.createSession('Bearer fixture', createCommand);
	await prisma.telegramConnectSession.update({
		where: { id: created.item.id },
		data: {
			expiresAt: daysAgo(31),
			ownerName: 'Old technical name',
			ownerUsername: 'old_name',
			telegramUserId: '12345',
			connectionId: 'old-connection'
		}
	});
	const closedSession = await prisma.telegramConnectSession.create({
		data: {
			workspaceId: closed.id,
			actorSubject: closed.actor.subject,
			actorMembershipId: closed.actor.membershipId,
			commandId: randomUUID(),
			nonceHash: hash(randomUUID()),
			state: 'OWNER_VERIFIED',
			expiresAt: daysAgo(31),
			ownerName: 'Closed technical name',
			telegramUserId: '67890'
		}
	});
	const connectedSession = await prisma.telegramConnectSession.create({
		data: {
			workspaceId: closed.id,
			actorSubject: closed.actor.subject,
			actorMembershipId: closed.actor.membershipId,
			commandId: randomUUID(),
			nonceHash: hash(randomUUID()),
			state: 'CONNECTED',
			channelId: closed.channel.id,
			expiresAt: daysAgo(31)
		}
	});
	await assert.rejects(
		prisma.telegramConnectSession.create({
			data: {
				workspaceId: open.id,
				actorSubject: open.actor.subject,
				actorMembershipId: open.actor.membershipId,
				commandId: randomUUID(),
				nonceHash: hash(randomUUID()),
				state: 'EXPIRED',
				expiresAt: daysAgo(31),
				payloadPurgedAt: new Date()
			}
		})
	);
	const sourceRows = [];
	for (const [state, age] of [
		['DONE', 31],
		['DEAD', 91],
		['DONE', 29],
		['DEAD', 89],
		['PENDING', 91],
		['PROCESSING', 91]
	]) {
		const update = {
			update_id: Number(++sequence),
			message: { text: `private-${randomUUID()}` }
		};
		const raw = JSON.stringify(update);
		sourceRows.push(
			await prisma.telegramWebhookInbox.create({
				data: {
					botKey: fixtureId,
					updateId: BigInt(update.update_id),
					payloadHash: hash(raw),
					rawBody: raw,
					payload: update,
					state,
					updatedAt: daysAgo(age),
					createdAt: daysAgo(95),
					...(state === 'PROCESSING'
						? { leaseToken: randomUUID(), leaseUntil: daysAgo(1) }
						: {})
				}
			})
		);
	}
	for (let i = 0; i < 101; i++) {
		const raw = JSON.stringify({ update_id: Number(++sequence) });
		await prisma.telegramWebhookInbox.create({
			data: {
				botKey: fixtureId,
				updateId: sequence,
				payloadHash: hash(raw),
				rawBody: raw,
				payload: JSON.parse(raw),
				state: 'DONE',
				updatedAt: daysAgo(31)
			}
		});
	}
	await assert.rejects(
		prisma.telegramWebhookInbox.update({
			where: { id: sourceRows[0].id },
			data: { payloadHash: 'e'.repeat(64) }
		})
	);
	await assert.rejects(
		prisma.telegramWebhookInbox.update({
			where: { id: sourceRows[0].id },
			data: { rawBody: '', payload: {}, payloadPurgedAt: new Date() }
		})
	);

	const queued = await dispatch(closed, 'QUEUED');
	const sending = await dispatch(closed, 'SENDING');
	const unknown = await dispatch(closed, 'UNKNOWN');
	const openDelivery = await dispatch(open, 'QUEUED');
	const youngDelivery = await dispatch(young, 'SENDING');
	const expired = await attachment(closed);
	const pending = await attachment(closed, 'UPLOADING');
	const deletion = await attachment(closed, 'DELETING', null, daysAgo(1));
	const openAttachment = await attachment(open);
	const youngAttachment = await attachment(young);
	const closingAttachment = await attachment(closing);
	await prisma.crmChatParticipant.create({
		data: {
			workspaceId: closed.id,
			conversationId: closed.room,
			subject: closed.actor.subject,
			membershipId: closed.actor.membershipId
		}
	});
	const internalMessage = await prisma.crmChatMessage.create({
		data: {
			workspaceId: closed.id,
			conversationId: closed.room,
			sequence: 1,
			senderSubject: closed.actor.subject,
			senderMembershipId: closed.actor.membershipId,
			senderName: 'Fixture owner',
			text: 'retained history'
		}
	});
	const attached = await attachment(closed, 'ATTACHED', internalMessage.id);
	await close(closed, 31);
	await close(young, 29);
	await close(closing, 40, 'CLOSING');
	await assert.rejects(
		prisma.crmChatAttachment.update({
			where: { id: expired.id },
			data: { state: 'DELETING', version: { increment: 1 } }
		})
	);
	await assert.rejects(
		prisma.$transaction(async tx => {
			await tx.$executeRaw`SELECT set_config('crm_access.maintenance','true',true)`;
			await tx.$executeRaw`UPDATE crm_access.telegram_connect_sessions SET owner_name=NULL WHERE id=${closedSession.id}::uuid`;
		})
	);
	for (let i = 0; i < 5; i++) await retire();
	for (const row of sourceRows.slice(0, 2)) {
		const retired = await prisma.telegramWebhookInbox.findUniqueOrThrow({
			where: { id: row.id }
		});
		assert.equal(retired.rawBody, '');
		assert.deepEqual(retired.payload, {});
		assert.ok(retired.payloadPurgedAt);
		assert.equal(retired.payloadHash, row.payloadHash);
		assert.equal(retired.updateId, row.updateId);
	}
	for (const row of sourceRows.slice(2))
		assert.equal(
			(
				await prisma.telegramWebhookInbox.findUniqueOrThrow({
					where: { id: row.id }
				})
			).rawBody,
			row.rawBody
		);
	const webhook = new TelegramBusinessWebhook(prisma, bot);
	assert.deepEqual(
		await webhook.admit(
			Buffer.from(sourceRows[0].rawBody),
			['x-telegram-bot-api-secret-token', bot.secret],
			JSON.parse(sourceRows[0].rawBody)
		),
		{ ok: true }
	);
	const conflicting = JSON.stringify({
		update_id: Number(sourceRows[0].updateId),
		message: { text: 'changed' }
	});
	await assert.rejects(
		webhook.admit(
			Buffer.from(conflicting),
			['x-telegram-bot-api-secret-token', bot.secret],
			JSON.parse(conflicting)
		),
		error => error.status === 409
	);
	await assert.rejects(
		prisma.telegramWebhookInbox.update({
			where: { id: sourceRows[0].id },
			data: { state: 'PENDING' }
		})
	);
	const replay = await telegram.createSession('Bearer fixture', createCommand);
	assert.equal(replay.item.id, created.item.id);
	assert.equal(replay.item.state, 'EXPIRED');
	assert.equal(replay.item.deepLink, null);
	assert.equal(replay.item.owner, null);
	assert.ok(
		(
			await prisma.telegramConnectSession.findUniqueOrThrow({
				where: { id: closedSession.id }
			})
		).payloadPurgedAt
	);
	assert.equal(
		(
			await prisma.telegramConnectSession.findUniqueOrThrow({
				where: { id: connectedSession.id }
			})
		).payloadPurgedAt,
		null
	);
	assert.equal(
		(
			await prisma.telegramDelivery.findUniqueOrThrow({
				where: { commandId: queued.row.commandId }
			})
		).state,
		'CANCELLED'
	);
	assert.equal(
		(
			await prisma.telegramMessage.findUniqueOrThrow({
				where: { id: queued.message.id }
			})
		).deliveryStatus,
		'CANCELLED'
	);
	assert.equal(
		(
			await prisma.telegramDelivery.findUniqueOrThrow({
				where: { commandId: sending.row.commandId }
			})
		).state,
		'UNKNOWN'
	);
	assert.equal(
		(
			await prisma.telegramMessage.findUniqueOrThrow({
				where: { id: sending.message.id }
			})
		).deliveryStatus,
		'UNKNOWN'
	);
	assert.deepEqual(
		await prisma.telegramDelivery.findUniqueOrThrow({
			where: { commandId: unknown.row.commandId }
		}),
		unknown.row
	);
	for (const delivery of [openDelivery, youngDelivery])
		assert.deepEqual(
			await prisma.telegramDelivery.findUniqueOrThrow({
				where: { commandId: delivery.row.commandId }
			}),
			delivery.row
		);

	// Parallel claimers never own the same lease, stale completions cannot win.
	const [left, right] = await Promise.all([claim(), claim()]);
	assert.ok(!left.some(a => right.some(b => a.id === b.id)));
	const claims = [...left, ...right];
	for (const item of [expired, pending, deletion])
		assert.ok(claims.some(row => row.id === item.id));
	for (const item of [
		attached,
		youngAttachment,
		closingAttachment,
		openAttachment
	])
		assert.ok(!claims.some(row => row.id === item.id));
	const original = claims.find(row => row.id === deletion.id);
	assert.equal(
		await complete({ ...original, leaseOwner: randomUUID() }),
		false
	);
	await elapseLease(deletion.id);
	assert.equal(await complete(original), false);
	const reclaimed = (await claim()).find(row => row.id === deletion.id);
	assert.ok(reclaimed);
	assert.notEqual(reclaimed.leaseOwner, original.leaseOwner);
	await objects.remove(reclaimed.key);
	assert.equal(await complete(reclaimed), true);
	assert.equal(await complete(reclaimed), false);
	for (const row of claims.filter(row => row.id !== deletion.id))
		await elapseLease(row.id);
	objects.beforeDelete = async key => {
		if (key === expired.key)
			throw new Error('synthetic-private-provider-error');
	};
	await attachments.sweep();
	assert.equal(
		(
			await prisma.crmChatAttachment.findUniqueOrThrow({
				where: { id: expired.id }
			})
		).state,
		'DELETING'
	);
	assert.equal(
		attachments.progress().lastErrorCode,
		'CHAT_ATTACHMENT_SWEEP_PARTIAL'
	);
	assert.equal(objects.objects.has(expired.key), true);
	await elapseLease(expired.id);
	objects.beforeDelete = undefined;
	await attachments.sweep();
	assert.equal(
		(
			await prisma.crmChatAttachment.findUniqueOrThrow({
				where: { id: expired.id }
			})
		).state,
		'DELETED'
	);
	assert.equal(objects.objects.has(expired.key), false);
	assert.equal(
		(
			await prisma.crmChatAttachment.findUniqueOrThrow({
				where: { id: openAttachment.id }
			})
		).state,
		'DELETED'
	);
	assert.equal(attachments.progress().lastErrorCode, null);
	assert.ok(attachments.progress().lastSuccessAt);
	// A late PUT remains bounded by the existing orphan grace period and is
	// eventually removed; retained ATTACHED/history and unrelated prefixes stay.
	objects.objects.set(expired.key, Buffer.from('late put'));
	objects.objectDates.set(expired.key, daysAgo(2));
	objects.objects.set('mail/foreign/secret', Buffer.from('foreign'));
	for (let i = 0; i < 4; i++) await attachments.sweep();
	assert.equal(objects.objects.has(expired.key), false);
	for (const item of [attached, youngAttachment, closingAttachment])
		assert.equal(objects.objects.has(item.key), true);
	assert.equal(objects.objects.has('mail/foreign/secret'), true);
	assert.equal(
		(
			await prisma.crmChatMessage.findUniqueOrThrow({
				where: { id: internalMessage.id }
			})
		).text,
		'retained history'
	);
	console.log(
		'PASS technical retention PostgreSQL18: bounded 30/90-day purge, payload dedup receipts, tombstone command replay, closed/fresh/closing isolation, UNKNOWN preservation, restricted routine grants, unforgeable maintenance authorization, concurrent claim/CAS, storage retry/late PUT and retained history'
	);
} catch (error) {
	console.error({
		name: error.name,
		code: error.code,
		sqlState: error.meta?.code,
		message: String(error.message)
			.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted-url]')
			.slice(-1600)
	});
	process.exitCode = 1;
} finally {
	attachments.onModuleDestroy();
	await prisma.$disconnect();
	await migration.end().catch(() => undefined);
	if (previousGate === undefined)
		delete process.env.CRM_ACCESS_RETENTION_ENABLED;
	else process.env.CRM_ACCESS_RETENTION_ENABLED = previousGate;
}
