import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/crm-sales-client');
const {
	PlannerService
} = require('../../dist/src/planner/planner.service.js');
const {
	WorkdayService
} = require('../../dist/src/workday/workday.service.js');
const { WorkdayQuery } = require('../../dist/src/workday/workday.dto.js');
const {
	WorkspaceClosureService
} = require('../../dist/src/workspace-closure/workspace-closure.controller.js');
const required = name => {
	const value = process.env[name];
	assert.ok(value, name + ' is required');
	return value;
};
assert.equal(process.env.CRM_SALES_INTEGRATION_ALLOW_MUTATION, 'true');
const runtimeUrl = required('CRM_SALES_TEST_DATABASE_URL');
const migrationUrl = required('CRM_SALES_TEST_MIGRATION_URL');
const local = value => {
	const url = new URL(value);
	assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
	assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
	assert.match(url.pathname, /^\/aerocrm_crm_sales_test[a-z0-9_]*$/);
	assert.equal(url.searchParams.get('schema'), 'crm_sales');
	return url.host + url.pathname;
};
assert.equal(local(runtimeUrl), local(migrationUrl));
assert.equal(
	decodeURIComponent(new URL(runtimeUrl).username),
	required('CRM_SALES_TEST_RUNTIME_ROLE')
);
assert.notEqual(
	new URL(runtimeUrl).username,
	new URL(migrationUrl).username
);
const runtime = new PrismaClient({
	datasources: { db: { url: runtimeUrl } }
});
const migration = new PrismaClient({
	datasources: { db: { url: migrationUrl } }
});
const actor = {
	schemaVersion: 1,
	workspaceId: randomUUID(),
	subject: 'planner-owner',
	role: 'OWNER',
	state: 'ACTIVE',
	dataScope: 'ALL',
	teamIds: [],
	permissions: ['sales:read', 'sales:write']
};
let current = actor;
const authorization = { authorize: async () => current };
const planner = new PlannerService(runtime, authorization);
const workday = new WorkdayService(runtime, authorization, {
	authorize: async (_token, _access, assignee) => ({
		...assignee,
		dataScope: 'ALL',
		teamIds: [],
		role: 'OWNER'
	})
});
const token = 'Bearer planner-local-test';
const http = (status, code) => error =>
	error?.getStatus?.() === status &&
	(!code || error.getResponse()?.code === code);
const dbError = text => error => String(error).includes(text);
const command = (settings, patch = {}) => ({
	schemaVersion: 1,
	workspaceId: actor.workspaceId,
	commandId: randomUUID(),
	expectedVersion: settings.version,
	templates: structuredClone(settings.templates),
	columns: structuredClone(settings.columns),
	...patch
});
const move = (task, column, version, patch = {}) => ({
	schemaVersion: 1,
	workspaceId: actor.workspaceId,
	commandId: randomUUID(),
	expectedVersion: task.version,
	columnId: column,
	settingsVersion: version,
	...patch
});
const list = (column, version) =>
	workday.list(
		actor,
		Object.assign(new WorkdayQuery(), {
			workspaceId: actor.workspaceId,
			scope: 'ALL',
			period: 'ALL',
			pageSize: 100,
			...(column
				? {
						columnId: column.id,
						settingsVersion: version,
						status: column.status
					}
				: {})
		})
	);
