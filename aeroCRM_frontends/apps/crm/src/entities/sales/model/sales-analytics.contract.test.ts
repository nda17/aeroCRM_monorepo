import { describe, expect, it } from 'vitest'
import {
	parseSalesAnalytics,
	parseSalesAnalyticsOverview
} from './sales-analytics.contract'

const valid = {
	schemaVersion: 1,
	currency: 'RUB',
	items: [
		{ status: 'OPEN', count: 2, amountMinor: 55000 },
		{ status: 'WON', count: 1, amountMinor: 12345 },
		{ status: 'LOST', count: 0, amountMinor: 0 }
	]
}

describe('Sales analytics aggregate contract', () => {
	it('accepts exact complete aggregates without PII, including zero-value deals', () => {
		expect(parseSalesAnalytics(valid)).toEqual(valid)
		expect(
			parseSalesAnalytics({
				...valid,
				items: valid.items.map(item => ({ ...item, amountMinor: 0 }))
			})
		).not.toBeNull()
	})
	it.each([
		null,
		{ ...valid, schemaVersion: 2 },
		{ ...valid, currency: 'USD' },
		{ ...valid, contacts: [] },
		{ ...valid, items: valid.items.slice(1) },
		{ ...valid, items: [valid.items[0], valid.items[0], valid.items[2]] },
		{
			...valid,
			items: [
				{ ...valid.items[0], email: 'synthetic@example.test' },
				...valid.items.slice(1)
			]
		},
		{
			...valid,
			items: [
				{ ...valid.items[0], status: 'ARCHIVED' },
				...valid.items.slice(1)
			]
		},
		{
			...valid,
			items: [{ ...valid.items[0], count: -1 }, ...valid.items.slice(1)]
		},
		{
			...valid,
			items: [
				{ ...valid.items[0], amountMinor: 0.1 },
				...valid.items.slice(1)
			]
		},
		{
			...valid,
			items: [{ ...valid.items[0], count: '2' }, ...valid.items.slice(1)]
		},
		{
			...valid,
			items: [{ ...valid.items[0], count: 0 }, ...valid.items.slice(1)]
		},
		{
			...valid,
			items: [
				{ ...valid.items[0], count: Number.MAX_SAFE_INTEGER },
				...valid.items.slice(1)
			]
		},
		{
			...valid,
			items: [
				{ ...valid.items[0], amountMinor: Number.MAX_SAFE_INTEGER },
				...valid.items.slice(1)
			]
		}
	])('rejects incomplete, unsafe or expanded aggregates', value => {
		expect(parseSalesAnalytics(value)).toBeNull()
	})
})

describe('Expanded analytics contract', () => {
	const period = {
		createdFrom: '2026-09-01T00:00:00.000Z',
		createdTo: '2026-09-08T00:00:00.000Z'
	}
	const expanded = {
		...valid,
		overview: {
			dateBasis: 'CREATED_AT',
			period,
			previous: {
				period: {
					createdFrom: '2026-08-25T00:00:00.000Z',
					createdTo: period.createdFrom
				},
				items: valid.items
			},
			asOf: '2026-09-14T09:00:00.000Z',
			attention: { open: 5, overdue: 2, withoutNextAction: 1 },
			assignees: {
				page: 1,
				pageSize: 20,
				hasMore: false,
				items: [
					{
						assignedToSubject: 'owner',
						items: valid.items,
						open: 5,
						overdue: 2,
						withoutNextAction: 1
					}
				]
			}
		}
	}
	it('accepts exact period/previous and bounded employee aggregates while legacy parser stays strict', () => {
		expect(parseSalesAnalyticsOverview(expanded, period)).toEqual(expanded)
		expect(parseSalesAnalytics(expanded)).toBeNull()
	})
	it('supports aggregate-only roles and all time without inventing a comparison', () => {
		const report = {
			...expanded,
			overview: {
				...expanded.overview,
				period: null,
				previous: null,
				assignees: null
			}
		}
		expect(parseSalesAnalyticsOverview(report, {})).toEqual(report)
	})
	it.each([
		{ period: { ...period, createdTo: '2026-09-09T00:00:00.000Z' } },
		{ previous: { period, items: valid.items } },
		{ dateBasis: 'CLOSED_AT' },
		{ asOf: 'yesterday' },
		{ attention: { open: 2, overdue: 2, withoutNextAction: 1 } },
		{ attention: { open: 5, overdue: 0, withoutNextAction: -1 } },
		{ assignees: { ...expanded.overview.assignees, page: 2 } },
		{ assignees: { ...expanded.overview.assignees, hasMore: true } },
		{
			assignees: {
				...expanded.overview.assignees,
				items: [
					expanded.overview.assignees.items[0],
					expanded.overview.assignees.items[0]
				]
			}
		},
		{
			assignees: {
				...expanded.overview.assignees,
				items: [{ ...expanded.overview.assignees.items[0], open: 6 }]
			}
		},
		{
			assignees: {
				...expanded.overview.assignees,
				items: [
					{
						...expanded.overview.assignees.items[0],
						contactName: 'Unexpected PII'
					}
				]
			}
		}
	])(
		'rejects shifted cohorts, inconsistent counts, pages and extra fields',
		fields => {
			expect(
				parseSalesAnalyticsOverview(
					{ ...expanded, overview: { ...expanded.overview, ...fields } },
					period
				)
			).toBeNull()
		}
	)
	it('rejects a legacy response when a detailed report was requested', () => {
		expect(parseSalesAnalyticsOverview(valid, period)).toBeNull()
	})
})
