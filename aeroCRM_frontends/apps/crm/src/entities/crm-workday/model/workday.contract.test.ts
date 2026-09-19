import { describe, expect, it } from 'vitest'
import {
	parseWorkdayCommandResult,
	parseWorkdayTask,
	parseWorkdayTaskPage,
	parseWorkdayTaskResult,
	parseWorkdayTimelineEntry,
	parseWorkdayTimelinePage,
	validWorkdayCommand,
	validWorkdayFilters
} from './workday.contract'
import {
	expectedWorkdayRange,
	isWorkdayDate,
	isWorkdayTimeZone
} from './workday-period'
import {
	binding,
	command,
	date,
	entry,
	filters,
	otherId,
	page,
	task,
	taskId,
	workspaceId
} from './workday.test-fixtures'
import {
	WORKDAY_PERIODS,
	WORKDAY_STATUSES,
	type WorkdayFilters
} from './workday.types'

const request = { ...binding, ...filters }
describe('Workday strict task and command contracts', () => {
	it('accepts standalone and legacy membership-free linked tasks without rewriting assignments', () => {
		expect(parseWorkdayTask(task, workspaceId)).toEqual(task)
		expect(
			parseWorkdayTask(
				{ ...task, dealId: otherId, assignedToMembershipId: null },
				workspaceId
			)
		).not.toBeNull()
	})
	it.each(WORKDAY_STATUSES)(
		'accepts %s with coherent completion timestamp',
		status => {
			const completedAt =
				status === 'OPEN' || status === 'IN_PROGRESS' ? null : date
			expect(
				parseWorkdayTask({ ...task, status, completedAt }, workspaceId)
			).not.toBeNull()
			expect(
				parseWorkdayTask(
					{ ...task, status, completedAt: completedAt ? null : date },
					workspaceId
				)
			).toBeNull()
		}
	)
	it.each([
		{ workspaceId: otherId },
		{ id: 'bad' },
		{ dealId: 'bad' },
		{ teamId: 'bad' },
		{ assignedToMembershipId: 'bad' },
		{ version: 0 },
		{ version: 2147483648 },
		{ title: '' },
		{ title: 'x'.repeat(201) },
		{ status: 'DONE' },
		{ assignedToSubject: 'bad subject' },
		{ dueAt: '2026-02-30T12:00:00.000Z' },
		{ updatedAt: 'today' },
		{ extra: true }
	])('rejects invalid task %#', override =>
		expect(
			parseWorkdayTask({ ...task, ...override }, workspaceId)
		).toBeNull()
	)
	it('binds detail to exact task and envelope', () => {
		expect(
			parseWorkdayTaskResult(
				{ schemaVersion: 1, task },
				workspaceId,
				taskId
			)
		).toEqual(task)
		expect(
			parseWorkdayTaskResult(
				{ schemaVersion: 1, task },
				workspaceId,
				otherId
			)
		).toBeNull()
		expect(
			parseWorkdayTaskResult(
				{ schemaVersion: 1, task, subject: 'invented' },
				workspaceId
			)
		).toBeNull()
	})
	it('binds create to trimmed title, due date, assignee, nullable deal and first version', () => {
		expect(
			parseWorkdayCommandResult(
				{ schemaVersion: 1, task },
				{
					...command,
					mutation: {
						...command.mutation,
						title: ' Позвонить '
					} as typeof command.mutation
				}
			)
		).toEqual(task)
		for (const override of [
			{ title: 'Other' },
			{ dealId: otherId },
			{ version: 2 },
			{ assignedToSubject: 'other' },
			{ assignedToMembershipId: otherId },
			{ dueAt: '2026-09-08T12:00:00.000Z' },
			{ teamId: otherId }
		])
			expect(
				parseWorkdayCommandResult(
					{ schemaVersion: 1, task: { ...task, ...override } },
					command
				)
			).toBeNull()
	})
	it('binds status/edit/assignment to CAS and exact effects', () => {
		const updated = { ...task, version: 2, status: 'IN_PROGRESS' as const }
		const statusCommand = {
			...command,
			mutation: {
				kind: 'status' as const,
				id: taskId,
				expectedVersion: 1,
				status: 'IN_PROGRESS' as const
			}
		}
		expect(
			parseWorkdayCommandResult(
				{ schemaVersion: 1, task: updated },
				statusCommand
			)
		).toEqual(updated)
		for (const override of [
			{ version: 3 },
			{ id: otherId },
			{ status: 'OPEN' }
		])
			expect(
				parseWorkdayCommandResult(
					{ schemaVersion: 1, task: { ...updated, ...override } },
					statusCommand
				)
			).toBeNull()
		expect(
			parseWorkdayCommandResult(
				{ schemaVersion: 1, task: { ...task, version: 2 } },
				{
					...command,
					mutation: {
						kind: 'edit',
						id: taskId,
						expectedVersion: 1,
						title: task.title,
						dueAt: task.dueAt
					}
				}
			)
		).not.toBeNull()
		expect(
			parseWorkdayCommandResult(
				{ schemaVersion: 1, task: { ...task, version: 2 } },
				{
					...command,
					mutation: {
						kind: 'assignee',
						id: taskId,
						expectedVersion: 1,
						assignee: { subject: 'other', membershipId: otherId }
					}
				}
			)
		).toBeNull()
	})
	it.each([
		{ commandId: 'bad' },
		{ subject: '' },
		{ sessionRevision: -1 },
		{ extra: true },
		{
			mutation: {
				kind: 'status',
				id: taskId,
				expectedVersion: 2147483647,
				status: 'OPEN'
			}
		},
		{
			mutation: {
				kind: 'create',
				title: 'x',
				dueAt: date,
				dealId: null,
				teamId: null,
				assignee: { subject: 'actor', membershipId: null }
			}
		}
	])('rejects invalid command %#', override =>
		expect(validWorkdayCommand({ ...command, ...override })).toBe(false)
	)
})

