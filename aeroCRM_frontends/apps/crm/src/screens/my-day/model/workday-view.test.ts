import { describe, expect, it, vi } from 'vitest'
import {
	groupWorkdayTasks,
	initialWorkdayFilters,
	isWorkdayOverdue,
	workdayDate,
	workdayCalendarDay,
	shiftWorkdayCalendarDay,
	workdayCalendarWeek,
	workdayCalendarFilters,
	workdayLayoutStorageKey,
	readStoredWorkdayLayout,
	writeStoredWorkdayLayout,
	WORKDAY_BOARD_STATUSES
} from './workday-view'
import { task } from '@/entities/crm-workday/model/workday.test-fixtures'

describe('MyDay presentation semantics', () => {
	it('starts with all my active tasks, explicit Moscow timezone and server page', () => {
		expect(initialWorkdayFilters()).toEqual({
			period: 'ALL',
			status: 'ACTIVE',
			scope: 'MINE',
			timeZone: 'Europe/Moscow',
			page: 1,
			pageSize: 20
		})
	})
	it('groups one active server page by server asOf and the selected local day', () => {
		const asOf = '2026-10-04T12:00:00.000Z'
		const upcoming = {
			...task,
			id: '22222222-2222-4222-8222-222222222223',
			dueAt: '2026-10-04T21:00:00.000Z'
		}
		const todayLast = {
			...task,
			id: '22222222-2222-4222-8222-222222222224',
			dueAt: '2026-10-04T20:59:59.999Z'
		}
		const todayAtAsOf = {
			...task,
			id: '22222222-2222-4222-8222-222222222225',
			dueAt: asOf
		}
		const overdue = {
			...task,
			id: '22222222-2222-4222-8222-222222222226',
			dueAt: '2026-10-04T11:59:59.999Z'
		}
		const completed = {
			...task,
			id: '22222222-2222-4222-8222-222222222227',
			status: 'COMPLETED' as const,
			completedAt: asOf,
			dueAt: overdue.dueAt
		}

		expect(
			groupWorkdayTasks(
				[overdue, todayAtAsOf, todayLast, upcoming, completed],
				asOf,
				'Europe/Moscow'
			).map(group => ({
				id: group.id,
				title: group.title,
				items: group.items.map(item => item.id)
			}))
		).toEqual([
			{ id: 'overdue', title: 'Просроченные', items: [overdue.id] },
			{
				id: 'today',
				title: 'Сегодня',
				items: [todayAtAsOf.id, todayLast.id]
			},
			{ id: 'upcoming', title: 'Предстоящие', items: [upcoming.id] }
		])
	})
	it('uses the 25-hour local day at the fall DST boundary', () => {
		const asOf = '2026-11-01T04:00:00.000Z'
		const duringRepeatedHour = {
			...task,
			id: '22222222-2222-4222-8222-222222222223',
			dueAt: '2026-11-02T04:59:59.999Z'
		}
		const nextLocalDay = {
			...task,
			id: '22222222-2222-4222-8222-222222222224',
			dueAt: '2026-11-02T05:00:00.000Z'
		}
		expect(
			groupWorkdayTasks(
				[duringRepeatedHour, nextLocalDay],
				asOf,
				'America/New_York'
			).map(group => [group.id, group.items.map(item => item.id)])
		).toEqual([
			['today', [duringRepeatedHour.id]],
			['upcoming', [nextLocalDay.id]]
		])
	})
	it('shows cancelled tasks in their own board status', () => {
		expect(WORKDAY_BOARD_STATUSES).toEqual([
			'OPEN',
			'IN_PROGRESS',
			'COMPLETED',
			'CANCELLED'
		])
	})
	it.each(['OPEN', 'IN_PROGRESS'] as const)(
		'compares %s deadlines with server asOf, not browser clock',
		status => {
			expect(
				isWorkdayOverdue(
					{ status, dueAt: '2026-09-07T10:00:00Z' },
					'2026-09-07T10:01:00Z'
				)
			).toBe(true)
			expect(
				isWorkdayOverdue(
					{ status, dueAt: '2026-09-07T10:00:00Z' },
					'2026-09-07T10:00:00Z'
				)
			).toBe(false)
		}
	)
	it.each(['COMPLETED', 'CANCELLED'] as const)(
		'never marks %s as overdue',
		status => {
			expect(
				isWorkdayOverdue(
					{ status, dueAt: '2026-09-06T10:00:00Z' },
					'2026-09-07T10:00:00Z'
				)
			).toBe(false)
		}
	)
	it('displays dates in the selected timezone', () => {
		expect(workdayDate('2026-09-07T22:30:00Z', 'Europe/Moscow')).toContain(
			'8 сент.'
		)
		expect(workdayDate('2026-09-07T22:30:00Z', 'UTC')).toContain('7 сент.')
	})
	it('uses the selected timezone at midnight boundaries and across DST changes', () => {
		expect(
			workdayCalendarDay('2026-03-08T04:59:59.999Z', 'America/New_York')
		).toBe('2026-03-07')
		expect(
			workdayCalendarDay('2026-03-08T05:00:00.000Z', 'America/New_York')
		).toBe('2026-03-08')
		expect(
			workdayCalendarDay('2026-11-01T03:59:59.999Z', 'America/New_York')
		).toBe('2026-10-31')
		expect(
			workdayCalendarDay('2026-11-01T04:00:00.000Z', 'America/New_York')
		).toBe('2026-11-01')
		expect(
			workdayCalendarDay('2026-11-01T05:30:00.000Z', 'America/New_York')
		).toBe('2026-11-01')
		expect(
			workdayCalendarDay('2026-11-01T06:30:00.000Z', 'America/New_York')
		).toBe('2026-11-01')
		expect(workdayCalendarDay('not-a-date', 'America/New_York')).toBeNull()
		expect(
			workdayCalendarDay('2026-03-08T05:00:00Z', 'Invalid/Zone')
		).toBeNull()
	})
	it('shifts calendar labels as dates rather than fixed local-time instants', () => {
		expect(shiftWorkdayCalendarDay('2026-03-08', -1)).toBe('2026-03-07')
		expect(shiftWorkdayCalendarDay('2026-03-08', 1)).toBe('2026-03-09')
		expect(shiftWorkdayCalendarDay('2026-11-01', 1)).toBe('2026-11-02')
		expect(shiftWorkdayCalendarDay('2026-01-01', -1)).toBe('2025-12-31')
		expect(shiftWorkdayCalendarDay('0000-01-01', -1)).toBeNull()
		expect(shiftWorkdayCalendarDay('9999-12-31', 1)).toBeNull()
		expect(shiftWorkdayCalendarDay('2026-01-01', 1.5)).toBeNull()
	})
	it('builds Monday-to-Sunday weeks across month and year boundaries', () => {
		expect(workdayCalendarWeek('2026-01-01')).toEqual({
			from: '2025-12-29',
			to: '2026-01-04',
			days: [
				'2025-12-29',
				'2025-12-30',
				'2025-12-31',
				'2026-01-01',
				'2026-01-02',
				'2026-01-03',
				'2026-01-04'
			]
		})
		expect(workdayCalendarWeek('2026-01-04')?.from).toBe('2025-12-29')
		expect(workdayCalendarWeek('0001-01-02')?.to).toBe('0001-01-07')
		expect(workdayCalendarWeek('9999-12-31')).toBeNull()
		expect(workdayCalendarWeek('2026-02-30')).toBeNull()
	})
	it('creates a server RANGE for the whole calendar week and resets pagination', () => {
		const filters = {
			...initialWorkdayFilters(),
			status: 'OPEN' as const,
			page: 4,
			assigneeSubject: 'employee'
		}
		expect(workdayCalendarFilters(filters, '2026-01-01')).toEqual({
			...filters,
			period: 'RANGE',
			from: '2025-12-29',
			to: '2026-01-04',
			page: 1
		})
		expect(workdayCalendarFilters(filters, 'bad-day')).toBeNull()
	})
	it('persists only supported layout values and survives unavailable storage', () => {
		const key = workdayLayoutStorageKey('workspace', 'actor')
		expect(key).toBe('crm:task-layout:v1:workspace:actor')
		writeStoredWorkdayLayout(key, 'calendar')
		expect(readStoredWorkdayLayout(key)).toBe('calendar')
		writeStoredWorkdayLayout(key, 'board')
		expect(readStoredWorkdayLayout(key)).toBe('board')
		window.localStorage.setItem(key, 'unsupported')
		expect(readStoredWorkdayLayout(key)).toBe('list')
		vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
			throw new Error('storage unavailable')
		})
		vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
			throw new Error('storage unavailable')
		})
		expect(readStoredWorkdayLayout(key)).toBe('list')
		expect(() => writeStoredWorkdayLayout(key, 'calendar')).not.toThrow()
	})
})
