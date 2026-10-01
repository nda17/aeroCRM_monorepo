import { describe, expect, it } from 'vitest'
import {
	parseImportInspection,
	parseImportPreview,
	parseImportResult
} from './import.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const previewId = '22222222-2222-4222-8222-222222222222'
const commandId = '33333333-3333-4333-8333-333333333333'
const basePreview = {
	schemaVersion: 1,
	workspaceId,
	previewId,
	entity: 'contacts',
	sourceKey: 'google-main',
	expiresAt: '2026-10-02T10:00:00.000Z',
	rows: [
		{
			row: 2,
			sourceId: 'google-1',
			action: 'CREATE',
			targetId: null,
			expectedVersion: null,
			values: { name: 'Ada', phone: null },
			errors: [],
			warnings: [],
			candidates: []
		}
	],
	summary: { create: 1, link: 0, skip: 0, error: 0 },
	result: null
}

describe('CRM import response contracts', () => {
	it('accepts bounded inspection sheets and rejects extra response fields', () => {
		const inspection = {
			schemaVersion: 1,
			entity: 'contacts',
			fileDigest: 'a'.repeat(64),
			sheets: [
				{
					name: 'Contacts',
					headers: ['Name'],
					rowCount: 1,
					sample: [{ Name: 'Ada' }]
				}
			]
		}
		expect(parseImportInspection(inspection)).toEqual(inspection)
		expect(
			parseImportInspection({ ...inspection, filename: 'contacts.csv' })
		).toBeNull()
		expect(
			parseImportInspection({
				...inspection,
				sheets: [{ ...inspection.sheets[0], rowCount: 0 }]
			})
		).toBeNull()
	})

	it('requires exact row, summary, candidate, and result counts', () => {
		expect(parseImportPreview(basePreview)).toEqual(basePreview)
		expect(
			parseImportPreview({
				...basePreview,
				summary: { ...basePreview.summary, create: 0 }
			})
		).toBeNull()
		expect(
			parseImportPreview({
				...basePreview,
				rows: [{ ...basePreview.rows[0], targetId: previewId }]
			})
		).toBeNull()
		const result = {
			schemaVersion: 1,
			previewId,
			commandId,
			entity: 'contacts',
			status: 'APPLIED',
			created: 1,
			linked: 0,
			skipped: 0,
			items: [
				{
					row: 2,
					sourceId: 'google-1',
					entityId: workspaceId,
					action: 'CREATE'
				}
			]
		}
		expect(parseImportResult(result)).toEqual(result)
		expect(parseImportResult({ ...result, created: 2 })).toBeNull()
		expect(parseImportPreview({ ...basePreview, result })).toMatchObject({
			result
		})
		const boundSkip = {
			...basePreview,
			rows: [
				{
					...basePreview.rows[0],
					action: 'SKIP',
					targetId: workspaceId,
					expectedVersion: 2
				}
			],
			summary: { create: 0, link: 0, skip: 1, error: 0 }
		}
		expect(parseImportPreview(boundSkip)).toEqual(boundSkip)
		expect(
			parseImportResult({
				...result,
				created: 0,
				skipped: 1,
				items: [
					{
						row: 2,
						sourceId: 'google-1',
						entityId: workspaceId,
						action: 'SKIP'
					}
				]
			})
		).not.toBeNull()
		const longErrorRow = {
			...basePreview.rows[0],
			row: 3,
			sourceId: 'x'.repeat(257),
			action: 'ERROR',
			values: { [`source:${'h'.repeat(200)}`]: 'v'.repeat(5001) },
			errors: ['Field exceeds supported length']
		}
		expect(
			parseImportPreview({
				...basePreview,
				rows: [longErrorRow],
				summary: { create: 0, link: 0, skip: 0, error: 1 }
			})
		).not.toBeNull()
		expect(
			parseImportPreview({
				...basePreview,
				rows: [
					{
						...longErrorRow,
						values: { notes: 'v'.repeat(4_000_001) }
					}
				],
				summary: { create: 0, link: 0, skip: 0, error: 1 }
			})
		).toBeNull()
	})
})