try {
	const [identity] =
		await runtime.$queryRaw`SELECT current_user AS role, current_setting('server_version_num')::integer AS version`;
	assert.equal(identity.role, process.env.CRM_SALES_TEST_RUNTIME_ROLE);
	assert.ok(identity.version >= 180000 && identity.version < 190000);
	await assert.rejects(
		runtime.$queryRawUnsafe(
			'SELECT id FROM foreign_service_guard.sentinel'
		),
		error => error?.meta?.code === '42501'
	);
	const initial = await planner.settings(actor, actor.workspaceId);
	assert.equal(initial.version, 0);
	assert.equal(initial.templates.length, 3);
	assert.equal(initial.columns.length, 4);
	assert.equal(
		await runtime.plannerSettings.count({
			where: { workspaceId: actor.workspaceId }
		}),
		0,
		'read never initializes configuration'
	);
	const customId = randomUUID(),
		activeId = randomUUID();
	const firstCommand = command(initial);
	firstCommand.columns.splice(1, 0, {
		id: customId,
		name: 'Ожидаем клиента',
		status: 'OPEN',
		isDefault: false,
		archived: false
	});
	firstCommand.columns.push({
		id: activeId,
		name: 'Обработка',
		status: 'IN_PROGRESS',
		isDefault: false,
		archived: false
	});
	firstCommand.templates.push({
		id: randomUUID(),
		title: 'Проверить оплату',
		archived: false
	});
	firstCommand.columns[0].name = 'Новые задачи';
	const first = await planner.save(actor, firstCommand, token);
	assert.equal(first.version, 1);
	assert.equal(first.columns[1].id, customId);
	assert.deepEqual(await planner.save(actor, firstCommand, token), first);
	assert.equal(
		await runtime.plannerCommandReceipt.count({
			where: { workspaceId: actor.workspaceId }
		}),
		1
	);
	await assert.rejects(
		planner.save(
			actor,
			{
				...firstCommand,
				templates: [...firstCommand.templates].reverse()
			},
			token
		),
		http(409, 'crm_planner_command_conflict')
	);
	await assert.rejects(
		planner.save(actor, command(initial), token),
		http(409, 'crm_planner_settings_conflict')
	);
	await assert.rejects(
		planner.save(
			actor,
			command(first, {
				columns: first.columns.filter(item => item.id !== customId)
			}),
			token
		),
		http(409)
	);
	await assert.rejects(
		planner.save(
			actor,
			command(first, {
				columns: first.columns.map(item =>
					item.id === customId ? { ...item, status: 'COMPLETED' } : item
				)
			}),
			token
		),
		http(409)
	);
	await assert.rejects(
		planner.save(
			actor,
			command(first, {
				columns: first.columns.map(item =>
					item.id === 'OPEN' ? { ...item, archived: true } : item
				)
			}),
			token
		),
		http(400)
	);
	for (const denied of [
		{ ...actor, role: 'MANAGER' },
		{ ...actor, role: 'TEAM_LEAD' },
		{ ...actor, state: 'READ_ONLY' }
	]) {
		current = denied;
		await assert.rejects(
			planner.save(denied, command(first), token),
			http(403)
		);
		assert.deepEqual(
			await planner.settings(denied, actor.workspaceId),
			first
		);
	}
	current = { ...actor, role: 'MANAGER' };
	await assert.rejects(
		planner.save(actor, command(first), token),
		http(403),
		'fresh authorization revokes authority'
	);
	current = actor;
	const created = await workday.create(
		actor,
		{
			schemaVersion: 1,
			commandId: randomUUID(),
			workspaceId: actor.workspaceId,
			title: 'Позвонить клиенту',
			dueAt: new Date(Date.now() + 86400000).toISOString(),
			assignee: { subject: actor.subject, membershipId: randomUUID() }
		},
		token
	);
	assert.equal(
		(
			await runtime.salesTask.findUniqueOrThrow({
				where: { id: created.task.id }
			})
		).boardColumnId,
		null
	);
	assert.equal(
		'boardColumnId' in created.task,
		false,
		'legacy task contract remains unchanged'
	);
	const moveCommand = move(created.task, customId, first.version);
	const placed = await workday.move(
		actor,
		created.task.id,
		moveCommand,
		token
	);
	assert.equal(placed.task.status, 'OPEN');
	assert.equal(placed.task.version, created.task.version + 1);
	assert.deepEqual(
		await workday.move(actor, created.task.id, moveCommand, token),
		placed
	);
	assert.equal(
		(
			await runtime.taskTimeline.findUniqueOrThrow({
				where: { commandId: moveCommand.commandId }
			})
		).kind,
		'EDITED'
	);
	assert.equal(
		(
			await runtime.taskCommandReceipt.findUniqueOrThrow({
				where: { commandId: moveCommand.commandId }
			})
		).commandType,
		'MOVED'
	);
	const custom = first.columns.find(item => item.id === customId);
	assert.equal((await list(custom, first.version)).total, 1);
	assert.equal(
		(
			await list(
				first.columns.find(item => item.id === 'OPEN'),
				first.version
			)
		).total,
		0
	);
	assert.equal(
		(await list(custom, first.version)).counts.OPEN,
		1,
		'counts retain full status scope'
	);
	await assert.rejects(
		workday.move(
			actor,
			placed.task.id,
			move(placed.task, customId, 0),
			token
		),
		http(409, 'crm_planner_settings_conflict')
	);
	await assert.rejects(
		workday.move(
			actor,
			placed.task.id,
			move(placed.task, randomUUID(), first.version),
			token
		),
		http(409, 'crm_planner_column_unavailable')
	);
	await assert.rejects(
		workday.move(
			actor,
			placed.task.id,
			move(placed.task, customId, first.version, { expectedVersion: 1 }),
			token
		),
		http(409, 'crm_task_version_conflict')
	);
	const scoped = {
		...actor,
		subject: 'another-member',
		role: 'MANAGER',
		dataScope: 'OWN'
	};
	current = scoped;
	await assert.rejects(
		workday.move(
			scoped,
			placed.task.id,
			move(placed.task, customId, first.version),
			token
		),
		http(404)
	);
	current = actor;
	const archivedCommand = command(first);
	archivedCommand.columns.find(item => item.id === customId).archived =
		true;
	const beforeArchive = await runtime.salesTask.findUniqueOrThrow({
		where: { id: placed.task.id }
	});
	const archived = await planner.save(actor, archivedCommand, token);
	const afterArchive = await runtime.salesTask.findUniqueOrThrow({
		where: { id: placed.task.id }
	});
	assert.equal(afterArchive.version, beforeArchive.version);
	assert.equal(afterArchive.boardColumnId, customId);
	assert.equal(
		afterArchive.updatedAt.toISOString(),
		beforeArchive.updatedAt.toISOString()
	);
	assert.equal(
		(
			await list(
				archived.columns.find(item => item.id === 'OPEN'),
				archived.version
			)
		).total,
		1
	);
	await assert.rejects(
		list(custom, first.version),
		http(409, 'crm_planner_settings_conflict')
	);
	await assert.rejects(
		list(custom, archived.version),
		http(409, 'crm_planner_column_unavailable')
	);
	await assert.rejects(
		workday.move(
			actor,
			placed.task.id,
			move(placed.task, customId, archived.version),
			token
		),
		http(409, 'crm_planner_column_unavailable')
	);
	assert.deepEqual(
		await workday.move(actor, created.task.id, moveCommand, token),
		placed,
		'receipt replay ignores later configuration'
	);
	const restoreCommand = command(archived);
	restoreCommand.columns.find(item => item.id === customId).archived =
		false;
	const restored = await planner.save(actor, restoreCommand, token);
	assert.equal(
		(await list(custom, restored.version)).total,
		1,
		'restore restores historical placement'
	);
	const progressed = await workday.move(
		actor,
		placed.task.id,
		move(placed.task, activeId, restored.version),
		token
	);
	assert.equal(progressed.task.status, 'IN_PROGRESS');
	assert.equal(progressed.task.completedAt, null);
	const completed = await workday.move(
		actor,
		progressed.task.id,
		move(progressed.task, 'COMPLETED', restored.version),
		token
	);
	assert.equal(completed.task.status, 'COMPLETED');
	assert.ok(completed.task.completedAt);
	const reopened = await workday.move(
		actor,
		completed.task.id,
		move(completed.task, customId, restored.version),
		token
	);
	assert.equal(reopened.task.status, 'OPEN');
	assert.equal(reopened.task.completedAt, null);
	const foreignWorkspace = randomUUID(),
		foreignId = randomUUID();
	await runtime.plannerBoardColumn.create({
		data: {
			id: foreignId,
			workspaceId: foreignWorkspace,
			status: 'OPEN',
			name: 'Чужая',
			position: 0
		}
	});
	await assert.rejects(
		runtime.salesTask.update({
			where: { id: reopened.task.id },
			data: { boardColumnId: foreignId }
		}),
		dbError('crm_planner_column_unavailable')
	);
	await assert.rejects(
		runtime.salesTask.update({
			where: { id: reopened.task.id },
			data: { boardColumnId: activeId }
		}),
		dbError('crm_planner_column_unavailable')
	);
	await assert.rejects(
		runtime.plannerBoardColumn.update({
			where: { id: customId },
			data: { status: 'COMPLETED' }
		}),
		dbError('crm_planner_column_identity_immutable')
	);
	await assert.rejects(
		runtime.plannerBoardColumn.update({
			where: { id: customId },
			data: { workspaceId: foreignWorkspace }
		}),
		dbError('crm_workspace_change_refused')
	);
	await runtime.salesTask.update({
		where: { id: reopened.task.id },
		data: {
			status: 'CANCELLED',
			completedAt: new Date(),
			version: { increment: 1 }
		}
	});
	assert.equal(
		(
			await runtime.salesTask.findUniqueOrThrow({
				where: { id: reopened.task.id }
			})
		).boardColumnId,
		null,
		'legacy status changes reset placement'
	);
	await assert.rejects(
		runtime.plannerCommandReceipt.update({
			where: { commandId: firstCommand.commandId },
			data: { requestHash: '0'.repeat(64) }
		}),
		dbError('permission denied')
	);
	await assert.rejects(
		migration.plannerCommandReceipt.update({
			where: { commandId: firstCommand.commandId },
			data: { requestHash: '0'.repeat(64) }
		}),
		dbError('append only')
	);
	const task = (await workday.detail(actor, reopened.task.id)).task;
	const raceCommand = command(restored);
	raceCommand.columns.find(item => item.id === customId).archived = true;
	const race = await Promise.allSettled([
		workday.move(
			actor,
			task.id,
			move(task, customId, restored.version),
			token
		),
		planner.save(actor, raceCommand, token)
	]);
	assert.equal(race[1].status, 'fulfilled');
	if (race[0].status === 'rejected')
		assert.ok(http(409, 'crm_planner_settings_conflict')(race[0].reason));
	const latest = await planner.settings(actor, actor.workspaceId);
	const latestTask = (await workday.detail(actor, task.id)).task;
	const pages = await Promise.all(
		latest.columns
			.filter(item => !item.archived && item.status === latestTask.status)
			.map(item => list(item, latest.version))
	);
	assert.equal(
		pages.reduce((sum, page) => sum + page.total, 0),
		1,
		'concurrent archive/move cannot hide or duplicate a card'
	);
	await new WorkspaceClosureService(runtime).fence({
		schemaVersion: 1,
		closureId: randomUUID(),
		workspaceId: actor.workspaceId,
		generation: '1',
		ownerSubject: actor.subject,
		requestedAt: new Date().toISOString()
	});
	await assert.rejects(
		planner.save(actor, command(latest), token),
		dbError('crm_workspace_closed')
	);
	await assert.rejects(
		workday.move(
			actor,
			latestTask.id,
			move(latestTask, 'OPEN', latest.version),
			token
		),
		dbError('crm_workspace_closed')
	);
	await assert.rejects(
		runtime.plannerBoardColumn.create({
			data: {
				id: randomUUID(),
				workspaceId: actor.workspaceId,
				status: 'OPEN',
				name: 'Закрыто',
				position: 0
			}
		}),
		dbError('crm_workspace_closed')
	);
	console.log(
		'Planner customization PostgreSQL 18: settings, receipts, authority, board filters, archive/restore, task and SQL invariants, concurrent archive/move, closure passed'
	);
} finally {
	await Promise.all([runtime.$disconnect(), migration.$disconnect()]);
}
