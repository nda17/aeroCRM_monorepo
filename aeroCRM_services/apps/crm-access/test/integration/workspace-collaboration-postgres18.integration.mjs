import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/crm-access-client');
const { Client } = require('pg');
const {
	DirectoryService
} = require('../../dist/src/directory/directory.service.js');
const {
	WorkspaceChatService
} = require('../../dist/src/workspace-chat/workspace-chat.service.js');
assert.equal(process.env.CRM_ACCESS_INTEGRATION_ALLOW_MUTATION, 'true');
const databaseUrl = required('CRM_ACCESS_TEST_DATABASE_URL');
const runtimeRole = required('CRM_ACCESS_TEST_RUNTIME_ROLE');
const url = new URL(databaseUrl);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.match(url.pathname, /^\/aerocrm_crm_access_test(?:_[a-z0-9]+)*$/);
assert.equal(decodeURIComponent(url.username), runtimeRole);
assert.equal(url.searchParams.get('schema'), 'crm_access');
const prisma = new PrismaClient({
	datasources: { db: { url: databaseUrl } }
});
const notifications = new Client({ connectionString: databaseUrl });
const workspaceId = randomUUID();
const ownerSubject = `collab-owner-${randomUUID()}`;
const peerSubject = `collab-peer-${randomUUID()}`;
const otherPeerSubject = `collab-peer-${randomUUID()}`;
const ownerMembershipId = randomUUID();
const peerMembershipId = randomUUID();
const otherPeerMembershipId = randomUUID();
let actor = {
	workspaceId,
	subject: ownerSubject,
	membershipId: ownerMembershipId,
	role: 'OWNER',
	state: 'ACTIVE',
	permissions: ['access:read-team', 'access:manage-team']
};
const auth = {
	authorize: async (_token, id) => {
		if (id !== workspaceId) {
			const { ForbiddenException } = require('@nestjs/common');
			throw new ForbiddenException();
		}
		if (actor.role !== 'OWNER') {
			const member = await prisma.crmWorkspaceMember.findUnique({
				where: {
					workspaceId_subject: { workspaceId, subject: actor.subject }
				}
			});
			if (
				!member ||
				member.disabledAt ||
				member.membershipId !== actor.membershipId
			) {
				const { ForbiddenException } = require('@nestjs/common');
				throw new ForbiddenException();
			}
		}
		return { ...actor };
	},
	assignmentSubject: async (id, subject) => {
		assert.equal(id, workspaceId);
		if (subject === ownerSubject)
			return {
				...actor,
				subject,
				membershipId: ownerMembershipId,
				role: 'OWNER'
			};
		if (subject === otherPeerSubject) {
			const member = await prisma.crmWorkspaceMember.findUnique({
				where: { workspaceId_subject: { workspaceId, subject } }
			});
			if (!member || member.disabledAt) {
				const { ForbiddenException } = require('@nestjs/common');
				throw new ForbiddenException();
			}
			return {
				...actor,
				subject,
				membershipId: member.membershipId,
				role: member.role
			};
		}
		const member = await prisma.crmWorkspaceMember.findUnique({
			where: { workspaceId_subject: { workspaceId, subject } }
		});
		if (!member || member.disabledAt) {
			const { ForbiddenException } = require('@nestjs/common');
			throw new ForbiddenException();
		}
		return {
			...actor,
			subject,
			membershipId: member.membershipId,
			role: member.role
		};
	}
};
const directory = new DirectoryService(prisma, auth);
const chat = new WorkspaceChatService(prisma, auth);
const makeCommand = (fields = {}) => ({
	schemaVersion: 1,
	workspaceId,
	commandId: randomUUID(),
	...fields
});

