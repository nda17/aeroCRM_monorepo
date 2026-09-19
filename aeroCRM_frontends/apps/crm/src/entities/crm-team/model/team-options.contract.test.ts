import { describe, expect, it } from 'vitest'
import { parseTeamOptions } from './team-options.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const foreignId = '33333333-3333-4333-8333-333333333333'
const item = { id, name: 'Продажи' }
const request = {
	workspaceId,
	subject: 'owner',
	page: 1,
	pageSize: 20,
	selectedId: id,
	teamIds: [id]
}
const page = {
	schemaVersion: 1,
	workspaceId,
	subject: 'owner',
	page: 1,
	pageSize: 20,
	total: 1,
	items: [item],
	selected: item
}

describe('actor-bound department options contract', () => {
	it('accepts exact names and UUIDs, including a selection outside the current page', () => {
		expect(parseTeamOptions(page, request)).toEqual(page)
		expect(
			parseTeamOptions(
				{ ...page, page: 2, items: [] },
				{ ...request, page: 2 }
			)?.selected
		).toEqual(item)
	})
	it.each([
		{ workspaceId: foreignId },
		{ subject: 'other' },
		{ page: 2 },
		{ pageSize: 10 },
		{ total: -1 },
		{ total: 2 },
		{ total: 0 },
		{ total: 1.5 },
		{ items: [] },
		{ items: [item, item] },
		{ items: [{ ...item, id: foreignId }] },
		{ items: [{ ...item, name: '' }] },
		{ items: [{ ...item, name: ' Продажи ' }] },
		{ items: [{ ...item, extra: 'private' }] },
		{ selected: { ...item, name: 'Old name' } },
		{ selected: { ...item, id: foreignId } },
		{ selected: null },
		{ secret: 'unexpected' }
	])('rejects stale, malformed and overbroad response %j', patch => {
		expect(parseTeamOptions({ ...page, ...patch }, request)).toBeNull()
	})
	it('does not accept names after membership removal', () => {
		expect(parseTeamOptions(page, { ...request, teamIds: [] })).toBeNull()
	})
	it('accepts unavailable or archived selection without disclosing existence', () => {
		expect(
			parseTeamOptions(
				{ ...page, total: 0, items: [], selected: null },
				request
			)?.selected
		).toBeNull()
	})
	it('requires selected metadata to be requested explicitly', () => {
		expect(
			parseTeamOptions(page, { ...request, selectedId: '' })
		).toBeNull()
		expect(
			parseTeamOptions(
				{ ...page, selected: null },
				{ ...request, selectedId: '' }
			)
		).not.toBeNull()
	})
})
