import { describe, expect, it } from 'vitest'
import {
	parseInboxEntry,
	parseIntakeActivity,
	parseIntakePage,
	parseIntakeResult,
	parseIntakeSource
} from './intake.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const date = '2026-09-05T00:00:00.000Z'
const entry = {
	id,
	workspaceId,
	title: 'Запрос',
	name: 'Клиент',
	phone: null,
	email: null,
	message: null,
	origin: 'MANUAL',
	sourceId: null,
	status: 'NEW',
	createdBySubject: 'owner',
	teamId: null,
	version: 1,
	contactId: null,
	dealId: null,
	rejectionReason: null,
	receivedAt: date,
	updatedAt: date,
	acceptedAt: null,
	rejectedAt: null
}
const source = {
	id,
	workspaceId,
	name: 'Форма',
	kind: 'API',
	tokenVersion: 1,
	createdBySubject: 'owner',
	teamId: null,
	version: 1,
	revokedAt: null,
	createdAt: date,
	updatedAt: date
}

describe('Intake exact workspace-bound contracts', () => {
	it('accepts canonical entry and safe source metadata', () => {
		expect(parseInboxEntry(entry, workspaceId)).toEqual(entry)
		expect(parseIntakeSource(source, workspaceId)).toEqual(source)
	})
	it('permits nullable names only for native WIDGET with a managed source, preserving exact 20 keys', () => {
		for (const name of [null, 'Клиент']) {
			const value = { ...entry, origin: 'WIDGET', sourceId: id, name }
			expect(parseInboxEntry(value, workspaceId)).toEqual(value)
			expect(Object.keys(value)).toHaveLength(20)
		}
		for (const origin of ['MANUAL', 'API', 'CSV'])
			expect(
				parseInboxEntry(
					{
						...entry,
						origin,
						sourceId: origin === 'API' ? id : null,
						name: null
					},
					workspaceId
				)
			).toBeNull()
		for (const name of ['', ' ', 0, 'x'.repeat(201)])
			expect(
				parseInboxEntry(
					{ ...entry, origin: 'WIDGET', sourceId: id, name },
					workspaceId
				)
			).toBeNull()
		expect(
			parseInboxEntry(
				{
					...entry,
					origin: 'WIDGET',
					sourceId: id,
					name: null,
					payload: {}
				},
				workspaceId
			)
		).toBeNull()
	})
	it('accepts additive CSV origin only without an API source while retaining original fields', () => {
		expect(
			parseInboxEntry({ ...entry, origin: 'CSV' }, workspaceId)
		).toEqual({ ...entry, origin: 'CSV' })
		expect(
			parseInboxEntry(
				{ ...entry, origin: 'CSV', sourceId: id },
				workspaceId
			)
		).toBeNull()
		expect(
			parseInboxEntry(
				{ ...entry, origin: 'CSV', importId: id },
				workspaceId
			)
		).toBeNull()
	})
	it.each([
		{ ...entry, workspaceId: id },
		{ ...entry, version: 0 },
		{ ...entry, extra: true },
		{ ...entry, origin: 'WIDGET' },
		{ ...entry, origin: 'API', sourceId: null },
		{ ...entry, sourceId: id },
		{ ...entry, phone: '89991234567' },
		{ ...entry, status: 'ACCEPTED' },
		{ ...entry, status: 'REJECTED', rejectedAt: date },
		{ ...entry, status: 'NEW', dealId: id },
		{ ...entry, receivedAt: '2026-09-05' }
	])(
		'rejects cross-workspace, malformed and unconfirmed outcomes',
		value => expect(parseInboxEntry(value, workspaceId)).toBeNull()
	)
	it('accepts only complete accepted/rejected outcomes', () => {
		expect(
			parseInboxEntry(
				{
					...entry,
					status: 'ACCEPTED',
					contactId: workspaceId,
					dealId: id,
					acceptedAt: date
				},
				workspaceId
			)
		).not.toBeNull()
		expect(
			parseInboxEntry(
				{
					...entry,
					status: 'REJECTED',
					rejectedAt: date,
					rejectionReason: 'Дубликат'
				},
				workspaceId
			)
		).not.toBeNull()
	})
	it.each([
		{ ...source, token: 'unexpected-secret' },
		{ ...source, tokenHash: 'unexpected-hash' },
		{ ...source, workspaceId: id },
		{ ...source, tokenVersion: 0 },
		{ ...source, kind: 'WIDGET' }
	])('rejects credential-bearing or malformed source responses', value =>
		expect(parseIntakeSource(value, workspaceId)).toBeNull()
	)
	it('checks response entity identity, pagination and duplicate IDs', () => {
		const page = {
			schemaVersion: 1,
			page: 1,
			pageSize: 25,
			total: 1,
			items: [entry]
		}
		const parse = (value: unknown) => parseInboxEntry(value, workspaceId)
		expect(parseIntakePage(page, 1, 25, parse)?.items).toHaveLength(1)
		expect(parseIntakePage(page, 2, 25, parse)).toBeNull()
		expect(
			parseIntakePage(
				{ ...page, total: 2, items: [entry, entry] },
				1,
				25,
				parse
			)
		).toBeNull()
		expect(
			parseIntakeResult(
				{ schemaVersion: 1, entry },
				'entry',
				parse,
				workspaceId
			)
		).toBeNull()
		expect(
			parseIntakeResult(
				{ schemaVersion: 1, entry, token: 'unexpected' },
				'entry',
				parse
			)
		).toBeNull()
	})
	it('checks audit entity/workspace and excludes payloads/credentials', () => {
		const activity = {
			id,
			workspaceId,
			entityId: id,
			entityKind: 'entry',
			commandId: workspaceId,
			actorSubject: 'owner',
			action: 'CREATED',
			entityVersion: 1,
			createdAt: date
		}
		expect(parseIntakeActivity(activity, workspaceId, id)).toEqual(
			activity
		)
		expect(
			parseIntakeActivity(activity, workspaceId, workspaceId)
		).toBeNull()
		expect(
			parseIntakeActivity(
				{ ...activity, token: 'secret' },
				workspaceId,
				id
			)
		).toBeNull()
	})
})