try {
	const role =
		await prisma.$queryRaw`SELECT current_user AS name, current_setting('server_version_num')::integer AS version, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls, rolcanlogin, pg_get_userbyid(nspowner) <> current_user AS not_owner, NOT has_database_privilege(current_user, current_database(), 'CREATE') AS no_db_create FROM pg_roles JOIN pg_namespace ON nspname='crm_access' WHERE rolname=current_user`;
	assert.equal(
		role[0].name,
		runtimeRole,
		'database user matches runtime role'
	);
	if (
		role[0].rolsuper ||
		role[0].rolcreatedb ||
		role[0].rolcreaterole ||
		role[0].rolinherit ||
		role[0].rolreplication ||
		role[0].rolbypassrls ||
		!role[0].rolcanlogin
	)
		console.log(
			JSON.stringify({
				rolsuper: role[0].rolsuper,
				rolcreatedb: role[0].rolcreatedb,
				rolcreaterole: role[0].rolcreaterole,
				rolinherit: role[0].rolinherit,
				rolreplication: role[0].rolreplication,
				rolbypassrls: role[0].rolbypassrls,
				rolcanlogin: role[0].rolcanlogin
			})
		);
	assert.equal(role[0].rolsuper, false, 'runtime role is not superuser');
	assert.equal(
		role[0].rolcreatedb,
		false,
		'runtime role cannot create databases'
	);
	assert.equal(
		role[0].rolcreaterole,
		false,
		'runtime role cannot create roles'
	);
	assert.equal(
		role[0].rolinherit,
		false,
		'runtime role does not inherit grants'
	);
	assert.equal(
		role[0].rolreplication,
		false,
		'runtime role cannot replicate'
	);
	assert.equal(
		role[0].rolbypassrls,
		false,
		'runtime role cannot bypass RLS'
	);
	assert.equal(role[0].rolcanlogin, true, 'runtime role can log in');
	assert.equal(
		role[0].not_owner,
		true,
		'runtime role does not own service schema'
	);
	assert.equal(
		role[0].no_db_create,
		true,
		'runtime role cannot create databases'
	);
	assert.ok(
		role[0].version >= 180000 && role[0].version < 190000,
		'test database is PostgreSQL 18'
	);
	await prisma.crmWorkspaceAccess.create({
		data: {
			workspaceId,
			lifecycle: 'ACTIVE',
			activatedBySubject: ownerSubject,
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
	await prisma.crmWorkspaceMember.create({
		data: {
			workspaceId,
			subject: peerSubject,
			membershipId: peerMembershipId,
			role: 'MANAGER'
		}
	});
	await prisma.crmWorkspaceMember.create({
		data: {
			workspaceId,
			subject: otherPeerSubject,
			membershipId: otherPeerMembershipId,
			role: 'MANAGER'
		}
	});
	await prisma.crmEmployeeProfile.createMany({
		data: [
			{
				workspaceId,
				subject: peerSubject,
				firstName: 'Peer',
				lastName: 'Test'
			}
		]
	});
	await prisma.crmEmployeeProfile.create({
		data: {
			workspaceId,
			subject: otherPeerSubject,
			firstName: 'Other',
			lastName: 'Peer'
		}
	});
	await prisma.crmDirectoryEntry.createMany({
		data: [
			{
				workspaceId,
				sourceKey: `subject:${peerSubject}`,
				subject: peerSubject,
				firstName: 'Peer',
				lastName: 'Test'
			},
			{
				workspaceId,
				sourceKey: `subject:${otherPeerSubject}`,
				subject: otherPeerSubject,
				firstName: 'Other',
				lastName: 'Peer'
			}
		]
	});
	await notifications.connect();
	await notifications.query('LISTEN crm_access_live_v1');
	const directoryPage = await directory.list('Bearer local-test', {
		workspaceId,
		page: 1,
		pageSize: 50,
		includeArchived: false,
		activeOnly: false
	});
	assert.equal(directoryPage.workspaceId, workspaceId);
	assert.equal(directoryPage.subject, ownerSubject);
	assert.equal(directoryPage.items.length, 3);
	const peerEntry = directoryPage.items.find(
		item => item.subject === peerSubject
	);
	assert.ok(peerEntry);
	const initialVersion = peerEntry.version;
	actor = {
		...actor,
		subject: peerSubject,
		membershipId: peerMembershipId,
		role: 'MANAGER',
		permissions: ['access:read-team']
	};
	await assert.rejects(
		directory.archive(
			'Bearer local-test',
			peerEntry.id,
			makeCommand({ expectedVersion: initialVersion }),
			true
		),
		error => error.status === 403
	);
	actor = {
		...actor,
		subject: ownerSubject,
		membershipId: ownerMembershipId,
		role: 'OWNER',
		permissions: ['access:read-team', 'access:manage-team']
	};
	const updatedDirectory = await directory.update(
		'Bearer local-test',
		peerEntry.id,
		makeCommand({
			expectedVersion: peerEntry.version,
			fields: {
				firstName: 'Peer',
				lastName: 'Test',
				middleName: null,
				phone: null,
				email: null,
				position: 'Sales',
				department: null,
				extension: null,
				telegram: null
			}
		})
	);
	assert.equal(updatedDirectory.item.version, peerEntry.version + 1);
	const notificationPromise = new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error('workspace signal timeout')),
			3000
		);
		notifications.once('notification', value => {
			clearTimeout(timeout);
			resolve(value);
		});
	});
	const signalCommand = makeCommand({
		expectedVersion: updatedDirectory.item.version,
		fields: {
			firstName: 'Peer',
			lastName: 'Test',
			middleName: null,
			phone: null,
			email: null,
			position: 'Sales',
			department: null,
			extension: null,
			telegram: null
		}
	});
	const signalUpdate = await directory.update(
		'Bearer local-test',
		peerEntry.id,
		signalCommand
	);
	const signal = await notificationPromise;
	assert.equal(signal.channel, 'crm_access_live_v1');
	assert.equal(signal.payload, workspaceId);
	const clearNames = makeCommand({
		expectedVersion: signalUpdate.item.version,
		fields: {
			firstName: null,
			lastName: 'Test',
			middleName: null,
			phone: null,
			email: null,
			position: null,
			department: null,
			extension: null,
			telegram: null
		}
	});
	await assert.rejects(
		directory.update('Bearer local-test', peerEntry.id, clearNames),
		error => error.status === 400
	);
	const raceExpectedVersion = signalUpdate.item.version;
	const updates = await Promise.allSettled([
		directory.update(
			'Bearer local-test',
			peerEntry.id,
			makeCommand({
				expectedVersion: raceExpectedVersion,
				fields: {
					firstName: 'Peer',
					lastName: 'Test',
					middleName: null,
					phone: null,
					email: null,
					position: 'Sales A',
					department: null,
					extension: null,
					telegram: null
				}
			})
		),
		directory.update(
			'Bearer local-test',
			peerEntry.id,
			makeCommand({
				expectedVersion: raceExpectedVersion,
				fields: {
					firstName: 'Peer',
					lastName: 'Test',
					middleName: null,
					phone: null,
					email: null,
					position: 'Sales B',
					department: null,
					extension: null,
					telegram: null
				}
			})
		)
	]);
	assert.equal(
		updates.filter(result => result.status === 'fulfilled').length,
		1
	);
	const conflict = updates.find(result => result.status === 'rejected');
	assert.equal(conflict?.status, 'rejected');
	if (conflict?.status === 'rejected')
		assert.equal(conflict.reason.status, 409);
	const currentDirectory = updates.find(
		result => result.status === 'fulfilled'
	);
	assert.ok(currentDirectory && currentDirectory.status === 'fulfilled');
	const profileAfterDirectoryEdit =
		await prisma.crmEmployeeProfile.findUnique({
			where: { workspaceId_subject: { workspaceId, subject: peerSubject } }
		});
	assert.equal(profileAfterDirectoryEdit.firstName, 'Peer');
	assert.equal(profileAfterDirectoryEdit.lastName, 'Test');
	const archived = await directory.archive(
		'Bearer local-test',
		peerEntry.id,
		makeCommand({ expectedVersion: currentDirectory.value.item.version }),
		true
	);
	assert.ok(archived.item.archivedAt);
	const commandId = randomUUID();
	const directCommand = {
		schemaVersion: 1,
		workspaceId,
		commandId,
		recipientSubject: peerSubject
	};
	const direct = await chat.direct('Bearer local-test', directCommand);
	assert.equal(direct.conversation.canSend, true);
	const directReplay = await chat.direct(
		'Bearer local-test',
		directCommand
	);
	assert.equal(direct.conversation.id, directReplay.conversation.id);
	const restored = await directory.archive(
		'Bearer local-test',
		peerEntry.id,
		makeCommand({ expectedVersion: archived.item.version }),
		false
	);
	assert.equal(restored.item.archivedAt, null);
	const room = await prisma.crmChatConversation.findUnique({
		where: { workspaceId_pairKey: { workspaceId, pairKey: 'workspace' } }
	});
	assert.ok(room);
	const roomMessage = await chat.send(
		'Bearer local-test',
		room.id,
		makeCommand({ text: 'Common room message' })
	);
	actor = {
		...actor,
		subject: peerSubject,
		membershipId: peerMembershipId,
		role: 'MANAGER',
		permissions: ['access:read-team']
	};
	const roomMessages = await chat.messages('Bearer local-test', room.id, {
		workspaceId,
		limit: 50
	});
	assert.equal(roomMessages.items[0].id, roomMessage.item.id);
	const notificationPage = await chat.notifications('Bearer local-test', {
		workspaceId,
		page: 1,
		pageSize: 10,
		unreadOnly: true
	});
	assert.equal(notificationPage.unreadCount, 1);
	assert.equal(notificationPage.items[0].messageId, roomMessage.item.id);
	const roomRead = await chat.read(
		'Bearer local-test',
		room.id,
		makeCommand({ throughSequence: roomMessage.item.sequence })
	);
	assert.equal(roomRead.unreadCount, 0);
	assert.equal(
		(
			await chat.notifications('Bearer local-test', {
				workspaceId,
				page: 1,
				pageSize: 10,
				unreadOnly: true
			})
		).unreadCount,
		0
	);
	const replacementMembership = randomUUID();
	await prisma.crmWorkspaceMember.update({
		where: { workspaceId_subject: { workspaceId, subject: peerSubject } },
		data: { membershipId: replacementMembership }
	});
	actor = { ...actor, membershipId: replacementMembership };
	const rebound = await chat.read(
		'Bearer local-test',
		room.id,
		makeCommand({ throughSequence: 0 })
	);
	assert.equal(rebound.throughSequence, 0);
	assert.equal(
		(
			await chat.notifications('Bearer local-test', {
				workspaceId,
				page: 1,
				pageSize: 10,
				unreadOnly: true
			})
		).unreadCount,
		1
	);
	await prisma.crmWorkspaceMember.update({
		where: { workspaceId_subject: { workspaceId, subject: peerSubject } },
		data: { membershipId: peerMembershipId }
	});
	actor = {
		...actor,
		subject: ownerSubject,
		membershipId: ownerMembershipId,
		role: 'OWNER',
		permissions: ['access:read-team', 'access:manage-team']
	};
	await assert.rejects(
		chat.direct('Bearer local-test', {
			...directCommand,
			recipientSubject: otherPeerSubject
		}),
		error => error.status === 409
	);
	actor = {
		...actor,
		subject: peerSubject,
		membershipId: peerMembershipId,
		role: 'MANAGER',
		permissions: ['access:read-team']
	};
	const unrelatedDirect = await chat.direct(
		'Bearer local-test',
		makeCommand({ recipientSubject: otherPeerSubject })
	);
	const unrelatedMessage = await chat.send(
		'Bearer local-test',
		unrelatedDirect.conversation.id,
		makeCommand({ text: 'Private to another member' })
	);
	actor = {
		...actor,
		subject: ownerSubject,
		membershipId: ownerMembershipId,
		role: 'OWNER',
		permissions: ['access:read-team', 'access:manage-team']
	};
	const ownerConversations = await chat.list('Bearer local-test', {
		workspaceId,
		page: 1,
		pageSize: 50
	});
	assert.ok(
		ownerConversations.items.every(
			item => item.id !== unrelatedDirect.conversation.id
		)
	);
	const ownerNotifications = await chat.notifications(
		'Bearer local-test',
		{
			workspaceId,
			page: 1,
			pageSize: 20,
			unreadOnly: false
		}
	);
	assert.ok(
		ownerNotifications.items.every(
			item => item.messageId !== unrelatedMessage.item.id
		)
	);
	await assert.rejects(
		chat.messages('Bearer local-test', unrelatedDirect.conversation.id, {
			workspaceId,
			limit: 50
		}),
		error => error.status === 404
	);
	const conversationId = direct.conversation.id;
	actor = {
		...actor,
		subject: otherPeerSubject,
		membershipId: otherPeerMembershipId,
		role: 'MANAGER',
		permissions: ['access:read-team']
	};
	await assert.rejects(
		chat.messages('Bearer local-test', conversationId, {
			workspaceId,
			limit: 50
		}),
		error => error.status === 404
	);
	await assert.rejects(
		chat.messages('Bearer local-test', conversationId, {
			workspaceId: randomUUID(),
			limit: 50
		}),
		error => error.status === 403
	);
	actor = {
		...actor,
		subject: ownerSubject,
		membershipId: ownerMembershipId,
		role: 'OWNER',
		permissions: ['access:read-team', 'access:manage-team']
	};
	const send = text =>
		chat.send('Bearer local-test', conversationId, makeCommand({ text }));
	const firstPair = await Promise.all([
		send('message one'),
		send('message two')
	]);
	const sequences = firstPair
		.map(result => result.item.sequence)
		.sort((a, b) => a - b);
	assert.deepEqual(sequences, [1, 2]);
	const sameSend = makeCommand({ text: 'same idempotent message' });
	const once = await chat.send(
		'Bearer local-test',
		conversationId,
		sameSend
	);
	const twice = await chat.send(
		'Bearer local-test',
		conversationId,
		sameSend
	);
	assert.equal(once.item.id, twice.item.id);
	await assert.rejects(
		chat.send('Bearer local-test', conversationId, {
			...sameSend,
			text: 'changed payload'
		}),
		error => error.status === 409
	);
	const messagePage = await chat.messages(
		'Bearer local-test',
		conversationId,
		{
			workspaceId,
			limit: 50
		}
	);
	assert.deepEqual(
		messagePage.items.map(item => item.sequence),
		[1, 2, 3]
	);
	actor = {
		...actor,
		subject: peerSubject,
		membershipId: peerMembershipId,
		role: 'MANAGER',
		permissions: ['access:read-team']
	};
	const readHighCommand = makeCommand({ throughSequence: 3 });
	const readHigh = await chat.read(
		'Bearer local-test',
		conversationId,
		readHighCommand
	);
	const readLow = await chat.read(
		'Bearer local-test',
		conversationId,
		makeCommand({ throughSequence: 1 })
	);
	assert.equal(readHigh.throughSequence, 3);
	assert.equal(readLow.throughSequence, 3);
	await assert.rejects(
		chat.read(
			'Bearer local-test',
			conversationId,
			makeCommand({ throughSequence: 4 })
		),
		error => error.status === 400
	);
	const peerActor = actor;
	actor = {
		...actor,
		subject: ownerSubject,
		membershipId: ownerMembershipId,
		role: 'OWNER',
		state: 'ACTIVE',
		permissions: ['access:read-team', 'access:manage-team']
	};
	await prisma.crmWorkspaceMember.update({
		where: { workspaceId_subject: { workspaceId, subject: peerSubject } },
		data: { disabledAt: new Date() }
	});
	await assert.rejects(
		chat.direct('Bearer local-test', directCommand),
		error => error.status === 403
	);
	await prisma.crmWorkspaceMember.update({
		where: { workspaceId_subject: { workspaceId, subject: peerSubject } },
		data: { disabledAt: null }
	});
	assert.equal(
		(await chat.direct('Bearer local-test', directCommand)).conversation
			.id,
		conversationId
	);
	const newPeerMembershipId = randomUUID();
	await prisma.crmWorkspaceMember.update({
		where: { workspaceId_subject: { workspaceId, subject: peerSubject } },
		data: { membershipId: newPeerMembershipId }
	});
	await assert.rejects(
		chat.direct('Bearer local-test', directCommand),
		error => error.status === 409
	);
	await prisma.crmWorkspaceMember.update({
		where: { workspaceId_subject: { workspaceId, subject: peerSubject } },
		data: { membershipId: peerMembershipId }
	});
	actor = { ...peerActor, state: 'READ_ONLY' };
	await assert.rejects(
		chat.send(
			'Bearer local-test',
			conversationId,
			makeCommand({ text: 'forbidden read-only send' })
		),
		error => error.status === 403
	);
	await chat.read(
		'Bearer local-test',
		conversationId,
		makeCommand({ throughSequence: 3 })
	);
	const changedMembership = randomUUID();
	await prisma.crmWorkspaceMember.update({
		where: { workspaceId_subject: { workspaceId, subject: peerSubject } },
		data: { membershipId: changedMembership }
	});
	actor = { ...actor, state: 'ACTIVE', membershipId: changedMembership };
	await assert.rejects(
		chat.read('Bearer local-test', conversationId, readHighCommand),
		error => error.status === 409
	);
	await assert.rejects(
		chat.messages('Bearer local-test', conversationId, {
			workspaceId,
			limit: 50
		}),
		error => error.status === 404
	);
	console.log(
		'PASS workspace collaboration PostgreSQL 18: runtime role, directory profile sync/CAS/archive/FIO guard, transactional live signal, common room/unread/read receipts, participant rebinding, concurrent direct-message sequences, retry/conflict, unread-scope isolation, READ_ONLY and stale membership isolation'
	);
} catch (error) {
	console.error(
		JSON.stringify({
			name: error?.name,
			code: error?.code,
			sqlState: error?.meta?.code,
			message: String(error?.message || '')
				.split('\n')
				.slice(-4)
				.join(' ')
				.replace(
					/(?:postgres(?:ql)?|https?):\/\/[^\s]+/g,
					'[redacted-url]'
				)
				.slice(0, 600)
		})
	);
	process.exitCode = 1;
} finally {
	await notifications.end().catch(() => undefined);
	await prisma.$disconnect();
}

function required(name) {
	assert.ok(process.env[name]?.trim(), `${name} is required`);
	return process.env[name].trim();
}
