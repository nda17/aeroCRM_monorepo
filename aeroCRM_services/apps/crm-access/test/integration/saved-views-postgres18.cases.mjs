import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
	SavedViewsService
} = require('../../dist/src/saved-views/saved-views.service.js');

const dealParameters = {
	search: '',
	pipelineId: '',
	status: '',
	withoutNextAction: false,
	layout: 'list',
	sort: 'created_desc'
};

export async function runSavedViewsPostgresCases(prisma, workspaceId) {
	const ownerSubject = `saved-owner-${randomUUID()}`;
	const otherSubject = `saved-other-${randomUUID()}`;
	const capacitySubject = `saved-capacity-${randomUUID()}`;
	const authorization = {
		authorize: async (token, id) => ({
			workspaceId: id,
			subject:
				token === 'other'
					? otherSubject
					: token === 'capacity'
						? capacitySubject
						: ownerSubject,
			role: 'OWNER',
			state: token === 'read-only' ? 'READ_ONLY' : 'ACTIVE',
			permissions: ['sales:read']
		})
	};
	const service = new SavedViewsService(prisma, authorization);
	const command = (scopeWorkspaceId, data) => ({
		schemaVersion: 1,
		commandId: randomUUID(),
		workspaceId: scopeWorkspaceId,
		...data
	});
	const create = (
		token,
		name,
		scope = 'DEALS',
		parameters = dealParameters
	) =>
		service.create(
			token,
			command(workspaceId, { scope, name, parameters })
		);

	const created = await create('owner', 'Личная воронка');
	assert.equal(created.view.workspaceId, workspaceId);
	assert.equal(created.view.subject, ownerSubject);
	assert.deepEqual(
		(
			await service.list('owner', { workspaceId, scope: 'DEALS' })
		).items.map(view => view.id),
		[created.view.id]
	);
	assert.equal(
		(await service.list('other', { workspaceId, scope: 'DEALS' })).items
			.length,
		0,
		'Saved views are private to the creating subject'
	);
	assert.equal(
		(await service.list('owner', { workspaceId, scope: 'TASKS' })).items
			.length,
		0,
		'Saved views are isolated by scope'
	);
	const foreignWorkspaceId = randomUUID();
	assert.equal(
		(
			await service.list('owner', {
				workspaceId: foreignWorkspaceId,
				scope: 'DEALS'
			})
		).items.length,
		0,
		'Saved views are isolated by workspace'
	);
	await assert.rejects(
		service.rename(
			'other',
			created.view.id,
			command(workspaceId, { expectedVersion: 1, name: 'Чужая' })
		),
		error => error.status === 404
	);
	await assert.rejects(
		service.delete(
			'other',
			created.view.id,
			command(workspaceId, { expectedVersion: 1 })
		),
		error => error.status === 404
	);
	assert.equal(
		(await service.list('read-only', { workspaceId, scope: 'DEALS' })).items
			.length,
		1,
		'READ_ONLY permits reading personal saved views'
	);
	await assert.rejects(
		create('read-only', 'Не должно сохраниться'),
		error => error.status === 403
	);
	await assert.rejects(
		service.rename(
			'read-only',
			created.view.id,
			command(workspaceId, { expectedVersion: 1, name: 'Нет записи' })
		),
		error => error.status === 403
	);

	const legacyKey = 'a'.repeat(64);
	const importCommand = command(workspaceId, {
		scope: 'DEALS',
		views: [
			{ legacyKey, name: 'Перенесённый вид', parameters: dealParameters }
		]
	});
	const imported = await service.import('owner', importCommand);
	assert.equal(imported.createdCount, 1);
	assert.equal(imported.skippedCount, 0);
	assert.deepEqual(await service.import('owner', importCommand), imported);
	const archived = await service.delete(
		'owner',
		imported.items.find(view => view.legacyKey === legacyKey).id,
		command(workspaceId, { expectedVersion: 1 })
	);
	assert.ok(archived.view.archivedAt);
	const importAfterArchive = await service.import(
		'owner',
		command(workspaceId, {
			scope: 'DEALS',
			views: [
				{
					legacyKey,
					name: 'Перенесённый вид',
					parameters: dealParameters
				}
			]
		})
	);
	assert.equal(importAfterArchive.createdCount, 0);
	assert.equal(importAfterArchive.skippedCount, 1);
	assert.equal(
		importAfterArchive.items.some(view => view.legacyKey === legacyKey),
		false,
		'Reimport skips an archived legacy identity without unarchiving it'
	);

	for (let index = 0; index < 19; index++)
		await create('capacity', `Capacity ${index}`);
	const limitCommand = command(workspaceId, {
		scope: 'DEALS',
		views: [
			{
				legacyKey: 'b'.repeat(64),
				name: 'Batch 1',
				parameters: dealParameters
			},
			{
				legacyKey: 'c'.repeat(64),
				name: 'Batch 2',
				parameters: dealParameters
			}
		]
	});
	await assert.rejects(
		service.import('capacity', limitCommand),
		error => error.status === 409
	);
	assert.equal(
		await prisma.crmSavedView.count({
			where: {
				workspaceId,
				subject: capacitySubject,
				scope: 'DEALS',
				archivedAt: null
			}
		}),
		19,
		'An over-limit import must not insert a partial batch'
	);
	assert.equal(
		await prisma.crmTeamCommandReceipt.count({
			where: { commandId: limitCommand.commandId }
		}),
		0,
		'A rejected over-limit import must not leave an acknowledged command receipt'
	);
	console.log(
		'PASS CRM saved views PG18: personal/workspace/scope isolation, READ_ONLY read-write boundary, archived legacy replay, and atomic capacity limit'
	);
}
