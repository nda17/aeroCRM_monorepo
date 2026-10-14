import { describe, expect, it } from 'vitest'
import {
	parseSalesStageDurationDetail,
	parseSalesStageDurationPage,
	parseStageDurationSettings
} from './stage-duration.contract'
import type { SalesDeal } from './sales.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const pipelineId = '22222222-2222-4222-8222-222222222222'
const stageId = '33333333-3333-4333-8333-333333333333'
const dealId = '44444444-4444-4444-8444-444444444444'
const otherDealId = '55555555-5555-4555-8555-555555555555'
const contactId = '66666666-6666-4666-8666-666666666666'
const baseDeal: SalesDeal = {
	id: dealId,
	workspaceId,
	version: 7,
	title: 'Сделка',
	currency: 'RUB',
	amountMinor: 1000,
	pipelineId,
	stageId,
	status: 'OPEN',
	contactId,
	contactName: 'Клиент',
	assignedToSubject: 'actor',
	teamId: null,
	archivedAt: null,
	createdAt: '2026-09-01T00:00:00.000Z',
	updatedAt: '2026-09-01T00:00:00.000Z',
	nextTask: null
}
const stageDuration = (
	deal: SalesDeal,
	values: Record<string, unknown> = {}
) => ({
	dealId: deal.id,
	stageId: deal.stageId,
	dealVersion: deal.version,
	enteredAt: '2026-09-01T00:00:00.000Z',
	limitDays: 2,
	deadlineAt: '2026-09-03T00:00:00.000Z',
	elapsedDays: 2,
	overdue: false,
	...values
})

describe('stage-duration contracts', () => {
	it('validates scoped settings and unique explicit OPEN-stage limits', () => {
		const settings = {
			schemaVersion: 1,
			workspaceId,
			pipelineId,
			pipelineVersion: 4,
			items: [
				{ stageId, limitDays: 30 },
				{ stageId: otherDealId, limitDays: null }
			]
		}
		expect(
			parseStageDurationSettings(settings, workspaceId, pipelineId)
		).toEqual(settings)
		expect(
			parseStageDurationSettings(settings, contactId, pipelineId)
		).toBeNull()
		expect(
			parseStageDurationSettings(
				{ ...settings, items: [settings.items[0], settings.items[0]] },
				workspaceId,
				pipelineId
			)
		).toBeNull()
		expect(
			parseStageDurationSettings(
				{ ...settings, items: [{ stageId, limitDays: '30' }] },
				workspaceId,
				pipelineId
			)
		).toBeNull()
	})

	it('checks page membership, ordering, version, and the exact deadline boundary', () => {
		const secondDeal = { ...baseDeal, id: otherDealId, version: 3 }
		const asOf = '2026-09-03T00:00:00.000Z'
		const page = {
			asOf,
			overdueCount: 1,
			items: [
				stageDuration(baseDeal),
				stageDuration(secondDeal, {
					enteredAt: '2026-09-01T00:00:00.000Z',
					limitDays: 1,
					deadlineAt: '2026-09-02T00:00:00.000Z',
					elapsedDays: 2,
					overdue: true
				})
			]
		}
		expect(
			parseSalesStageDurationPage(page, [baseDeal, secondDeal])
		).toMatchObject({
			asOf,
			items: [{ overdue: false }, { overdue: true }]
		})
		expect(
			parseSalesStageDurationPage(page, [baseDeal, secondDeal], true)
		).toBeNull()
		expect(
			parseSalesStageDurationPage(page, [baseDeal, secondDeal], false)
		).not.toBeNull()
		expect(
			parseSalesStageDurationPage(page, [secondDeal, baseDeal])
		).toBeNull()
		expect(
			parseSalesStageDurationPage(
				{
					...page,
					items: [
						stageDuration(baseDeal, { dealVersion: 6 }),
						page.items[1]
					]
				},
				[baseDeal, secondDeal]
			)
		).toBeNull()
	})

	it('uses 24-hour elapsed days, strict overdue comparison, and null-entry semantics', () => {
		const asOf = '2026-09-03T00:00:00.001Z'
		const item = stageDuration(baseDeal, { overdue: true })
		const parsed = parseSalesStageDurationDetail({ asOf, item }, baseDeal)
		expect(parsed).toMatchObject({
			item: {
				elapsedDays: 2,
				deadlineAt: '2026-09-03T00:00:00.000Z',
				overdue: true
			}
		})
		expect(
			parseSalesStageDurationDetail(
				{ asOf, item: { ...item, overdue: false } },
				baseDeal
			)
		).toBeNull()
		const unknownEntry = stageDuration(baseDeal, {
			enteredAt: null,
			deadlineAt: null,
			elapsedDays: null,
			overdue: false
		})
		expect(
			parseSalesStageDurationDetail({ asOf, item: unknownEntry }, baseDeal)
		).toMatchObject({
			item: {
				enteredAt: null,
				deadlineAt: null,
				elapsedDays: null,
				overdue: false
			}
		})
	})

	it('suppresses inactive deal duration fields while retaining the entered timestamp', () => {
		const closed = { ...baseDeal, status: 'WON' as const }
		const item = stageDuration(closed, {
			limitDays: null,
			deadlineAt: null,
			elapsedDays: null,
			overdue: false
		})
		expect(
			parseSalesStageDurationDetail(
				{ asOf: '2026-09-03T00:00:00.000Z', item },
				closed
			)
		).toMatchObject({
			item: { enteredAt: '2026-09-01T00:00:00.000Z', limitDays: null }
		})
	})
})
