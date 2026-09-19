import { describe, expect, it } from 'vitest'
import { parseCsvImport } from './csv-import.contract'
const workspaceId = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const row = {
	id,
	workspaceId,
	createdBySubject: 'owner',
	teamId: null,
	label: 'Клиенты.csv',
	rowCount: 12,
	createdAt: '2026-09-05T00:00:00.000Z'
}
describe('Atomic CSV import receipt', () => {
	it('returns only confirmed metadata bound to the command and workspace', () =>
		expect(
			parseCsvImport({ schemaVersion: 1, import: row }, workspaceId, id)
		).toEqual(row))
	it.each([
		{ id: workspaceId },
		{ workspaceId: id },
		{ rowCount: 0 },
		{ rowCount: 251 },
		{ rowCount: 1.1 },
		{ label: '' },
		{ teamId: 'wrong' },
		{ rows: [{ name: 'PII' }] },
		{ createdAt: '2026-09-05' }
	])('rejects malformed, foreign or PII-bearing receipts', patch =>
		expect(
			parseCsvImport(
				{ schemaVersion: 1, import: { ...row, ...patch } },
				workspaceId,
				id
			)
		).toBeNull()
	)
})
