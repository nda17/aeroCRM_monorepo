import { describe, expect, it } from 'vitest'
import {
	parseCommerceCatalogItem,
	parseDealCommerce,
	parseManagedPipelines
} from './commerce.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const dealId = '22222222-2222-4222-8222-222222222222'
const itemId = '33333333-3333-4333-8333-333333333333'
const stageId = '44444444-4444-4444-8444-444444444444'
const date = '2026-09-05T10:00:00.000Z'
const catalogItem = {
	id: itemId,
	workspaceId,
	code: 'ITEM-1',
	kind: 'PRODUCT',
	name: 'Чай',
	unit: 'шт.',
	basePriceMinor: 0,
	version: 1,
	archivedAt: null,
	createdAt: date,
	updatedAt: date
}
const pipeline = {
	id: itemId,
	workspaceId,
	name: 'Продажи',
	version: 1,
	templateKey: 'custom',
	templateVersion: 1,
	stages: [
		{ id: stageId, key: 'new', name: 'Новая', position: 1, state: 'OPEN' },
		{
			id: '55555555-5555-4555-8555-555555555555',
			key: 'won',
			name: 'Успешно',
			position: 2,
			state: 'WON'
		},
		{
			id: '66666666-6666-4666-8666-666666666666',
			key: 'lost',
			name: 'Отказ',
			position: 3,
			state: 'LOST'
		}
	]
}
const line = {
	id: '77777777-7777-4777-8777-777777777777',
	catalogItemId: itemId,
	kind: 'PRODUCT',
	name: 'Чай',
	unit: 'шт.',
	quantity: '1.000',
	unitPriceMinor: 125,
	discountMinor: 25,
	totalMinor: 100
}
const dealCommerce = {
	schemaVersion: 1,
	dealId,
	dealVersion: 3,
	mode: 'LINES',
	amountMinor: 100,
	items: [line]
}

describe('commerce exact contracts', () => {
	it('accepts strict tenant-bound managed pipelines', () => {
		expect(
			parseManagedPipelines(
				{ schemaVersion: 1, workspaceId, items: [pipeline] },
				workspaceId
			)
		).toEqual([pipeline])
	})
	it.each([
		{
			schemaVersion: 1,
			workspaceId,
			items: [{ ...pipeline, extra: true }]
		},
		{
			schemaVersion: 1,
			workspaceId,
			items: [
				{
					...pipeline,
					stages: [
						{ ...pipeline.stages[0], extra: true },
						...pipeline.stages.slice(1)
					]
				}
			]
		},
		{
			schemaVersion: 1,
			workspaceId,
			items: [{ ...pipeline, stages: pipeline.stages.slice(0, 2) }]
		},
		{
			schemaVersion: 1,
			workspaceId,
			items: [
				{
					...pipeline,
					stages: [
						pipeline.stages[0],
						pipeline.stages[0],
						pipeline.stages[2]
					]
				}
			]
		},
		{ schemaVersion: 1, workspaceId: itemId, items: [pipeline] },
		{
			schemaVersion: 1,
			workspaceId,
			items: [{ ...pipeline, workspaceId: itemId }]
		},
		{ schemaVersion: 1, workspaceId, items: [pipeline, pipeline] },
		{ schemaVersion: 2, workspaceId, items: [pipeline] },
		{ schemaVersion: 1, workspaceId, items: [{ ...pipeline, stages: [] }] }
	])('rejects malformed pipeline envelopes or rows', value => {
		expect(parseManagedPipelines(value, workspaceId)).toBeNull()
	})

	it('distinguishes a zero price from a missing nullable price', () => {
		expect(parseCommerceCatalogItem(catalogItem, workspaceId)).toEqual(
			catalogItem
		)
		expect(
			parseCommerceCatalogItem(
				{ ...catalogItem, basePriceMinor: null },
				workspaceId
			)?.basePriceMinor
		).toBeNull()
	})
	it.each([
		{ ...catalogItem, extra: true },
		{ ...catalogItem, workspaceId: dealId },
		{ ...catalogItem, id: dealId },
		{ ...catalogItem, basePriceMinor: -1 },
		{ ...catalogItem, basePriceMinor: 2_147_483_648 },
		{ ...catalogItem, basePriceMinor: 1.5 },
		{ ...catalogItem, version: 0 },
		{ ...catalogItem, archivedAt: 'yesterday' },
		Object.fromEntries(
			Object.entries(catalogItem).filter(
				([key]) => key !== 'basePriceMinor'
			)
		)
	])(
		'rejects catalog price overflow, bad scope, or invalid shape',
		value => {
			expect(
				parseCommerceCatalogItem(value, workspaceId, itemId)
			).toBeNull()
		}
	)

	it('accepts bound deal lines with validated money and quantity', () => {
		expect(parseDealCommerce(dealCommerce, dealId)).toEqual(dealCommerce)
	})
	it.each([
		{ ...dealCommerce, extra: true },
		{ ...dealCommerce, dealId: itemId },
		{ ...dealCommerce, amountMinor: 2_147_483_648 },
		{ ...dealCommerce, dealVersion: 0 },
		{ ...dealCommerce, items: [{ ...line, extra: true }] },
		{ ...dealCommerce, items: [{ ...line, id: itemId }, line] },
		{ ...dealCommerce, items: [{ ...line, quantity: '1.2' }] },
		{ ...dealCommerce, items: [{ ...line, quantity: '01.000' }] },
		{ ...dealCommerce, items: [{ ...line, quantity: '0.000' }] },
		{ ...dealCommerce, items: [{ ...line, quantity: '1.0000' }] },
		{
			...dealCommerce,
			items: [{ ...line, unitPriceMinor: 2_147_483_648 }]
		},
		{ ...dealCommerce, items: [{ ...line, discountMinor: 126 }] },
		{ ...dealCommerce, items: [{ ...line, totalMinor: 99 }] },
		{ ...dealCommerce, mode: 'MANUAL' },
		{ ...dealCommerce, amountMinor: 99 }
	])('rejects malformed deal binding, amounts, and quantities', value => {
		expect(parseDealCommerce(value, dealId)).toBeNull()
	})
	it('accepts manual zero amount and empty lines', () => {
		expect(
			parseDealCommerce(
				{ ...dealCommerce, mode: 'MANUAL', amountMinor: 0, items: [] },
				dealId
			)
		).toMatchObject({ mode: 'MANUAL', amountMinor: 0, items: [] })
	})
})
