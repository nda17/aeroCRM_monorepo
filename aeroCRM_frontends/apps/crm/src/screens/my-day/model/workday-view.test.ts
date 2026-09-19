import { describe, expect, it } from 'vitest'
import {
	initialWorkdayFilters,
	isWorkdayOverdue,
	workdayDate,
	WORKDAY_BOARD_STATUSES
} from './workday-view'

describe('MyDay presentation semantics', () => {
	it('starts with my today tasks, explicit Moscow timezone and server page', () => {
		expect(initialWorkdayFilters()).toEqual({
			period: 'TODAY',
			scope: 'MINE',
			timeZone: 'Europe/Moscow',
			page: 1,
			pageSize: 20
		})
	})
	it('does not turn cancelled tasks into completed board cards', () => {
		expect(WORKDAY_BOARD_STATUSES).toEqual([
			'OPEN',
			'IN_PROGRESS',
			'COMPLETED'
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
})
