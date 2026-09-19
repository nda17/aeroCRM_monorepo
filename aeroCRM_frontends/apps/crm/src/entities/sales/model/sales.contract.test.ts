import { describe, expect, it } from 'vitest'
import {
	parsePipelines,
	parseSalesDeal,
	parseSalesDealResult,
	parseSalesPage,
	parseSalesTask,
	parseTimelineEntry
} from './sales.contract'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const dealId = '22222222-2222-4222-8222-222222222222'
const taskId = '33333333-3333-4333-8333-333333333333'
const pipelineId = '44444444-4444-4444-8444-444444444444'
const stageId = '55555555-5555-4555-8555-555555555555'
const contactId = '66666666-6666-4666-8666-666666666666'
const date = '2026-09-05T10:00:00.000Z'
const task = {
	id: taskId,
	workspaceId,
	dealId,
	version: 1,
	title: 'Позвонить',
	dueAt: date,
	status: 'OPEN',
	assignedToSubject: 'actor',
	completedAt: null,
	createdAt: date,
	updatedAt: date
}
const deal = {
	id: dealId,
	workspaceId,
	version: 1,
	title: 'Заказ',
	currency: 'RUB',
	amountMinor: 12345,
	pipelineId,
	stageId,
	status: 'OPEN',
	contactId,
	contactName: 'Клиент',
	assignedToSubject: 'actor',
	teamId: null,
	archivedAt: null,
	createdAt: date,
	updatedAt: date,
	nextTask: task
}
const pipeline = {
	id: pipelineId,
	workspaceId,
	name: 'Продажи',
	templateKey: 'sales',
	templateVersion: 1,
	stages: [
		{ id: stageId, key: 'new', name: 'Новая', position: 1, state: 'OPEN' }
	]
}

describe('Sales exact contracts', () => {
	it('accepts a contact-linked deal with exactly one current action', () => {
		expect(parseSalesDeal(deal, workspaceId)).toEqual(deal)
		expect(parseSalesTask(task, workspaceId)).toEqual(task)
	})
	it.each([
		{ ...deal, extra: true },
		{ ...deal, workspaceId: contactId },
		{ ...deal, status: 'WON' },
		{ ...deal, amountMinor: 0.5 },
		{ ...deal, amountMinor: -1 },
		{ ...deal, amountMinor: 2147483648 },
		{ ...deal, version: 0 },
		{ ...deal, createdAt: '2026-09-05T10:00:00Z' },
		{ ...deal, nextTask: { ...task, workspaceId: contactId } },
		{ ...deal, nextTask: { ...task, dealId: contactId } },
		{ ...deal, nextTask: { ...task, completedAt: date } },
		{
			...deal,
			nextTask: { ...task, status: 'COMPLETED', completedAt: date }
		}
	])('rejects malformed or cross-scope deal %j', value => {
		expect(parseSalesDeal(value, workspaceId)).toBeNull()
	})
	it('accepts an independently assigned next action without changing deal ownership', () => {
		const assigned = {
			...deal,
			nextTask: { ...task, assignedToSubject: 'other' }
		}
		expect(parseSalesDeal(assigned, workspaceId)).toEqual(assigned)
	})
	it('accepts an OPEN deal without a next action and an in-progress next action', () => {
		expect(
			parseSalesDeal({ ...deal, nextTask: null }, workspaceId)
		).toEqual({ ...deal, nextTask: null })
		const inProgress = { ...task, status: 'IN_PROGRESS' }
		expect(parseSalesTask(inProgress, workspaceId)).toEqual(inProgress)
		expect(
			parseSalesDeal({ ...deal, nextTask: inProgress }, workspaceId)
		).toEqual({ ...deal, nextTask: inProgress })
	})
	it.each([
		{ ...task, status: 'IN_PROGRESS', completedAt: date },
		{ ...task, status: 'COMPLETED', completedAt: null },
		{ ...task, status: 'CANCELLED', completedAt: null },
		{ ...task, status: 'UNKNOWN' },
		{ ...task, dealId: null }
	])(
		'keeps legacy deal-task identity and lifecycle validation for %j',
		value => {
			expect(parseSalesTask(value, workspaceId)).toBeNull()
		}
	)
	it('accepts closed and archived OPEN history without an open action', () => {
		expect(
			parseSalesDeal(
				{ ...deal, status: 'WON', nextTask: null },
				workspaceId
			)
		).not.toBeNull()
		expect(
			parseSalesDeal(
				{ ...deal, archivedAt: date, nextTask: null },
				workspaceId
			)
		).not.toBeNull()
		expect(
			parseSalesDeal({ ...deal, archivedAt: date }, workspaceId)
		).toBeNull()
	})
	it('binds response schema and requested identity', () => {
		expect(
			parseSalesDealResult({ schemaVersion: 1, deal }, workspaceId, dealId)
		).toEqual(deal)
		expect(
			parseSalesDealResult(
				{ schemaVersion: 1, deal },
				workspaceId,
				contactId
			)
		).toBeNull()
		expect(
			parseSalesDealResult({ schemaVersion: 2, deal }, workspaceId)
		).toBeNull()
	})
	it('checks page identity, totals, duplicates and each row', () => {
		const page = {
			schemaVersion: 1,
			page: 2,
			pageSize: 20,
			total: 21,
			items: [deal]
		}
		const parse = (value: unknown) =>
			parseSalesPage(value, 2, 20, row => parseSalesDeal(row, workspaceId))
		expect(parse(page)?.items).toEqual([deal])
		for (const bad of [
			{ ...page, page: 1 },
			{ ...page, pageSize: 10 },
			{ ...page, total: -1 },
			{ ...page, items: [deal, deal] },
			{ ...page, items: [{ ...deal, workspaceId: contactId }] }
		])
			expect(parse(bad)).toBeNull()
	})
	it('checks installed pipeline tenant and stage identities', () => {
		const parse = (items: unknown[]) =>
			parsePipelines({ schemaVersion: 1, items }, workspaceId)
		expect(parse([pipeline])).toEqual([pipeline])
		expect(parse([{ ...pipeline, workspaceId: contactId }])).toBeNull()
		expect(parse([pipeline, pipeline])).toBeNull()
		expect(
			parse([
				{ ...pipeline, stages: [pipeline.stages[0], pipeline.stages[0]] }
			])
		).toBeNull()
		expect(
			parse([
				{
					...pipeline,
					stages: [{ ...pipeline.stages[0], state: 'CUSTOM' }]
				}
			])
		).toBeNull()
	})
	it('binds timeline to deal and rejects unexpected fields', () => {
		const entry = {
			id: taskId,
			dealId,
			kind: 'CREATED',
			actorSubject: 'actor',
			outcome: '',
			fromStageId: null,
			toStageId: stageId,
			createdAt: date
		}
		expect(parseTimelineEntry(entry, dealId)).toEqual(entry)
		expect(parseTimelineEntry(entry, contactId)).toBeNull()
		expect(
			parseTimelineEntry({ ...entry, phone: '+79000000001' }, dealId)
		).toBeNull()
	})
})