describe('Workday server period, pagination and counts', () => {
	it('accepts exact server page without replacing counts', () =>
		expect(parseWorkdayTaskPage(page, request)).toEqual(page))
	it.each([
		{ subject: 'other' },
		{ workspaceId: otherId },
		{ schemaVersion: 2 },
		{ page: 2 },
		{ pageSize: 100 },
		{ total: 2 },
		{ total: -1 },
		{ total: 0.1 },
		{ items: [] },
		{ timeZone: 'UTC' },
		{ range: null },
		{ overdueCount: -1 },
		{ asOf: 'bad' },
		{ counts: { ...page.counts, OPEN: 2 } },
		{ counts: { OPEN: 1 } },
		{ extra: true }
	])('rejects mismatched page %#', override =>
		expect(
			parseWorkdayTaskPage({ ...page, ...override }, request)
		).toBeNull()
	)
	it('counts reflect the full period before the status column filter', () => {
		expect(
			parseWorkdayTaskPage(
				{ ...page, counts: { ...page.counts, OPEN: 0, IN_PROGRESS: 1 } },
				request
			)
		).toBeNull()
		const response = {
			...page,
			counts: { ...page.counts, IN_PROGRESS: 7 }
		}
		expect(
			parseWorkdayTaskPage(response, { ...request, status: 'OPEN' })
				?.counts.IN_PROGRESS
		).toBe(7)
		expect(parseWorkdayTaskPage(response, request)).toBeNull()
	})
	it('allows empty out-of-range pages but rejects partial or duplicate server pages', () => {
		expect(
			parseWorkdayTaskPage(
				{ ...page, page: 2, items: [] },
				{ ...request, page: 2 }
			)
		).not.toBeNull()
		expect(
			parseWorkdayTaskPage(
				{
					...page,
					total: 2,
					items: [task, task],
					counts: { ...page.counts, OPEN: 2 }
				},
				request
			)
		).toBeNull()
	})
	it('binds MINE, explicit assignee/team, status, date interval and ordering', () => {
		for (const changed of [
			{ assignedToSubject: 'other' },
			{ dueAt: '2026-09-07T21:00:00.000Z' }
		])
			expect(
				parseWorkdayTaskPage(
					{ ...page, items: [{ ...task, ...changed }] },
					request
				)
			).toBeNull()
		expect(
			parseWorkdayTaskPage(page, {
				...request,
				scope: 'ALL',
				assigneeSubject: 'other'
			})
		).toBeNull()
		expect(
			parseWorkdayTaskPage(page, { ...request, teamId: otherId })
		).toBeNull()
		const earlier = {
			...task,
			id: otherId,
			dueAt: '2026-09-07T09:00:00.000Z'
		}
		expect(
			parseWorkdayTaskPage(
				{
					...page,
					total: 2,
					items: [task, earlier],
					counts: { ...page.counts, OPEN: 2 }
				},
				request
			)
		).toBeNull()
	})
	it('OVERDUE contains only active tasks before asOf; its counts cannot include completed tasks', () => {
		const overdue = {
			...page,
			range: null,
			overdueCount: 1,
			asOf: '2026-09-07T13:00:00.000Z'
		}
		expect(
			parseWorkdayTaskPage(overdue, { ...request, period: 'OVERDUE' })
		).not.toBeNull()
		expect(
			parseWorkdayTaskPage(
				{ ...overdue, asOf: date },
				{ ...request, period: 'OVERDUE' }
			)
		).toBeNull()
		expect(
			parseWorkdayTaskPage(
				{ ...overdue, overdueCount: 2 },
				{ ...request, period: 'OVERDUE' }
			)
		).toBeNull()
	})
	it.each(WORKDAY_PERIODS)(
		'supports explicit %s with a valid timezone',
		period => {
			const selected = {
				...filters,
				period,
				...(period === 'DAY' || period === 'RANGE'
					? { from: '2026-09-07' }
					: {}),
				...(period === 'RANGE' ? { to: '2026-09-09' } : {})
			} as WorkdayFilters
			expect(validWorkdayFilters(selected)).toBe(true)
		}
	)
	it.each([
		{ timeZone: '' },
		{ timeZone: 'Not/AZone' },
		{ timeZone: '+03:00' },
		{ page: 0 },
		{ pageSize: 101 },
		{ scope: 'OWN' },
		{ from: '2026-09-07' },
		{ period: 'DAY' },
		{ period: 'DAY', from: '2026-02-30' },
		{ period: 'DAY', from: '2026-09-07', to: '2026-09-07' },
		{ period: 'RANGE', from: '2026-09-08', to: '2026-09-07' }
	])('rejects invalid filters %#', override =>
		expect(
			validWorkdayFilters({ ...filters, ...override } as WorkdayFilters)
		).toBe(false)
	)
	it('uses server clock and Monday-to-Sunday week, never local browser date', () => {
		expect(
			expectedWorkdayRange(
				{ period: 'WEEK', timeZone: 'Europe/Moscow' },
				date
			)
		).toEqual({
			from: '2026-09-06T21:00:00.000Z',
			until: '2026-09-13T21:00:00.000Z'
		})
		expect(
			expectedWorkdayRange(
				{ period: 'TOMORROW', timeZone: 'Europe/Moscow' },
				date
			)
		).toEqual({
			from: '2026-09-07T21:00:00.000Z',
			until: '2026-09-08T21:00:00.000Z'
		})
	})
	it.each([
		['2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
		['2026-11-01', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z']
	])('validates DST calendar date %s', (from, start, until) =>
		expect(
			expectedWorkdayRange(
				{ period: 'DAY', from, timeZone: 'America/New_York' },
				date
			)
		).toEqual({ from: start, until })
	)
	it('supports a skipped local day without fabricating a 24-hour interval', () =>
		expect(
			expectedWorkdayRange(
				{ period: 'DAY', from: '2011-12-30', timeZone: 'Pacific/Apia' },
				date
			)
		).toEqual({
			from: '2011-12-30T10:00:00.000Z',
			until: '2011-12-30T10:00:00.000Z'
		}))
	it('validates calendar dates and named timezones', () => {
		expect(isWorkdayDate('2024-02-29')).toBe(true)
		expect(isWorkdayDate('2026-02-29')).toBe(false)
		expect(isWorkdayTimeZone('UTC')).toBe(true)
	})
})

describe('Workday timeline binding', () => {
	it('accepts the exact task history including historical assignees', () => {
		expect(parseWorkdayTimelineEntry(entry, workspaceId, taskId)).toEqual(
			entry
		)
		const changed = {
			...entry,
			kind: 'ASSIGNED',
			before: task,
			after: { ...task, version: 2, assignedToSubject: 'other' }
		}
		expect(
			parseWorkdayTimelineEntry(changed, workspaceId, taskId)
		).not.toBeNull()
	})
	it.each([
		{ workspaceId: otherId },
		{ taskId: otherId },
		{ kind: 'OTHER' },
		{ before: task },
		{ after: { ...task, workspaceId: otherId } },
		{ after: { ...task, id: otherId } },
		{ after: { ...task, version: 2 } },
		{ kind: 'EDITED', before: task, after: { ...task, version: 3 } }
	])('rejects cross-target/invalid history %#', override =>
		expect(
			parseWorkdayTimelineEntry(
				{ ...entry, ...override },
				workspaceId,
				taskId
			)
		).toBeNull()
	)
	it('requires server pagination and no unexpected history fields', () => {
		const response = {
			schemaVersion: 1,
			page: 1,
			pageSize: 25,
			total: 1,
			items: [entry]
		}
		const request = { ...binding, id: taskId, page: 1, pageSize: 25 }
		expect(parseWorkdayTimelinePage(response, request)).toEqual(response)
		expect(
			parseWorkdayTimelinePage({ ...response, page: 2 }, request)
		).toBeNull()
		expect(
			parseWorkdayTimelinePage({ ...response, nextCursor: 'x' }, request)
		).toBeNull()
	})
})
