import { describe, expect, it } from 'vitest'
import {
	parseSavedView,
	parseSavedViewParameters,
	parseSavedViewsPage
} from './saved-views.contract'
import type { SavedViewBinding } from './saved-views.types'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const binding: SavedViewBinding = {
	workspaceId,
	subject: 'actor@example.test',
	scope: 'TASKS'
}
const taskParameters = {
	layout: 'list',
	period: 'TODAY',
	timeZone: 'Europe/Moscow',
	scope: 'MINE'
}
const savedView = {
	id: '22222222-2222-4222-8222-222222222222',
	workspaceId,
	subject: binding.subject,
	scope: binding.scope,
	name: 'Сегодня',
	parameters: taskParameters,
	version: 1,
	legacyKey: null,
	archivedAt: null,
	createdAt: '2026-10-01T10:00:00.000Z',
	updatedAt: '2026-10-01T10:00:00.000Z'
}

describe('saved view response binding', () => {
	it.each([
		[
			'another workspace',
			{ ...savedView, workspaceId: '33333333-3333-4333-8333-333333333333' }
		],
		['another actor', { ...savedView, subject: 'someone-else' }],
		['another scope', { ...savedView, scope: 'DEALS' }]
	])('rejects a view bound to %s', (_reason, row) => {
		expect(parseSavedView(row, binding)).toBeNull()
	})

	it('accepts personal views only with the exact actor and workspace page binding', () => {
		const page = {
			schemaVersion: 1,
			workspaceId,
			subject: binding.subject,
			scope: 'TASKS',
			items: [savedView]
		}
		expect(parseSavedViewsPage(page, binding)).toEqual(page)
		expect(
			parseSavedViewsPage({ ...page, subject: 'someone-else' }, binding)
		).toBeNull()
		expect(
			parseSavedViewsPage(
				{ ...page, workspaceId: '33333333-3333-4333-8333-333333333333' },
				binding
			)
		).toBeNull()
	})
})

describe('saved task view filters', () => {
	it('keeps relative periods relative instead of storing resolved date snapshots', () => {
		expect(parseSavedViewParameters(taskParameters, 'TASKS')).toEqual(
			taskParameters
		)
		expect(
			parseSavedViewParameters(
				{ ...taskParameters, from: '2026-10-01', to: '2026-10-02' },
				'TASKS'
			)
		).toBeNull()
	})
})
