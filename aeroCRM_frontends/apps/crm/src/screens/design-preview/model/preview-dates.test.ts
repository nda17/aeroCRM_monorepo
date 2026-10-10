import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	calendarDayMs,
	calendarToday,
	calendarFormat,
	taskDate,
	taskOverdue,
	taskTime
} from './preview-dates'

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('design preview calendar dates', () => {
	it('formats calendar values in UTC regardless of the runtime timezone', () => {
		expect(
			calendarFormat(Date.UTC(2024, 11, 31), {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric'
			})
		).toBe('31.12.2024')
	})

	it.each([
		['29.02.2024', Date.UTC(2024, 1, 29)],
		['01.01.2025', Date.UTC(2025, 0, 1)],
		['31.12.2024', Date.UTC(2024, 11, 31)]
	])('parses valid leap and year-boundary date %s', (label, expected) => {
		expect(
			taskDate({ due: label, overdue: false }, Date.UTC(2024, 0, 1))
		).toBe(expected)
	})

	it.each(['29.02.2023', '31.04.2024', '31.13.2024', '1.1.2025'])(
		'rejects invalid or noncanonical date %s',
		label => {
			expect(
				taskDate({ due: label, overdue: false }, Date.UTC(2024, 0, 1))
			).toBe(null)
		}
	)

	it('resolves a weekday to the future or past week based on overdue state', () => {
		const tuesday = Date.UTC(2024, 11, 31)

		expect(taskDate({ due: 'Понедельник', overdue: false }, tuesday)).toBe(
			Date.UTC(2025, 0, 6)
		)
		expect(taskDate({ due: 'Понедельник', overdue: true }, tuesday)).toBe(
			Date.UTC(2024, 11, 30)
		)
	})

	it('derives today from each requested timezone across a UTC date boundary', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2025-01-01T00:30:00.000Z'))

		expect(calendarToday('America/Los_Angeles')).toBe(
			Date.UTC(2024, 11, 31)
		)
		expect(calendarToday('Europe/Moscow')).toBe(Date.UTC(2025, 0, 1))
		expect(calendarToday('Asia/Tokyo')).toBe(Date.UTC(2025, 0, 1))
	})

	it('evaluates date and due time in the selected timezone', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2025-01-01T00:30:00.000Z'))
		const task = {
			due: '31.12.2024, 17:00',
			overdue: false,
			status: 'todo' as const
		}

		// In Los Angeles it is still Dec 31 at 16:30; in Moscow Jan 1 has begun.
		expect(taskOverdue(task, 'America/Los_Angeles')).toBe(false)
		expect(taskOverdue(task, 'Europe/Moscow')).toBe(true)
	})

	it('compares same-day due times by minute and excludes completed tasks', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2025-02-28T10:30:00.000Z'))
		const task = (due: string, status: 'todo' | 'done' = 'todo') => ({
			due,
			overdue: false,
			status
		})

		expect(taskOverdue(task('Сегодня, 13:29'), 'Europe/Moscow')).toBe(true)
		expect(taskOverdue(task('Сегодня, 13:30'), 'Europe/Moscow')).toBe(
			false
		)
		expect(taskOverdue(task('Сегодня, 13:31'), 'Europe/Moscow')).toBe(
			false
		)
		expect(
			taskOverdue(task('Сегодня, 12:00', 'done'), 'Europe/Moscow')
		).toBe(false)
	})

	it('does not interpret an invalid legacy time as a valid due time', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2025-02-28T10:30:00.000Z'))
		const task = {
			due: 'Сегодня, 25:99',
			overdue: false,
			status: 'todo' as const
		}

		expect(taskTime(task)).toBe(Number.POSITIVE_INFINITY)
		expect(taskOverdue(task, 'Europe/Moscow')).toBe(false)
	})

	it('advances a civil date by one calendar day across a daylight-saving transition', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2025-03-09T06:30:00.000Z'))
		const today = calendarToday('America/New_York')

		expect(today).toBe(Date.UTC(2025, 2, 9))
		expect(taskDate({ due: 'Завтра', overdue: false }, today)).toBe(
			today + calendarDayMs
		)
	})
})
